import { and, asc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { logSystem } from "@/db/activity";
import { countTransactions, listLedgerTransactionsForPeriod, listOutstandingAdvances, listRecurringExpenses } from "@/db/queries";
import { notificationDeliveries, orgIntegrations } from "@/db/schema";
import { runAsSystem } from "@/i18n/server-t";
import { publicBaseUrl } from "@/lib/base-url";
import { DiscordApiError, DiscordWebhookGoneError, sendDiscordMessages } from "@/lib/integrations/discord";
import { parseDiscordConfig, type DiscordConfig } from "@/lib/integrations/discord-config";
import { IntegrationUnavailableError, recordSyncFailure } from "@/lib/integrations/store";
import type { IntegrationConfig } from "@/lib/integrations/types";
import {
  addDaysYmd,
  assignTransactions,
  buildRecap,
  nextChargeDate,
  previousPeriod,
  renderRecapMessages,
  renderReminderMessages,
  sumByCurrency,
  toRecurringExpense,
  type LedgerTransaction,
  type RecurringExpense,
  type ReminderItem,
} from "@/lib/recurring-expenses";
import { taipeiDate } from "@/lib/simpany-sync";

/**
 * 固定支出的 Discord 通知：扣款提醒與每月回顧。
 *
 * 觸發：每日 cron（台北 06:00）在整合自動同步之後呼叫（src/app/api/cron/integrations-autosync），
 * 所以 Wise 的交易已經是最新的。MCP `preview_billing_notifications` 走同一條路徑（預設 dryRun）。
 *
 * 範圍：Discord 整合 `enabled AND status = 'connected'` 的每個組織。
 *   - 扣款提醒：fixed、啟用中的固定支出，下一次扣款日落在 [今天, 今天 + reminderDays] 內。
 *     用區間而不是「剛好等於今天 + N 天」：cron 漏跑一天、或剛登記一筆明天就扣的，下一輪照樣會提醒；
 *     去重鍵是 reminder:<id>:<扣款日>，同一次扣款只會提醒一次。
 *   - 每月回顧：台北日期 >= recapDay 時發上個月的回顧（去重鍵 recap:<YYYY-MM>，一個月只發一次；
 *     同樣容許 cron 漏跑）。一筆啟用中的固定支出都沒有的組織不發。
 *
 * 冪等：送之前先 INSERT … ON CONFLICT DO NOTHING RETURNING 搶 notification_deliveries，
 * 搶到的才送；送失敗就刪掉自己搶的那幾列，下一輪再試。重跑、手動觸發、兩個 isolate 同時跑都不會重複發。
 * 一份回顧拆成多則時，送到一半失敗會在下一輪整份重送 —— 寧可重複，不要漏掉。
 *
 * 每個組織各自 try/catch，一個失敗不影響其他。
 */

const CHANNEL = "discord";

export type NotificationKind = "reminder" | "recap";

export type BillingNotifyOptions = {
  /** 只跑這個組織（MCP）。省略 = 所有開了 Discord 的組織（cron）。 */
  orgId?: string;
  /** true：不搶去重紀錄、不發送，只回傳會發出的訊息。 */
  dryRun?: boolean;
  /** 只跑這幾種通知。預設兩種都跑。 */
  kinds?: readonly NotificationKind[];
  /** 不管今天幾號，直接產生（並在非 dryRun 時發送）這個月份的回顧，即使已經發過。 */
  force?: { recapPeriod?: string };
  /** 有發送或失敗時的操作紀錄。預設記成 system（cron）；MCP 手動發送時記成那位成員。 */
  audit?: (orgId: string, summary: string) => Promise<void>;
};

const systemAudit = (orgId: string, summary: string) =>
  logSystem(orgId, "update", "integration", null, `discord: ${summary}`);

export type NotificationOutcome = {
  dedupeKeys: string[];
  messages: string[];
  /** 已經發過（去重紀錄已存在）而這次略過的鍵。 */
  alreadySent: string[];
  sent: boolean;
};

export type OrgNotifyResult = {
  organizationId: string;
  ok: boolean;
  error: string | null;
  today: string;
  config: DiscordConfig;
  reminders: NotificationOutcome | null;
  recap: (NotificationOutcome & { period: string }) | null;
};

export type BillingNotifyResult = {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  results: OrgNotifyResult[];
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ---------------------------------------------------------------------------
// 去重紀錄
// ---------------------------------------------------------------------------

/** 搶這些鍵；回傳這次真的搶到（之前沒有）的鍵。 */
async function claim(orgId: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await getDb()
    .insert(notificationDeliveries)
    .values(keys.map((dedupeKey) => ({ organizationId: orgId, channel: CHANNEL, dedupeKey })))
    .onConflictDoNothing({
      target: [notificationDeliveries.organizationId, notificationDeliveries.channel, notificationDeliveries.dedupeKey],
    })
    .returning({ dedupeKey: notificationDeliveries.dedupeKey });
  return new Set(rows.map((r) => r.dedupeKey));
}

/** 送失敗：放掉自己搶的鍵，讓下一輪重試。 */
async function release(orgId: string, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await getDb()
    .delete(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.organizationId, orgId),
        eq(notificationDeliveries.channel, CHANNEL),
        inArray(notificationDeliveries.dedupeKey, [...keys]),
      ),
    );
}

