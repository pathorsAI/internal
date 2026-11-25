import type { UsageChannel } from "./record";
import { DASHBOARD_ROUTES } from "./routes";

/**
 * 功能使用狀況的彙總（純函式，src/db/usage.ts 撈資料、這裡算）。
 *
 * 兩個來源併在一起：
 * - usage_events：上線後每一次頁面載入與工具呼叫（讀取也算）。
 * - activity_log：上線前的寫入紀錄（稽核用，永久保存）。只取「該類型第一筆 usage_events
 *   之前」的部分，上線後同一個動作兩邊都有紀錄，不重複算。
 *   - MCP／AI／API／聊天的寫入：summary 是工具名稱（或整合工具自己的說明），換回工具名稱。
 *   - 網頁的寫入：只有 entity_type，換成負責那種資料的頁面（ENTITY_PAGE）。
 *   - system（排程）不是人用的，不算。
 */

export type FeatureKind = "page" | "tool";
export type UsageStatus = "never" | "idle" | "active";

/** 一個 (功能, 管道, 使用者) 的彙總列。 */
export type UsageAggregateRow = {
  kind: FeatureKind;
  feature: string;
  channel: UsageChannel;
  userId: string | null;
  total: number;
  last30: number;
  lastAt: string;
};

/** activity_log 的彙總列（還沒換成功能）。 */
export type ActivityAggregateRow = {
  channel: string;
  entityType: string;
  summary: string | null;
  userId: string | null;
  total: number;
  last30: number;
  lastAt: string;
};

export type FeatureUsage = {
  kind: FeatureKind;
  feature: string;
  lastAt: string | null;
  last30: number;
  users30: number;
  total: number;
  /** 全部期間各管道的次數，取最多的當「主要管道」。 */
  primaryChannel: UsageChannel | null;
  status: UsageStatus;
};

/** 網頁寫入的 entity_type → 負責那種資料的頁面。對不上的不算（不亂猜）。 */
export const ENTITY_PAGE: Record<string, string> = {
  transaction: "/dashboard/transactions",
  party: "/dashboard/parties",
  category: "/dashboard/categories",
  bank_account: "/dashboard/bank-accounts",
  employee: "/dashboard/employees",
  employee_bank_account: "/dashboard/employees",
  invoice: "/dashboard/invoices",
  reconciliation: "/dashboard/reconciliation",
  project: "/dashboard/projects",
  subscription: "/dashboard/subscriptions",
  subscription_period: "/dashboard/subscriptions",
  contract: "/dashboard/contracts",
  document: "/dashboard/contracts",
  billing_item: "/dashboard/billing",
  payroll_run: "/dashboard/payroll",
  payslip: "/dashboard/payroll",
  reimbursement: "/dashboard/advances",
  vendor_billing_account: "/dashboard/vendor-billing",
  payment_method: "/dashboard/vendor-billing",
  vendor_invoice: "/dashboard/vendor-billing",
  integration: "/dashboard/settings/integrations",
  calendar: "/dashboard/settings/integrations",
  api_key: "/dashboard/settings/api",
  organization: "/dashboard/settings",
  accounting_settings: "/dashboard/settings/accounting",
  gl_account: "/dashboard/settings/accounting",
  fx_rate: "/dashboard/accounting/fx",
  fixed_asset: "/dashboard/accounting/assets",
  fiscal_period: "/dashboard/accounting/periods",
  journal_entry: "/dashboard/accounting",
  member: "/dashboard/members",
  ai_rule: "/dashboard/ai/rules",
};

/**
 * 整合工具自己寫的 summary（例如「wise: 列出 5 個餘額」）不是工具名稱，照固定的開頭換回來。
 * 只列 activity_log 裡真的出現過的格式（src/lib/mcp/tools-wise.ts、tools-simpany.ts、tools-integrations.ts）。
 */
const SUMMARY_TOOL_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/^issue draft #/, "simpany_issue_invoice"],
  [/^salary sync /, "simpany_sync_salary_declarations"],
  [/^手動執行自動同步/, "run_integration_sync"],
  [/^列出 \d+ 個餘額/, "wise_list_balances"],
  [/^同步試算/, "wise_sync_transactions"],
];

/** activity_log 的 summary → 工具名稱；換不出來回 null。 */
export function toolFromSummary(summary: string | null, knownTools: ReadonlySet<string>): string | null {
  if (!summary) return null;
  const s = summary
    .replace(/^API key「.*?」：?/, "")
    .replace(/（失敗：[\s\S]*$/, "")
    .trim();
  if (knownTools.has(s)) return s;
  const body = s.replace(/^[a-z_]+: /, "");
  for (const [pattern, tool] of SUMMARY_TOOL_PATTERNS) {
    if (pattern.test(body) && knownTools.has(tool)) return tool;
  }
  return null;
}

