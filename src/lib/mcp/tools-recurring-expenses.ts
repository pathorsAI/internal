import { previewBillingNotifications, runBillingNotifications } from "@/lib/billing-notify";
import { previousPeriod, type PeriodStatus } from "@/lib/recurring-expenses";
import { canManageOrg, getOrgRole } from "@/lib/session";
import { taipeiDate } from "@/lib/simpany-sync";
import { normalizeBillingAccountInput } from "@/lib/vendor-billing/inputs";
import {
  listBillingAccounts,
  listRecurringAccounts,
  recurringStatuses,
  removeRecurringSchedule,
  upsertBillingAccount,
  type RecurringAccountRow,
} from "@/lib/vendor-billing/service";
import {
  listResult,
  listSchema,
  optBoolean,
  optString,
  ORG_ARG,
  requireNumber,
  resolveOrg,
  rowSchema,
  type JsonSchemaObject,
  type ToolContext,
  type ToolDef,
} from "./shared";
import { auditIntegrationCall, requireIntegrationForTool } from "./tools-integrations";
import { PERIOD_STATUS, SCHEDULE_INPUT_PROPS } from "./tools-vendor-billing";

// ---- 固定支出（相容層）與 Discord 通知 ----
//
// 固定支出已經併進廠商計費帳戶（migrations/0039）：一個廠商計費帳戶就是一筆固定支出，
// 排程欄位在帳戶上。這裡的 *_recurring_expense 工具留著給既有的呼叫端，內部全部走
// src/lib/vendor-billing/service.ts；回傳與接收的 id 都是廠商計費帳戶 id。
// 舊的 recurring_expenses 表與 match_pattern 字串比對都停用了 —— 交易歸屬看外鍵。
// 這裡只是登記「預期什麼時候、用哪個付款方式扣」，不會付款、不會扣款。寫入只給 owner / admin。

const NO_MONEY_MOVES =
  "This is bookkeeping metadata only: it records when a vendor is expected to charge and with which payment method, so nothing here pays, charges or moves money.";

const MERGED =
  "已併入廠商計費帳戶（vendor billing account），請改用 upsert_vendor_billing_account / list_vendor_billing_accounts. Compatibility shim: ids are vendor billing account ids.";

const EXPENSE_ROW = rowSchema({
  id: { type: "number", description: "Vendor billing account id (get_vendor_billing_account)." },
  name: { type: "string" },
  provider: { type: "string" },
  source: { type: "string", enum: ["manual", "synced"] },
  partyId: { type: ["number", "null"], description: "Vendor party; see list_parties." },
  partyName: { type: ["string", "null"] },
  matchPattern: {
    type: ["string", "null"],
    description:
      "Deprecated and ignored: the old keyword match migrated from recurring_expenses, kept for reference only. Transactions now belong to the account through vendor_billing_account_id / matched invoices / the account's party.",
  },
  paymentMethodId: { type: ["number", "null"], description: "Expected payment method; see list_payment_methods." },
  paymentMethodLabel: { type: ["string", "null"], description: "Read-only; edit it on the payment method." },
  paymentMethodLast4: { type: ["string", "null"], description: "Read-only; edit it on the payment method." },
  expectedAccountId: {
    type: ["number", "null"],
    description:
      "Ledger account the payment method settles from (read-only; set settlesFromAccountId with upsert_payment_method). The monthly recap flags charges paid from any other account.",
  },
  expectedAccountName: { type: ["string", "null"] },
  schedule: { type: "string", enum: ["fixed", "usage"] },
  anchorDate: { type: ["string", "null"], description: "YYYY-MM-DD; a known charge date (fixed only)." },
  intervalMonths: { type: "number" },
  nextChargeDate: {
    type: ["string", "null"],
    description: "YYYY-MM-DD on the Asia/Taipei calendar; null for usage-based expenses.",
  },
  expectedAmount: { type: ["string", "null"], description: "Decimal as a string." },
  currency: { type: ["string", "null"] },
  billingUrl: { type: ["string", "null"] },
  note: { type: ["string", "null"] },
  isActive: { type: "boolean", description: "Account status is active (false = closed / gone from the platform)." },
  periodStatus: PERIOD_STATUS,
});

const FIELD_PROPS = {
  name: { type: "string", description: "Account display name, e.g. Google Cloud." },
  partyId: { type: ["number", "null"], description: "Vendor party (list_parties). null clears it on update." },
  matchPattern: { type: ["string", "null"], description: "Deprecated and ignored (no more keyword matching)." },
  paymentMethodId: {
    type: ["number", "null"],
    description: "Expected payment method (list_payment_methods). The ledger account it settles from is the expected paying account.",
  },
  ...SCHEDULE_INPUT_PROPS,
  schedule: {
    type: "string",
    enum: ["fixed", "usage"],
    description: "fixed = charged on a calendar date (needs anchorDate); usage = prepaid top-ups / usage billing with no fixed date.",
  },
  note: { type: ["string", "null"] },
  isActive: { type: "boolean", description: "false = close the account: no reminders and left out of the recap (manual accounts only)." },
};

