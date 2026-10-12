import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { recurringExpenses } from "@/db/schema";
import { listRecurringExpenses, type RecurringExpenseRow } from "@/db/queries";
import { previewBillingNotifications, runBillingNotifications } from "@/lib/billing-notify";
import { nextChargeDate, previousPeriod, toRecurringExpense } from "@/lib/recurring-expenses";
import { canManageOrg, getOrgRole } from "@/lib/session";
import { taipeiDate } from "@/lib/simpany-sync";
import { assertOrgRefs } from "@/lib/vendor-billing/guards";
import {
  assertInOrg,
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

// ---- 固定支出（recurring_expenses）與 Discord 通知 ----
//
// 固定支出 = 公司定期付給廠商的費用（GCP、Neon、LiveKit、Anthropic…）。這裡只是登記
// 「預期什麼時候、用哪個付款方式（哪張卡）扣」，用來在 Discord 提醒與每月回顧 —— 不會付款、
// 不會扣款，也不會碰銀行或卡片。寫入只給 owner / admin（同 web 頁）。

const SCHEDULES = ["fixed", "usage"] as const;
type Schedule = (typeof SCHEDULES)[number];

const NO_MONEY_MOVES =
  "This is bookkeeping metadata only: it records when a vendor is expected to charge and with which payment method, so nothing here pays, charges or moves money.";

const EXPENSE_ROW = rowSchema({
  id: { type: "number" },
  name: { type: "string" },
  partyId: { type: ["number", "null"], description: "Vendor party; see list_parties." },
  partyName: { type: ["string", "null"] },
  matchPattern: {
    type: ["string", "null"],
    description: "| separated, case-insensitive substrings matched against a transaction's party name or description; null = match on name.",
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
  schedule: { type: "string", enum: [...SCHEDULES] },
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
  isActive: { type: "boolean" },
});

const FIELD_PROPS = {
  name: { type: "string", description: "e.g. Google Cloud." },
  partyId: { type: ["number", "null"], description: "Vendor party (list_parties). null clears it on update." },
  matchPattern: {
    type: ["string", "null"],
    description:
      "| separated, case-insensitive substrings; a ledger transaction whose party name or description contains any part counts as this expense (e.g. 'google*cloud|gcp'; '*' is literal). Omit/null to match on name.",
  },
  paymentMethodId: {
    type: ["number", "null"],
    description: "Expected payment method (list_payment_methods). The ledger account it settles from is the expected paying account.",
  },
  schedule: {
    type: "string",
    enum: [...SCHEDULES],
    description: "fixed = charged on a calendar date (needs anchorDate); usage = prepaid top-ups / usage billing with no fixed date.",
  },
  anchorDate: {
    type: ["string", "null"],
    description: "YYYY-MM-DD, the first (or any known) charge date. Repeats every intervalMonths, day clamped to month end.",
  },
  intervalMonths: { type: "number", description: "1–36; default 1." },
  expectedAmount: { type: ["number", "null"], description: "Shown in reminders when last month has no match." },
  currency: { type: ["string", "null"], description: "3-letter code; required with expectedAmount (default TWD)." },
  billingUrl: { type: ["string", "null"], description: "Vendor billing console link (http/https)." },
  note: { type: ["string", "null"] },
  isActive: { type: "boolean", description: "Inactive expenses get no reminders and are left out of the recap." },
};

type ExpenseColumns = {
  name: string;
  partyId: number | null;
  matchPattern: string | null;
  paymentMethodId: number | null;
  schedule: Schedule;
  anchorDate: string | null;
  intervalMonths: number;
  expectedAmount: string | null;
  currency: string | null;
  billingUrl: string | null;
  note: string | null;
  isActive: boolean;
};

function toView(r: RecurringExpenseRow, today: string) {
  return {
    id: r.id,
    name: r.name,
    partyId: r.partyId,
    partyName: r.partyName,
    matchPattern: r.matchPattern,
    paymentMethodId: r.paymentMethodId,
    paymentMethodLabel: r.paymentMethodLabel,
    paymentMethodLast4: r.paymentMethodLast4,
    expectedAccountId: r.expectedAccountId,
    expectedAccountName: r.expectedAccountName,
    schedule: r.schedule,
    anchorDate: r.anchorDate,
    intervalMonths: r.intervalMonths,
    nextChargeDate: nextChargeDate(toRecurringExpense(r), today),
    expectedAmount: r.expectedAmount,
    currency: r.currency,
    billingUrl: r.billingUrl,
    note: r.note,
    isActive: r.isActive,
  };
}

async function viewOf(orgId: string, id: number) {
  const row = (await listRecurringExpenses(orgId)).find((r) => r.id === id);
  if (!row) throw new Error(`Recurring expense ${id} not found in your organization.`);
  return toView(row, taipeiDate());
}

async function requireManager(orgId: string, ctx: ToolContext): Promise<void> {
  if (!canManageOrg(await getOrgRole(orgId, ctx.userId))) {
    throw new Error("只有組織的擁有者或管理員可以修改固定支出或發送 Discord 通知，請找 owner 或 admin 操作。");
  }
}

/**
 * 參數 → 欄位。key 沒帶 = 沿用 base（更新時是現有值）；明確傳 null = 清掉。
 * optString / optNumber 會把 null 跟「沒帶」都收斂成 undefined，所以 null 要先攔。
 */
function mergeColumns(args: Record<string, unknown>, base: ExpenseColumns): ExpenseColumns {
  const pick = <T>(key: string, parse: () => T, current: T | null): T | null => {
    if (!(key in args)) return current;
    if (args[key] === null) return null;
    return parse();
  };
  const schedule = optString(args, "schedule") ?? base.schedule;
  if (!SCHEDULES.includes(schedule as Schedule)) throw new Error(`"schedule" must be one of: ${SCHEDULES.join(", ")}.`);
  const expectedAmount = pick("expectedAmount", () => requireNumber(args, "expectedAmount").toString(), base.expectedAmount);
  const currency = pick("currency", () => optString(args, "currency")?.toUpperCase() ?? null, base.currency);
  return {
    name: optString(args, "name") ?? base.name,
    partyId: pick("partyId", () => requireNumber(args, "partyId"), base.partyId),
    matchPattern: pick("matchPattern", () => optString(args, "matchPattern") ?? null, base.matchPattern),
    paymentMethodId: pick("paymentMethodId", () => requireNumber(args, "paymentMethodId"), base.paymentMethodId),
    schedule: schedule as Schedule,
    anchorDate: pick("anchorDate", () => optString(args, "anchorDate") ?? null, base.anchorDate),
    intervalMonths: "intervalMonths" in args ? requireNumber(args, "intervalMonths") : base.intervalMonths,
    expectedAmount,
    // 有預估金額才需要幣別；沒指定就用 TWD（同 web 表單的預設）。
    currency: expectedAmount === null ? null : (currency ?? "TWD"),
    billingUrl: pick("billingUrl", () => optString(args, "billingUrl") ?? null, base.billingUrl),
    note: pick("note", () => optString(args, "note") ?? null, base.note),
    isActive: optBoolean(args, "isActive") ?? base.isActive,
  };
}

/** DB CHECK 也會擋，但在這裡先給看得懂的錯誤。 */
function validate(c: ExpenseColumns): ExpenseColumns {
  if (c.schedule === "fixed" && !c.anchorDate) throw new Error('A fixed expense needs "anchorDate" (YYYY-MM-DD).');
  if (c.anchorDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(c.anchorDate)) {
    throw new Error('"anchorDate" must be an ISO date (YYYY-MM-DD).');
  }
  if (!Number.isInteger(c.intervalMonths) || c.intervalMonths < 1 || c.intervalMonths > 36) {
    throw new Error('"intervalMonths" must be an integer from 1 to 36.');
  }
  if (c.currency !== null && !/^[A-Z]{3}$/.test(c.currency)) throw new Error('"currency" must be a 3-letter code.');
  if (c.billingUrl !== null && !/^https?:\/\//i.test(c.billingUrl)) {
    throw new Error('"billingUrl" must start with http:// or https://.');
  }
  return { ...c, anchorDate: c.schedule === "fixed" ? c.anchorDate : null };
}

function assertRefs(orgId: string, c: ExpenseColumns): Promise<void> {
  return assertOrgRefs(orgId, { party: [c.partyId], paymentMethod: [c.paymentMethodId] });
}

const EMPTY: ExpenseColumns = {
  name: "",
  partyId: null,
  matchPattern: null,
  paymentMethodId: null,
  schedule: "fixed",
  anchorDate: null,
  intervalMonths: 1,
  expectedAmount: null,
  currency: null,
  billingUrl: null,
  note: null,
  isActive: true,
};

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
    description: `List the organization's recurring vendor charges (固定支出: GCP, Neon, LiveKit, Anthropic…) with the expected payment method (and the ledger account it settles from) and the next charge date (Asia/Taipei). ${NO_MONEY_MOVES}`,
    inputSchema: {
      type: "object",
      properties: {
        activeOnly: { type: "boolean", description: "Only active ones. Default false." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(EXPENSE_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const today = taipeiDate();
      const rows = await listRecurringExpenses(orgId, { activeOnly: optBoolean(args, "activeOnly") ?? false });
      return listResult(rows.map((r) => toView(r, today)));
    },
  },

  create_recurring_expense: {
    description: `Register a recurring vendor charge (owner/admin only). ${NO_MONEY_MOVES} Resolve partyId with list_parties and paymentMethodId with list_payment_methods first.`,
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
      const columns = validate(mergeColumns(args, EMPTY));
      if (!columns.name) throw new Error('"name" is required.');
      await assertRefs(orgId, columns);
      const [row] = await getDb()
        .insert(recurringExpenses)
        .values({ organizationId: orgId, ...columns })
        .returning({ id: recurringExpenses.id });
      return viewOf(orgId, row.id);
    },
  },

  update_recurring_expense: {
    description: `Update a recurring vendor charge (owner/admin only; only the fields you pass; null clears an optional field). ${NO_MONEY_MOVES}`,
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
      const db = getDb();
      const where = and(
        eq(recurringExpenses.organizationId, orgId),
        eq(recurringExpenses.id, id),
        isNull(recurringExpenses.deletedAt),
      );
      const [current] = await db.select().from(recurringExpenses).where(where).limit(1);
      if (!current) throw new Error(`Recurring expense ${id} not found in your organization.`);
      const base: ExpenseColumns = { ...current, schedule: current.schedule === "usage" ? "usage" : "fixed" };
      const columns = validate(mergeColumns(args, base));
      await assertRefs(orgId, columns);
      await db.update(recurringExpenses).set({ ...columns, updatedAt: new Date().toISOString() }).where(where);
      return viewOf(orgId, id);
    },
  },

  delete_recurring_expense: {
    description: `Delete a recurring vendor charge (owner/admin only; soft delete). ${NO_MONEY_MOVES}`,
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({ deleted: { type: "boolean" }, id: { type: "number" } }),
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      await requireManager(orgId, ctx);
      const db = getDb();
      await assertInOrg(db, recurringExpenses, id, orgId, "Recurring expense");
      await db
        .update(recurringExpenses)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(recurringExpenses.organizationId, orgId), eq(recurringExpenses.id, id)));
      return { deleted: true, id };
    },
  },

  preview_billing_notifications: {
    description: `Render the Discord messages for recurring vendor charges: the charge reminders due now and the monthly recap (last month's matched spend grouped by the account/card that actually paid, missing charges, payments from an unexpected account, unreimbursed employee advances, imported rows awaiting review). Default is a dry run that posts nothing and works even before Discord is connected. send=true (owner/admin, Discord integration must be on) posts the recap for that period to the team's Discord channel right now, even if it was already posted; reminders are only ever posted by the daily 06:00 Asia/Taipei run. Show the user the preview and get a yes before calling with send=true. These are notifications only; nothing here pays, charges or moves money.`,
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
