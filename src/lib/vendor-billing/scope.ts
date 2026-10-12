import type { IntegrationConfig } from "@/lib/integrations/types";

// Azure / GCP 計費整合在 org_integrations.config 裡的「計費範圍」。client 與 server 都會
// import 這支（設定頁、同步、MCP），所以只能有純函式與型別，不能碰 DB 或 fetch。
//
// 為什麼要有範圍：同一個外部計費範圍裡可能混著不同組織的東西 —— Azure 的 MCA billing
// account 同時有公司的 billing profile 與個人的 profile；一個 GCP 身分看得到兩家公司的
// billing account。所以每個組織要自己勾「哪些是我的」，同步只碰勾選的那些；沒勾任何一個
// 就什麼都不同步。
//
//   Azure  config.billingAccountId: string        ← 連接時填（只有 profile 層級角色時列不出來）
//          config.billingProfileIds: string[]   ← 勾選（profile name）
//          config.discovered: AzureDiscoveredProfile[]   ← testConnection / 同步時發現的候選
//   GCP    config.billingAccountIds: string[]   ← 勾選（billing account id，例如 01CBC3-343D16-C6AE22）
//          config.discovered: GcpDiscoveredAccount[]
//          config.bigQueryExport: { projectId, dataset } | 沒有 ← 選填，有才讀費用；資料表
//          `gcp_billing_export_v1_<帳號 id，- 換成 _>` 自動偵測（一個 billing account 一張表）

export type AzureDiscoveredProfile = {
  /** Billing account name（例如 `8369e875-…:09d0934e-…_2019-05-31`）。 */
  billingAccountId: string;
  billingAccountName: string | null;
  /** Billing profile name（例如 `eb362146-…` 或 `R3XJ-XNP5-BG7-PGB`）；勾選用的 id。 */
  id: string;
  displayName: string;
};

export type GcpDiscoveredAccount = {
  /** 不含 `billingAccounts/` 前綴的 id。 */
  id: string;
  displayName: string;
  /** 經銷商的 master billing account id；有值 = 經銷商子帳號。 */
  masterBillingAccount: string | null;
  currencyCode: string | null;
  open: boolean;
};

export type BigQueryExport = { projectId: string; dataset: string };

export type AzureScope = {
  billingAccountId: string | null;
  billingProfileIds: string[];
  discovered: AzureDiscoveredProfile[];
  discoveredAt: string | null;
};

export type GcpScope = {
  billingAccountIds: string[];
  discovered: GcpDiscoveredAccount[];
  discoveredAt: string | null;
  bigQueryExport: BigQueryExport | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const x of v) {
    const s = str(x);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object")
    : [];
}

// BigQuery 的識別字不能用參數帶，只能拼進 SQL —— 所以嚴格限制字元，認不得就當沒設定。
const BQ_PROJECT_RE = /^[a-z][a-z0-9.:-]{4,61}[a-z0-9]$/;
const BQ_DATASET_RE = /^\w{1,1024}$/;
const BQ_TABLE_RE = /^[\w$-]{1,1024}$/;
const EXPORT_TABLE_PREFIX = "gcp_billing_export_v1_";

export function isValidBigQueryExport(v: Partial<BigQueryExport> | null | undefined): v is BigQueryExport {
  return Boolean(
    v &&
      typeof v.projectId === "string" &&
      typeof v.dataset === "string" &&
      BQ_PROJECT_RE.test(v.projectId) &&
      BQ_DATASET_RE.test(v.dataset),
  );
}

export function isValidBigQueryTable(v: string): boolean {
  return BQ_TABLE_RE.test(v);
}

/** 標準用量費用 export 的資料表名：`gcp_billing_export_v1_01CBC3_343D16_C6AE22`。 */
export function exportTableName(billingAccountId: string): string {
  return `${EXPORT_TABLE_PREFIX}${billingAccountId.replaceAll("-", "_")}`;
}