function toView(r: RecurringAccountRow, statuses: ReadonlyMap<number, PeriodStatus>) {
  const status = statuses.get(r.id) ?? null;
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    source: r.source,
    partyId: r.partyId,
    partyName: r.partyName,
    matchPattern: r.legacyMatchPattern,
    paymentMethodId: r.paymentMethodId,
    paymentMethodLabel: r.paymentMethodLabel,
    paymentMethodLast4: r.paymentMethodLast4,
    expectedAccountId: r.expectedAccountId,
    expectedAccountName: r.expectedAccountName,
    schedule: r.schedule,
    anchorDate: r.schedule === "fixed" ? r.anchorDate : null,
    intervalMonths: r.schedule === "fixed" ? r.intervalMonths : 1,
    nextChargeDate: status?.nextChargeDate ?? null,
    expectedAmount: r.expectedAmount === null ? null : r.expectedAmount.toString(),
    currency: r.currency,
    billingUrl: r.billingUrl,
    note: r.note,
    isActive: r.status === "active",
    periodStatus: status,
  };
}

async function viewOf(orgId: string, id: number) {
  const [row] = await listRecurringAccounts(orgId, { ids: [id] });
  if (!row) throw new Error(`Recurring expense (vendor billing account) ${id} not found in your organization.`);
  const statuses = await recurringStatuses(orgId, taipeiDate());
  return toView(row, statuses);
}

async function requireManager(orgId: string, ctx: ToolContext): Promise<void> {
  if (!canManageOrg(await getOrgRole(orgId, ctx.userId))) {
    throw new Error("只有組織的擁有者或管理員可以修改固定支出或發送 Discord 通知，請找 owner 或 admin 操作。");
  }
}

/** 舊參數 → 廠商計費帳戶的輸入（PATCH 語意：沒帶 = 不動；null = 清掉）。matchPattern 不再使用，丟掉。 */
function toAccountInput(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const map: Record<string, string> = {
    id: "id",
    name: "displayName",
    partyId: "partyId",
    paymentMethodId: "paymentMethodId",
    schedule: "schedule",
    anchorDate: "anchorDate",
    intervalMonths: "intervalMonths",
    expectedAmount: "expectedAmount",
    currency: "currency",
    billingUrl: "billingUrl",
    note: "note",
  };
  for (const [from, to] of Object.entries(map)) if (args[from] !== undefined) out[to] = args[from];
  const active = optBoolean(args, "isActive");
  if (active !== undefined) out.status = active ? "active" : "closed";
  return out;
}

const OUTCOME = {
  type: "object",
  properties: {
    dedupeKeys: { type: "array", items: { type: "string" } },
    messages: { type: "array", items: { type: "string" }, description: "Discord markdown, each ≤ 2000 characters." },
    alreadySent: { type: "array", items: { type: "string" }, description: "Keys that were already delivered earlier." },
    sent: { type: "boolean" },
  },
  required: ["dedupeKeys", "messages", "alreadySent", "sent"],
  additionalProperties: true,
};

const PREVIEW_RESULT: JsonSchemaObject = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["preview", "sent"] },
    organizationId: { type: "string" },
    ok: { type: "boolean" },
    error: { type: ["string", "null"] },
    today: { type: "string", description: "YYYY-MM-DD, Asia/Taipei." },
    config: rowSchema({
      mentionRoleId: { type: ["string", "null"] },
      recapDay: { type: "number" },
      reminderDays: { type: "number" },
    }),
    reminders: { anyOf: [OUTCOME, { type: "null" }], description: "Charge reminders due now; null when none." },
    recap: {
      anyOf: [
        { ...OUTCOME, properties: { ...OUTCOME.properties, period: { type: "string" } } },
        { type: "null" },
      ],
    },
  },
  required: ["mode", "organizationId", "ok", "error", "today", "config", "reminders", "recap"],
  additionalProperties: false,
};