async function alreadyDelivered(orgId: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await getDb()
    .select({ dedupeKey: notificationDeliveries.dedupeKey })
    .from(notificationDeliveries)
    .where(
      and(
        eq(notificationDeliveries.organizationId, orgId),
        eq(notificationDeliveries.channel, CHANNEL),
        inArray(notificationDeliveries.dedupeKey, [...keys]),
      ),
    );
  return new Set(rows.map((r) => r.dedupeKey));
}

/**
 * 搶鍵 → 依搶到的鍵產生訊息 → 送；送失敗就放掉這次搶到的鍵再往外丟。
 * force：搶不到（已發過）也照送，但只放掉這次新搶到的鍵。
 */
async function deliver(
  orgId: string,
  keys: readonly string[],
  render: (claimed: Set<string>) => string[],
  roleIds: readonly string[],
  opts: { dryRun: boolean; force?: boolean },
): Promise<NotificationOutcome> {
  if (opts.dryRun) {
    const done = await alreadyDelivered(orgId, keys);
    return {
      dedupeKeys: [...keys],
      messages: render(new Set(keys)),
      alreadySent: keys.filter((k) => done.has(k)),
      sent: false,
    };
  }
  const claimed = await claim(orgId, keys);
  const alreadySent = keys.filter((k) => !claimed.has(k));
  const messages = render(opts.force ? new Set(keys) : claimed);
  if (messages.length === 0) return { dedupeKeys: [...keys], messages, alreadySent, sent: false };
  try {
    await sendDiscordMessages(orgId, messages, roleIds);
  } catch (e) {
    await release(orgId, [...claimed]);
    throw e;
  }
  return { dedupeKeys: [...keys], messages, alreadySent, sent: true };
}

// ---------------------------------------------------------------------------
// 一個組織
// ---------------------------------------------------------------------------

export function reminderKey(expenseId: number, chargeDate: string): string {
  return `reminder:${expenseId}:${chargeDate}`;
}

export function recapKey(period: string): string {
  return `recap:${period}`;
}

/** 扣款日在 [today, today + reminderDays] 內的 fixed 固定支出。 */
function dueReminders(
  expenses: readonly RecurringExpense[],
  today: string,
  reminderDays: number,
  lastMonthTxns: readonly LedgerTransaction[],
): ReminderItem[] {
  const horizon = addDaysYmd(today, reminderDays);
  const lastMonth = assignTransactions(expenses, lastMonthTxns);
  const items: ReminderItem[] = [];
  for (const e of expenses) {
    const chargeDate = nextChargeDate(e, today);
    if (chargeDate === null || chargeDate > horizon) continue;
    items.push({
      expenseId: e.id,
      name: e.name,
      chargeDate,
      paymentMethodLabel: e.paymentMethodLabel,
      expectedAccountName: e.expectedAccountName,
      lastMonth: sumByCurrency(lastMonth.get(e.id) ?? []),
      expected:
        e.expectedAmount !== null && e.currency ? { amount: e.expectedAmount, currency: e.currency } : null,
      billingUrl: e.billingUrl,
    });
  }
  return items;
}