const TOOL_CHANNELS = new Set(["mcp", "ai", "api", "line", "whatsapp"]);

/** activity_log 的列換成 usage 的列；對不上功能的丟掉。 */
export function activityToUsage(
  rows: readonly ActivityAggregateRow[],
  knownTools: ReadonlySet<string>,
): UsageAggregateRow[] {
  const out: UsageAggregateRow[] = [];
  for (const r of rows) {
    const base = { userId: r.userId, total: r.total, last30: r.last30, lastAt: r.lastAt };
    if (r.channel === "web") {
      const page = ENTITY_PAGE[r.entityType];
      if (page) out.push({ ...base, kind: "page", feature: page, channel: "web" });
    } else if (TOOL_CHANNELS.has(r.channel)) {
      const tool = toolFromSummary(r.summary, knownTools);
      if (tool) out.push({ ...base, kind: "tool", feature: tool, channel: r.channel as UsageChannel });
    }
  }
  return out;
}

const STATUS_ORDER: Record<UsageStatus, number> = { never: 0, idle: 1, active: 2 };

type Acc = {
  lastAt: string | null;
  last30: number;
  total: number;
  users30: Set<string>;
  channels: Map<UsageChannel, number>;
};

const keyOf = (kind: FeatureKind, feature: string) => `${kind}:${feature}`;

function emptyAcc(): Acc {
  return { lastAt: null, last30: 0, total: 0, users30: new Set(), channels: new Map() };
}

function addRow(a: Acc, r: UsageAggregateRow): void {
  a.total += r.total;
  a.last30 += r.last30;
  if (r.last30 > 0 && r.userId) a.users30.add(r.userId);
  if (!a.lastAt || Date.parse(r.lastAt) > Date.parse(a.lastAt)) a.lastAt = r.lastAt;
  a.channels.set(r.channel, (a.channels.get(r.channel) ?? 0) + r.total);
}

function primaryChannelOf(channels: Map<UsageChannel, number>): UsageChannel | null {
  let primary: UsageChannel | null = null;
  let best = 0;
  for (const [channel, n] of channels) {
    if (n > best) {
      best = n;
      primary = channel;
    }
  }
  return primary;
}

function statusOf(a: Acc): UsageStatus {
  if (!a.lastAt) return "never";
  return a.last30 === 0 ? "idle" : "active";
}

function toFeature(key: string, a: Acc): FeatureUsage {
  const sep = key.indexOf(":");
  return {
    kind: key.slice(0, sep) as FeatureKind,
    feature: key.slice(sep + 1),
    lastAt: a.lastAt,
    last30: a.last30,
    users30: a.users30.size,
    total: a.total,
    primaryChannel: primaryChannelOf(a.channels),
    status: statusOf(a),
  };
}

function compareFeatures(x: FeatureUsage, y: FeatureUsage): number {
  const s = STATUS_ORDER[x.status] - STATUS_ORDER[y.status];
  if (s !== 0) return s;
  if (x.status === "idle") return Date.parse(x.lastAt ?? "") - Date.parse(y.lastAt ?? "");
  if (x.status === "active" && x.last30 !== y.last30) return x.last30 - y.last30;
  if (x.kind !== y.kind) return x.kind === "page" ? -1 : 1;
  return x.feature.localeCompare(y.feature);
}

/**
 * 每個功能（dashboard 每一頁 + 每一支工具）一列；沒有紀錄的也列出來（從未使用）。
 * 排序：從未使用 → 30 天沒人用 → 有在用（次數多的在後面，少的在前面，方便找快沒人用的）。
 * 已經刪掉的頁面或工具不列（usage_events 裡最多留 180 天的舊名字）。
 */
export function buildFeatureUsage(
  rows: readonly UsageAggregateRow[],
  toolNames: readonly string[],
): FeatureUsage[] {
  const acc = new Map<string, Acc>();
  for (const route of DASHBOARD_ROUTES) acc.set(keyOf("page", route), emptyAcc());
  for (const name of toolNames) acc.set(keyOf("tool", name), emptyAcc());
  for (const r of rows) {
    const a = acc.get(keyOf(r.kind, r.feature));
    if (a) addRow(a, r);
  }
  return [...acc].map(([key, a]) => toFeature(key, a)).sort(compareFeatures);
}
