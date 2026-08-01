import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEventLinks, calendarSettings } from "@/db/schema";
import { listBillingBoard, type BillingRow } from "@/db/queries";
import { auth, GOOGLE_CALENDAR_PROVIDER_ID } from "@/lib/auth";
import { formatCurrency } from "@/lib/currency";

/**
 * Google 日曆同步。
 *
 * 為什麼沒有 cron：事件推進 Google 之後，提醒就由 Google 自己發（手機推播 / email），
 * 我們不需要自己排程去通知任何人。同步只在「資料變動時」與「使用者按同步」時發生。
 *
 * 為什麼直接打 REST 而不用 googleapis 套件：這個 app 跑在 Cloudflare Workers 上，
 * googleapis 太肥且相依 Node API。這裡要的只有四個端點，用 fetch 就夠。
 */

const CAL_API = "https://www.googleapis.com/calendar/v3";

export type CalendarSyncResult = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
};

export class CalendarNotConnectedError extends Error {
  constructor(message = "尚未連結 Google 日曆") {
    super(message);
    this.name = "CalendarNotConnectedError";
  }
}

/**
 * 取一顆有效的 access token。better-auth 會在過期時用 refresh token 自動換新，
 * 所以這裡不必自己處理 refresh。
 */
async function getAccessToken(userId: string): Promise<string> {
  try {
    // 這個 endpoint 不吃 session（只看 body 的 userId），所以不必傳 headers ——
    // server action、MCP route、未來的排程都能共用同一條路徑。
    const res = await auth.api.getAccessToken({
      body: { providerId: GOOGLE_CALENDAR_PROVIDER_ID, userId },
    });
    if (!res?.accessToken) throw new CalendarNotConnectedError();
    return res.accessToken;
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) throw e;
    // better-auth 在「找不到帳號」與「refresh 失敗」都丟 APIError，對使用者來說
    // 兩者的處置一樣：重新連結一次。
    throw new CalendarNotConnectedError(
      "Google 日曆授權已失效，請到組織設定重新連結",
    );
  }
}

