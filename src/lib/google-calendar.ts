import { getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { calendarEventLinks, calendarSettings } from "@/db/schema";
import { user } from "@/db/auth-schema";
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

/**
 * next-intl 的 translator 型別是整棵訊息樹展開出來的聯集，當成參數傳遞時 TS 會
 * 因為型別太深而放棄（TS2589），而且它的 key 參數比 `string` 窄，逆變也過不了。
 * 這裡只需要「給 key 回字串」，所以縮成最小介面，傳入時明確轉型。
 */
type CalendarText = (
  key: string,
  values?: Record<string, string | number>,
) => string;

export type CalendarSyncResult = {
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
};

export class CalendarNotConnectedError extends Error {
  constructor(message = "Google Calendar is not connected") {
    super(message);
    this.name = "CalendarNotConnectedError";
  }
}

/**
 * 取一顆有效的 access token。better-auth 會在過期時用 refresh token 自動換新，
 * 所以這裡不必自己處理 refresh。
 */
async function getAccessToken(userId: string): Promise<string> {
  const t = await getTranslations("lib");
  try {
    // 這個 endpoint 不吃 session（只看 body 的 userId），所以不必傳 headers ——
    // server action、MCP route、未來的排程都能共用同一條路徑。
    const res = await auth.api.getAccessToken({
      body: { providerId: GOOGLE_CALENDAR_PROVIDER_ID, userId },
    });
    if (!res?.accessToken) throw new CalendarNotConnectedError(t("calendar.notConnected"));
    return res.accessToken;
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) throw e;
    // better-auth 在「找不到帳號」與「refresh 失敗」都丟 APIError，對使用者來說
    // 兩者的處置一樣：重新連結一次。
    throw new CalendarNotConnectedError(t("calendar.grantExpired"));
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
  const t = await getTranslations("lib");
  if (existing?.googleCalendarId) {
    // 確認那本日曆還在（可能被使用者從 Google 端刪掉）。
    const check = await calendarFetch(
      token,
      `/calendars/${encodeURIComponent(existing.googleCalendarId)}`,
    );
    if (check.ok) return existing.googleCalendarId;
    if (check.status !== 404 && check.status !== 403) {
      throw new Error(t("calendar.checkFailed", { status: check.status }));
    }
    // 被刪掉了 → 連同事件對應一起清掉，下面重建一本新的。
    await getDb()
      .delete(calendarEventLinks)
      .where(eq(calendarEventLinks.organizationId, orgId));
  }

  const res = await calendarFetch(token, "/calendars", {
    method: "POST",
    body: { summary: t("calendar.title", { org: orgName }), timeZone: "Asia/Taipei" },
  });
  if (!res.ok)
    throw new Error(
      t("calendar.createFailed", { status: res.status, body: await res.text() }),
    );
  const created: { id: string } = await res.json();

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

/**
 * 一列請款要在日曆上長出哪幾顆事件。已完成的動作就不再提醒。
 *
 * 事件文案會跟著同步發動者的語系走 —— `hashEvent` 把 summary 算進 hash，所以換語
 * 系後的第一次同步會把既有事件的標題改寫成新語言。內容等價，只是語言不同。
 */
function planEvents(row: BillingRow, t: CalendarText): PlannedEvent[] {
  const out: PlannedEvent[] = [];
  const who = row.customerName ?? t("calendar.client");
  const money = formatCurrency(row.expected, row.currency);
  const link = t("calendar.link");

  // 還沒請款 → 提醒去請款
  if (row.dueDate && !row.billedOn && row.status !== "paid") {
    out.push({
      itemKey: row.key,
      kind: "due",
      date: row.dueDate,
      summary: t("calendar.due.summary", { who, title: row.title, money }),
      description: `${t("calendar.due.description", { who, money })}\n${link}`,
    });
  }
  // 已請款但還沒收齊 → 提醒去追款
  if (row.billedOn && row.paid < row.expected && row.status !== "paid") {
    const outstanding = formatCurrency(row.expected - row.paid, row.currency);
    out.push({
      itemKey: row.key,
      kind: "payment",
      date: row.dueDate ?? row.billedOn,
      summary: t("calendar.payment.summary", { who, title: row.title, outstanding }),
      description: `${t("calendar.payment.description", { billedOn: row.billedOn, outstanding })}\n${link}`,
    });
  }
  // 該開發票還沒開
  if (row.needsInvoice) {
    out.push({
      itemKey: row.key,
      kind: "invoice",
      date: row.billedOn ?? row.dueDate ?? "",
      summary: t("calendar.invoice.summary", { who, title: row.title, money }),
      description: `${t("calendar.invoice.description", { who, money })}\n${link}`,
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
 * 更新一顆既有事件。回傳 false 代表 Google 端那顆已經不在（對應也一併清掉了），
 * 呼叫端要改走「重建」那條路。
 */
async function patchEvent(
  token: string,
  encodedCal: string,
  existing: { id: number; googleEventId: string },
  e: PlannedEvent,
  hash: string,
  reminderDays: number,
  t: CalendarText,
): Promise<boolean> {
  const db = getDb();
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
    return true;
  }
  if (res.status !== 404 && res.status !== 410) {
    throw new Error(
      t("calendar.updateEventFailed", { status: res.status, body: await res.text() }),
    );
  }
  // Google 端已被刪掉 → 移除對應後由呼叫端重建。
  await db.delete(calendarEventLinks).where(eq(calendarEventLinks.id, existing.id));
  return false;
}

/** 建一顆新事件，並記下它的 Google 事件 id 對應。 */
async function createEvent(
  orgId: string,
  token: string,
  encodedCal: string,
  e: PlannedEvent,
  hash: string,
  reminderDays: number,
  t: CalendarText,
): Promise<void> {
  const res = await calendarFetch(token, `/calendars/${encodedCal}/events`, {
    method: "POST",
    body: eventBody(e, reminderDays),
  });
  if (!res.ok)
    throw new Error(
      t("calendar.createEventFailed", { status: res.status, body: await res.text() }),
    );
  const created: { id: string } = await res.json();
  await getDb()
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
}

/** 把 Google 端那些不該再提醒的事件刪掉，回傳處理了幾顆。 */
async function deleteStaleEvents(
  token: string,
  encodedCal: string,
  stale: { googleEventId: string }[],
  t: CalendarText,
): Promise<number> {
  let deleted = 0;
  for (const l of stale) {
    const res = await calendarFetch(
      token,
      `/calendars/${encodedCal}/events/${encodeURIComponent(l.googleEventId)}`,
      { method: "DELETE" },
    );
    // 404/410 = 早就不在了，一樣視為已刪除。
    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw new Error(t("calendar.deleteEventFailed", { status: res.status }));
    }
    deleted += 1;
  }
  return deleted;
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
  const t = await getTranslations("lib");
  if (!settings?.ownerUserId)
    throw new CalendarNotConnectedError(t("calendar.notConnected"));
  if (!settings.enabled) return { created: 0, updated: 0, deleted: 0, skipped: 0 };

  const token = await getAccessToken(settings.ownerUserId);
  const calendarId = await ensureCalendar(orgId, orgName, token, settings);
  const encodedCal = encodeURIComponent(calendarId);
  const reminderDays = settings.reminderDays;

  const rows = await listBillingBoard(orgId, { includeAllHistory: true });
  const planned = rows.flatMap((row) => planEvents(row, t as CalendarText));
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

    if (existing?.contentHash === hash) {
      result.skipped += 1;
      continue;
    }

    if (
      existing &&
      (await patchEvent(token, encodedCal, existing, e, hash, reminderDays, t as CalendarText))
    ) {
      result.updated += 1;
      continue;
    }

    await createEvent(orgId, token, encodedCal, e, hash, reminderDays, t as CalendarText);
    result.created += 1;
  }

  // 已收款 / 已開發票 / 被刪掉的列 → 事件該消失，否則日曆上會留著早就處理完的提醒。
  const stale = links.filter((l) => !seen.has(`${l.itemKey}|${l.kind}`));
  result.deleted = await deleteStaleEvents(token, encodedCal, stale, t as CalendarText);
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

/** 目前是用誰的授權在推事件（顯示用；沒連結就回 null）。 */
export async function getCalendarOwnerLabel(orgId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ name: user.name, email: user.email })
    .from(calendarSettings)
    .innerJoin(user, eq(user.id, calendarSettings.ownerUserId))
    .where(eq(calendarSettings.organizationId, orgId))
    .limit(1);
  if (!row) return null;
  return row.name || row.email;
}

export type DisconnectResult = {
  /** Google 上那本子日曆是否已經不在了。false = 授權失效刪不掉，要人工去 Google 端刪。 */
  calendarRemoved: boolean;
};

/**
 * 中斷連結：先刪掉 Google 上那本專屬子日曆，再清掉本系統的設定與事件對應。
 *
 * 為什麼要真的刪日曆：那本日曆是建在「當初授權的那位成員」的 Google 帳號底下。如果
 * 只清本系統的紀錄，日曆和裡面的事件會留在那個人的帳號裡，而且再也不會被更新或移除
 * —— 訂閱過那本日曆的人會一直看到早就處理完的請款提醒。換人連結時最明顯：新的擁有
 * 者拿自己的 token 讀不到舊日曆，會另外建一本，舊的那本就此變成沒人管的孤兒。
 */
export async function disconnectCalendar(orgId: string): Promise<DisconnectResult> {
  const db = getDb();
  const settings = await getCalendarSettings(orgId);

  // 沒建過日曆就沒有東西要清，直接視為已處理。
  let calendarRemoved = true;
  if (settings?.googleCalendarId && settings.ownerUserId) {
    try {
      // 必須用「當初授權的那位」的 token —— 日曆在他的帳號下，換別人刪不掉。
      const token = await getAccessToken(settings.ownerUserId);
      const res = await calendarFetch(
        token,
        `/calendars/${encodeURIComponent(settings.googleCalendarId)}`,
        { method: "DELETE" },
      );
      // 404/410 = 早就被手動刪了，結果一樣。
      calendarRemoved = res.ok || res.status === 404 || res.status === 410;
    } catch {
      // 授權已被撤銷或過期 → 刪不掉。本系統這邊還是要放手（否則使用者永遠卡在
      // 連結狀態），改由 UI 提醒使用者自己到 Google 日曆刪那本。
      calendarRemoved = false;
    }
  }

  await db.delete(calendarEventLinks).where(eq(calendarEventLinks.organizationId, orgId));
  await db
    .update(calendarSettings)
    .set({ ownerUserId: null, googleCalendarId: null, updatedAt: new Date().toISOString() })
    .where(eq(calendarSettings.organizationId, orgId));

  return { calendarRemoved };
}

/** 只更新提醒提前天數。 */
export async function setReminderDays(orgId: string, days: number) {
  await getDb()
    .update(calendarSettings)
    .set({ reminderDays: days, updatedAt: new Date().toISOString() })
    .where(and(eq(calendarSettings.organizationId, orgId)));
}