/** 一種通知失敗：Discord 的錯誤 sendDiscordMessages 已經記過、整合不可用時狀態本身就說明了，這裡只補記本地失敗（讀 DB…）。 */
async function recordLocalFailure(orgId: string, e: unknown, dryRun: boolean): Promise<void> {
  if (dryRun || e instanceof DiscordApiError || e instanceof IntegrationUnavailableError) return;
  await recordSyncFailure(orgId, "discord", `通知失敗：${errorMessage(e)}`).catch(() => undefined);
}

async function notifyOrg(
  orgId: string,
  rawConfig: IntegrationConfig,
  now: Date,
  opts: BillingNotifyOptions,
): Promise<OrgNotifyResult> {
  const dryRun = opts.dryRun ?? false;
  const kinds = new Set(opts.kinds ?? ["reminder", "recap"]);
  const config = parseDiscordConfig(rawConfig);
  const today = taipeiDate(now);
  const lastPeriod = previousPeriod(today.slice(0, 7));
  const roleIds = config.mentionRoleId ? [config.mentionRoleId] : [];
  const render = { mentionRoleId: config.mentionRoleId, appUrl: publicBaseUrl() };
  const result: OrgNotifyResult = { organizationId: orgId, ok: true, error: null, today, config, reminders: null, recap: null };
  const errors: string[] = [];
  // webhook 不見了或整合被關掉之後，後面的步驟一定也會失敗，不必再試、也不必重複同一個錯誤。
  let unavailable = false;
  // 提醒與回顧各自 try/catch：回顧失敗不該讓已經發出去的提醒從結果裡消失。
  const step = async (fn: () => Promise<void>) => {
    if (unavailable) return;
    try {
      await fn();
    } catch (e) {
      errors.push(errorMessage(e));
      unavailable = e instanceof DiscordWebhookGoneError || e instanceof IntegrationUnavailableError;
      await recordLocalFailure(orgId, e, dryRun);
    }
  };

  let expenses: RecurringExpense[] = [];
  const txnsByPeriod = new Map<string, Promise<LedgerTransaction[]>>();
  const txnsFor = (period: string) => {
    if (!txnsByPeriod.has(period)) txnsByPeriod.set(period, listLedgerTransactionsForPeriod(orgId, period));
    return txnsByPeriod.get(period)!;
  };
  await step(async () => {
    expenses = (await listRecurringExpenses(orgId, { activeOnly: true })).map(toRecurringExpense);
  });

  if (kinds.has("reminder") && errors.length === 0) {
    await step(async () => {
      const due = dueReminders(expenses, today, config.reminderDays, expenses.length > 0 ? await txnsFor(lastPeriod) : []);
      if (due.length === 0) return;
      result.reminders = await deliver(
        orgId,
        due.map((d) => reminderKey(d.expenseId, d.chargeDate)),
        (claimed) => renderReminderMessages(due.filter((d) => claimed.has(reminderKey(d.expenseId, d.chargeDate))), render),
        roleIds,
        { dryRun },
      );
    });
  }

  const forced = opts.force?.recapPeriod;
  const recapPeriod = forced ?? (Number(today.slice(8, 10)) >= config.recapDay ? lastPeriod : null);
  if (kinds.has("recap") && recapPeriod && (forced || expenses.length > 0)) {
    await step(async () => {
      const [transactions, advances, needsReviewCount] = await Promise.all([
        txnsFor(recapPeriod),
        listOutstandingAdvances(orgId),
        countTransactions(orgId, { needsReview: true }),
      ]);
      const model = buildRecap({
        period: recapPeriod,
        expenses,
        transactions,
        outstandingAdvances: advances.map((a) => ({
          employeeName: a.settleName,
          txnDate: a.txnDate,
          amount: Number(a.amount),
          currency: a.currency,
        })),
        needsReviewCount,
      });
      const key = recapKey(recapPeriod);
      const outcome = await deliver(
        orgId,
        [key],
        (claimed) => (claimed.has(key) ? renderRecapMessages(model, render) : []),
        roleIds,
        { dryRun, force: Boolean(forced) },
      );
      result.recap = { ...outcome, period: recapPeriod };
    });
  }

  if (errors.length > 0) {
    result.ok = false;
    result.error = errors.join("；");
  }
  return result;
}