async function calendarFetch(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<Response> {
  return fetch(`${CAL_API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init?.body == null ? undefined : JSON.stringify(init.body),
  });
}

export type CalendarSettingsRow = {
  organizationId: string;
  googleCalendarId: string | null;
  ownerUserId: string | null;
  reminderDays: number;
  enabled: boolean;
};

export async function getCalendarSettings(orgId: string): Promise<CalendarSettingsRow | null> {
  const [row] = await getDb()
    .select()
    .from(calendarSettings)
    .where(eq(calendarSettings.organizationId, orgId))
    .limit(1);
  return row ?? null;
}

/**
 * 確保這個組織有一本專屬子日曆，沒有就建一本並記下 id。
 * 用專屬日曆（而非主日曆）的理由：可整本開關 / 分享 / 換顏色，誤刪也不會動到個人行程。
 */
async function ensureCalendar(
  orgId: string,
  orgName: string,
  token: string,
  existing: CalendarSettingsRow | null,
): Promise<string> {
  if (existing?.googleCalendarId) {
    // 確認那本日曆還在（可能被使用者從 Google 端刪掉）。
    const check = await calendarFetch(
      token,
      `/calendars/${encodeURIComponent(existing.googleCalendarId)}`,
    );
    if (check.ok) return existing.googleCalendarId;
    if (check.status !== 404 && check.status !== 403) {
      throw new Error(`確認日曆失敗（${check.status}）`);
    }
    // 被刪掉了 → 連同事件對應一起清掉，下面重建一本新的。
    await getDb()
      .delete(calendarEventLinks)
      .where(eq(calendarEventLinks.organizationId, orgId));
  }

  const res = await calendarFetch(token, "/calendars", {
    method: "POST",
    body: { summary: `請款提醒 · ${orgName}`, timeZone: "Asia/Taipei" },
  });
  if (!res.ok) throw new Error(`建立日曆失敗（${res.status}）：${await res.text()}`);
  const created = (await res.json()) as { id: string };

  await getDb()
    .insert(calendarSettings)
    .values({
      organizationId: orgId,
      googleCalendarId: created.id,
      ownerUserId: existing?.ownerUserId ?? null,
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: calendarSettings.organizationId,
      set: { googleCalendarId: created.id, updatedAt: new Date().toISOString() },
    });
  return created.id;
}

type PlannedEvent = {
  itemKey: string;
  kind: "due" | "payment" | "invoice";
  date: string;
  summary: string;
  description: string;
};

/** 一列請款要在日曆上長出哪幾顆事件。已完成的動作就不再提醒。 */
function planEvents(row: BillingRow): PlannedEvent[] {
  const out: PlannedEvent[] = [];
  const who = row.customerName ?? "客戶";
  const money = formatCurrency(row.expected, row.currency);
  const link = "請款看板：/billing";

  // 還沒請款 → 提醒去請款
  if (row.dueDate && !row.billedOn && row.status !== "paid") {
    out.push({
      itemKey: row.key,
      kind: "due",
      date: row.dueDate,
      summary: `請款：${who} · ${row.title}（${money}）`,
      description: `應向 ${who} 請款 ${money}。\n${link}`,
    });
  }
  // 已請款但還沒收齊 → 提醒去追款
  if (row.billedOn && row.paid < row.expected && row.status !== "paid") {
    const outstanding = formatCurrency(row.expected - row.paid, row.currency);
    out.push({
      itemKey: row.key,
      kind: "payment",
      date: row.dueDate ?? row.billedOn,
      summary: `收款追蹤：${who} · ${row.title}（未收 ${outstanding}）`,
      description: `已於 ${row.billedOn} 請款，尚未收齊 ${outstanding}。\n${link}`,
    });
  }
  // 該開發票還沒開
  if (row.needsInvoice) {
    out.push({
      itemKey: row.key,
      kind: "invoice",
      date: row.billedOn ?? row.dueDate ?? "",
      summary: `開發票：${who} · ${row.title}（${money}）`,
      description: `需開立發票給 ${who}，金額 ${money}。\n${link}`,
    });
  }
  return out.filter((e) => e.date !== "");
}

/** 內容沒變就不重打 API。日期或標題一變，hash 就變。 */
function hashEvent(e: PlannedEvent, reminderDays: number): string {
  return `${e.date}|${e.summary}|${reminderDays}`;
}

function eventBody(e: PlannedEvent, reminderDays: number) {
  // 全天事件：Google 的 end.date 是 exclusive，所以要是隔天。
  const start = e.date;
  const end = new Date(`${e.date}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return {
    summary: e.summary,
    description: e.description,
    start: { date: start },
    end: { date: end.toISOString().slice(0, 10) },
    reminders: {
      useDefault: false,
      overrides: [{ method: "popup", minutes: reminderDays * 24 * 60 }],
    },
  };
}

/**
 * 全量對帳：把看板現況推到 Google 日曆 —— 新增缺的、更新變動的、刪掉不該再提醒的。
 * 冪等，可以重複按。
 */
export async function syncBillingCalendar(
  orgId: string,
  orgName: string,
): Promise<CalendarSyncResult> {
  const db = getDb();
  const settings = await getCalendarSettings(orgId);
  if (!settings?.ownerUserId) throw new CalendarNotConnectedError();
  if (!settings.enabled) return { created: 0, updated: 0, deleted: 0, skipped: 0 };

  const token = await getAccessToken(settings.ownerUserId);
  const calendarId = await ensureCalendar(orgId, orgName, token, settings);
  const encodedCal = encodeURIComponent(calendarId);
  const reminderDays = settings.reminderDays;

  const rows = await listBillingBoard(orgId, { includeAllHistory: true });
  const planned = rows.flatMap(planEvents);
  const links = await db
    .select()
    .from(calendarEventLinks)
    .where(eq(calendarEventLinks.organizationId, orgId));
  const linkByKey = new Map(links.map((l) => [`${l.itemKey}|${l.kind}`, l]));

  const result: CalendarSyncResult = { created: 0, updated: 0, deleted: 0, skipped: 0 };
  const seen = new Set<string>();

  for (const e of planned) {
    const mapKey = `${e.itemKey}|${e.kind}`;
    seen.add(mapKey);
    const existing = linkByKey.get(mapKey);
    const hash = hashEvent(e, reminderDays);

    if (existing && existing.contentHash === hash) {
      result.skipped += 1;
      continue;
    }

    if (existing) {
      const res = await calendarFetch(
        token,
        `/calendars/${encodedCal}/events/${encodeURIComponent(existing.googleEventId)}`,
        { method: "PATCH", body: eventBody(e, reminderDays) },
      );
      if (res.ok) {
        await db
          .update(calendarEventLinks)
          .set({ contentHash: hash, syncedAt: new Date().toISOString() })
          .where(eq(calendarEventLinks.id, existing.id));
        result.updated += 1;
        continue;
      }
      if (res.status !== 404 && res.status !== 410) {
        throw new Error(`更新事件失敗（${res.status}）：${await res.text()}`);
      }
      // Google 端已被刪掉 → 移除對應後往下重建。
      await db.delete(calendarEventLinks).where(eq(calendarEventLinks.id, existing.id));
    }

    const res = await calendarFetch(token, `/calendars/${encodedCal}/events`, {
      method: "POST",
      body: eventBody(e, reminderDays),
    });
    if (!res.ok) throw new Error(`建立事件失敗（${res.status}）：${await res.text()}`);
    const created = (await res.json()) as { id: string };
    await db
      .insert(calendarEventLinks)
      .values({
        organizationId: orgId,
        itemKey: e.itemKey,
        kind: e.kind,
        googleEventId: created.id,
        contentHash: hash,
      })
      .onConflictDoUpdate({
        target: [
          calendarEventLinks.organizationId,
          calendarEventLinks.itemKey,
          calendarEventLinks.kind,
        ],
        set: { googleEventId: created.id, contentHash: hash, syncedAt: new Date().toISOString() },
      });
    result.created += 1;
  }

  // 已收款 / 已開發票 / 被刪掉的列 → 事件該消失，否則日曆上會留著早就處理完的提醒。
  const stale = links.filter((l) => !seen.has(`${l.itemKey}|${l.kind}`));
  for (const l of stale) {
    const res = await calendarFetch(
      token,
      `/calendars/${encodedCal}/events/${encodeURIComponent(l.googleEventId)}`,
      { method: "DELETE" },
    );
    // 404/410 = 早就不在了，一樣視為已刪除。
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(`刪除事件失敗（${res.status}）`);
    }
    result.deleted += 1;
  }
  if (stale.length > 0) {
    await db.delete(calendarEventLinks).where(
      inArray(
        calendarEventLinks.id,
        stale.map((l) => l.id),
      ),
    );
  }

  return result;
}

/** 這位使用者是否已授權 Google 日曆（設定頁用來決定顯示「連結」還是「已連結」）。 */
export async function hasCalendarGrant(userId: string): Promise<boolean> {
  try {
    await getAccessToken(userId);
    return true;
  } catch {
    return false;
  }
}

/** 記下「用哪位成員的授權推事件」，並確保設定列存在。 */
export async function setCalendarOwner(orgId: string, userId: string) {
  const now = new Date().toISOString();
  await getDb()
    .insert(calendarSettings)
    .values({ organizationId: orgId, ownerUserId: userId, updatedAt: now })
    .onConflictDoUpdate({
      target: calendarSettings.organizationId,
      set: { ownerUserId: userId, updatedAt: now },
    });
}

/** 中斷連結：清掉本 org 的日曆設定與事件對應（不動 Google 上既有的事件）。 */
export async function disconnectCalendar(orgId: string) {
  const db = getDb();
  await db.delete(calendarEventLinks).where(eq(calendarEventLinks.organizationId, orgId));
  await db
    .update(calendarSettings)
    .set({ ownerUserId: null, googleCalendarId: null, updatedAt: new Date().toISOString() })
    .where(eq(calendarSettings.organizationId, orgId));
}

/** 只更新提醒提前天數。 */
export async function setReminderDays(orgId: string, days: number) {
  await getDb()
    .update(calendarSettings)
    .set({ reminderDays: days, updatedAt: new Date().toISOString() })
    .where(and(eq(calendarSettings.organizationId, orgId)));
}