export const recurringExpenseTools: Record<string, ToolDef> = {
  list_recurring_expenses: {
    description: `${MERGED} Lists vendor billing accounts that have a schedule (固定支出: GCP, Neon, LiveKit, Anthropic…) with the expected payment method (and the ledger account it settles from), the next charge date (Asia/Taipei) and this period's paid status. ${NO_MONEY_MOVES}`,
    inputSchema: {
      type: "object",
      properties: {
        activeOnly: { type: "boolean", description: "Only active accounts. Default false." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(EXPENSE_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const rows = await listRecurringAccounts(
        orgId,
        optBoolean(args, "activeOnly") ? { statuses: ["active"] } : {},
      );
      const statuses = await recurringStatuses(orgId, taipeiDate());
      return listResult(rows.map((r) => toView(r, statuses)));
    },
  },

  create_recurring_expense: {
    description: `${MERGED} Creates a manual vendor billing account (provider other) with a schedule (owner/admin only). ${NO_MONEY_MOVES} Resolve partyId with list_parties and paymentMethodId with list_payment_methods first.`,
    inputSchema: {
      type: "object",
      properties: { ...FIELD_PROPS, ...ORG_ARG },
      required: ["name", "schedule"],
      additionalProperties: false,
    },
    outputSchema: EXPENSE_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireManager(orgId, ctx);
      const patch = normalizeBillingAccountInput({ ...toAccountInput(args), provider: "other" });
      if (!patch.displayName) throw new Error('"name" is required.');
      if (!patch.schedule) throw new Error('"schedule" must be fixed or usage.');
      const r = await upsertBillingAccount(orgId, patch);
      return viewOf(orgId, r.id);
    },
  },

  update_recurring_expense: {
    description: `${MERGED} Updates the vendor billing account's schedule and details (owner/admin only; only the fields you pass; null clears an optional field). For accounts synced from Azure/GCP, name and isActive cannot be changed. ${NO_MONEY_MOVES}`,
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...FIELD_PROPS, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: EXPENSE_ROW,
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      await requireManager(orgId, ctx);
      const [current] = await listBillingAccounts(orgId, { ids: [id] });
      if (!current) throw new Error(`Recurring expense (vendor billing account) ${id} not found in your organization.`);
      const patch = normalizeBillingAccountInput({ ...toAccountInput(args), id });
      if (patch.schedule === null) throw new Error('"schedule" must be fixed or usage (use delete_recurring_expense to stop tracking it).');
      // 原本沒有排程的帳戶，透過這支工具更新時至少要給週期，不然它還是不算固定支出、回傳不出來。
      if (current.schedule === null && patch.schedule === undefined) {
        throw new Error(`Account ${id} has no schedule yet; pass "schedule" (fixed or usage).`);
      }
      await upsertBillingAccount(orgId, patch);
      return viewOf(orgId, id);
    },
  },

  delete_recurring_expense: {
    description: `${MERGED} Stops treating the account as a recurring expense (owner/admin only): a manual account is soft-deleted (like the old delete); an account synced from Azure/GCP cannot be deleted, so its schedule is cleared instead (no more reminders / recap). ${NO_MONEY_MOVES}`,
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      deleted: { type: "boolean", description: "true = the manual account was soft-deleted; false = only its schedule was cleared." },
      id: { type: "number" },
    }),
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      await requireManager(orgId, ctx);
      const outcome = await removeRecurringSchedule(orgId, id);
      return { deleted: outcome === "deleted", id };
    },
  },

  preview_billing_notifications: {
    description: `Render the Discord messages for recurring vendor charges (vendor billing accounts with a schedule): the charge reminders due now and the monthly recap (last month's spend on those accounts grouped by the account/card that actually paid, missing charges, payments from an unexpected account, unreimbursed employee advances, imported rows awaiting review). Default is a dry run that posts nothing and works even before Discord is connected. send=true (owner/admin, Discord integration must be on) posts the recap for that period to the team's Discord channel right now, even if it was already posted; reminders are only ever posted by the daily 06:00 Asia/Taipei run. Show the user the preview and get a yes before calling with send=true. These are notifications only; nothing here pays, charges or moves money.`,
    inputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "YYYY-MM for the recap. Default: last month (Asia/Taipei)." },
        send: { type: "boolean", description: "Post the recap to Discord now. Default false (preview only)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: PREVIEW_RESULT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const period = optString(args, "period");
      if (period !== undefined && !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
        throw new Error('"period" must be YYYY-MM.');
      }
      if (!(optBoolean(args, "send") ?? false)) {
        return { mode: "preview", ...(await previewBillingNotifications(orgId, new Date(), period)) };
      }
      await requireManager(orgId, ctx);
      await requireIntegrationForTool(orgId, "discord");
      const run = await runBillingNotifications(new Date(), {
        orgId,
        kinds: ["recap"],
        force: { recapPeriod: period ?? previousPeriod(taipeiDate().slice(0, 7)) },
        audit: (auditOrgId, summary) => auditIntegrationCall(ctx, auditOrgId, "discord", "create", `${summary}（手動發送）`),
      });
      const result = run.results[0];
      if (!result) throw new Error("Discord 整合目前不可用，請 owner 或 admin 到 設定 › 整合 確認。");
      return { mode: "sent", ...result };
    },
  },
};