/**
 * 從 dataset 的資料表清單挑出每個 billing account 的標準 export 表（不含 resource 明細表）。
 * 回傳 billing account id → 資料表名。
 */
export function matchExportTables(tableNames: readonly string[], billingAccountIds: readonly string[]): Map<string, string> {
  const have = new Set(tableNames.filter((t) => t.startsWith(EXPORT_TABLE_PREFIX)));
  const out = new Map<string, string>();
  for (const id of billingAccountIds) {
    const name = exportTableName(id);
    if (have.has(name)) out.set(id, name);
  }
  return out;
}

/**
 * config 裡的 BigQuery export 設定。優先讀 `bigQueryExport` 物件；沒有就看連接 Sheet 的兩個
 * 平鋪欄位（bigQueryProjectId / bigQueryDataset）。不合法 → null。
 */
export function parseBigQueryExport(config: IntegrationConfig | null | undefined): BigQueryExport | null {
  const c = config ?? {};
  // 設定頁存過（包括清空 = null）就以它為準，不再看連接時的平鋪欄位
  if (Object.prototype.hasOwnProperty.call(c, "bigQueryExport")) {
    const o = c.bigQueryExport && typeof c.bigQueryExport === "object" ? (c.bigQueryExport as Record<string, unknown>) : {};
    const v = { projectId: str(o.projectId) ?? "", dataset: str(o.dataset) ?? "" };
    return isValidBigQueryExport(v) ? v : null;
  }
  const flat = {
    projectId: str(c.bigQueryProjectId) ?? "",
    dataset: str(c.bigQueryDataset) ?? "",
  };
  return isValidBigQueryExport(flat) ? flat : null;
}

export function parseAzureScope(config: IntegrationConfig | null | undefined): AzureScope {
  const c = config ?? {};
  const discovered = arr(c.discovered).flatMap((o) => {
    const billingAccountId = str(o.billingAccountId);
    const id = str(o.id);
    if (!billingAccountId || !id) return [];
    return [
      {
        billingAccountId,
        billingAccountName: str(o.billingAccountName),
        id,
        displayName: str(o.displayName) ?? id,
      },
    ];
  });
  return {
    billingAccountId: str(c.billingAccountId),
    billingProfileIds: strList(c.billingProfileIds),
    discovered,
    discoveredAt: str(c.discoveredAt),
  };
}

export function parseGcpScope(config: IntegrationConfig | null | undefined): GcpScope {
  const c = config ?? {};
  const discovered = arr(c.discovered).flatMap((o) => {
    const id = str(o.id);
    if (!id) return [];
    return [
      {
        id,
        displayName: str(o.displayName) ?? id,
        masterBillingAccount: str(o.masterBillingAccount),
        currencyCode: str(o.currencyCode),
        open: o.open !== false,
      },
    ];
  });
  return {
    billingAccountIds: strList(c.billingAccountIds),
    discovered,
    discoveredAt: str(c.discoveredAt),
    bigQueryExport: parseBigQueryExport(c),
  };
}

/**
 * 只留下勾選範圍內的項目。範圍是空的 → 回空陣列（什麼都不同步），**不是**全部。
 */
export function filterAllowlisted<T extends { id: string }>(items: readonly T[], allowlist: readonly string[]): T[] {
  if (allowlist.length === 0) return [];
  const allowed = new Set(allowlist);
  return items.filter((x) => allowed.has(x.id));
}

/**
 * 儲存勾選時的清理：只接受「這次發現過的候選」裡的 id（去重、保持候選的順序）。
 * 使用者（或偽造的請求）不能把沒發現過的 id 塞進範圍。
 */
export function sanitizeAllowlist(input: unknown, candidates: readonly { id: string }[]): string[] {
  const wanted = new Set(strList(input));
  return candidates.map((c) => c.id).filter((id, i, all) => wanted.has(id) && all.indexOf(id) === i);
}