function summarize(r: OrgNotifyResult): string | null {
  const parts: string[] = [];
  if (r.reminders?.sent) parts.push(`扣款提醒 ${r.reminders.dedupeKeys.length - r.reminders.alreadySent.length} 筆`);
  if (r.recap?.sent) parts.push(`${r.recap.period} 固定支出回顧`);
  const sent = parts.length > 0 ? `已發送：${parts.join("、")}` : "";
  if (!r.error) return sent || null;
  const failure = `通知失敗：${r.error}`;
  return sent ? `${sent}；${failure}` : failure;
}

/**
 * 跑一輪 Discord 通知。依 organization_id 逐一執行，永遠不丟錯（除了連列出整合都失敗 ——
 * 那代表 DB 不通，讓呼叫端知道）。
 */
export async function runBillingNotifications(
  now: Date = new Date(),
  opts: BillingNotifyOptions = {},
): Promise<BillingNotifyResult> {
  const dryRun = opts.dryRun ?? false;
  return runAsSystem(async () => {
    const startedAt = new Date().toISOString();
    const rows = await getDb()
      .select({ organizationId: orgIntegrations.organizationId, config: orgIntegrations.config })
      .from(orgIntegrations)
      .where(
        and(
          eq(orgIntegrations.provider, "discord"),
          eq(orgIntegrations.enabled, true),
          eq(orgIntegrations.status, "connected"),
          opts.orgId ? eq(orgIntegrations.organizationId, opts.orgId) : undefined,
        ),
      )
      .orderBy(asc(orgIntegrations.organizationId));

    const results: OrgNotifyResult[] = [];
    for (const row of rows) {
      const r = await notifyOrg(row.organizationId, row.config ?? {}, now, opts);
      const summary = dryRun ? null : summarize(r);
      if (summary) await (opts.audit ?? systemAudit)(row.organizationId, summary).catch(() => undefined);
      const detail = summary ? `: ${summary}` : "";
      console.log(`[billing-notify] ${r.organizationId} ${r.ok ? "ok" : "FAILED"}${detail}`);
      results.push(r);
    }
    return { startedAt, finishedAt: new Date().toISOString(), dryRun, results };
  });
}

/**
 * 預覽（MCP preview_billing_notifications 預設行為）：用這個組織目前的 Discord 設定
 * （還沒接 Discord 就用預設值）產生現在會發的扣款提醒，以及指定月份（預設上個月）的回顧。
 * 不搶去重紀錄、不發送，所以接 Discord 之前就能先看回顧長什麼樣子。
 */
export async function previewBillingNotifications(
  orgId: string,
  now: Date = new Date(),
  period?: string,
): Promise<OrgNotifyResult> {
  return runAsSystem(async () => {
    const [row] = await getDb()
      .select({ config: orgIntegrations.config })
      .from(orgIntegrations)
      .where(and(eq(orgIntegrations.organizationId, orgId), eq(orgIntegrations.provider, "discord")))
      .limit(1);
    const recapPeriod = period ?? previousPeriod(taipeiDate(now).slice(0, 7));
    return notifyOrg(orgId, row?.config ?? {}, now, { dryRun: true, force: { recapPeriod } });
  });
}
