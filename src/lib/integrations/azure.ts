import type { AzureDiscoveredProfile } from "@/lib/vendor-billing/scope";
import {
  clearTokenCache,
  loadTokenCache,
  markNeedsReauth,
  recordSyncFailure,
  recordSyncSuccess,
  requireEnabledIntegration,
  saveTokenCache,
} from "./store";
import type { IntegrationCredentials, IntegrationProvider, IntegrationSummary, TokenCache } from "./types";

/**
 * Azure 計費整合 —— **唯讀**。
 *
 * 憑證是一個 app registration（service principal）：tenantId / clientId / clientSecret，
 * 用 client credentials 換 ARM token。要在 MCA 的 billing profile 指派「Billing profile reader」給
 * 這個 service principal。只有 profile 層級角色時 `GET billingAccounts` 會回 0 筆，所以 billing
 * account id 是連接時要填的非機密設定（config.billingAccountId），從它往下列看得到的 profile。
 *
 * 讀的東西：billing account → billing profile、billing subscription、付款卡（paymentMethodLinks）、
 * 發票，以及 Cost Management 的每月費用。所有請求都經過 `azureFetch()`：
 *   1. `assertAzureReadOnly()` 逐條比對 method + host + path 白名單，不在名單上就丟錯、不發請求；
 *   2. 只有 GET；例外只有兩個明確列出的 POST —— 換 token，與 Cost Management 的 `query`
 *      （它是讀取，只是 API 設計成 POST）。
 * 沒有任何建立、修改、刪除 Azure 資源或付款的程式碼路徑。
 *
 * Secret 與 token 只在 server 記憶體：不進 log、錯誤訊息、回傳值。
 */

export const AZURE_BILLING_API = "2024-04-01";
export const AZURE_COST_API = "2023-11-01";

const ARM_HOST = "management.azure.com";
const LOGIN_HOST = "login.microsoftonline.com";
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PAGES = 50;

// path 片段：billing account / profile 的 name 有冒號、底線、連字號；nextLink 可能已經 %-encode。
const SEG = String.raw`[A-Za-z0-9:_.%-]+`;
const BILLING = String.raw`/providers/Microsoft\.Billing/billingAccounts`;

type Rule = { method: "GET" | "POST"; host: string; path: RegExp };

/** 允許的請求。新增端點只能加在這裡，而且必須是讀取。 */
const RULES: readonly Rule[] = [
  { method: "POST", host: LOGIN_HOST, path: new RegExp(String.raw`^/${SEG}/oauth2/v2\.0/token$`) },
  { method: "GET", host: ARM_HOST, path: new RegExp(`^${BILLING}$`, "i") },
  { method: "GET", host: ARM_HOST, path: new RegExp(`^${BILLING}/${SEG}/billingProfiles$`, "i") },
  {
    method: "GET",
    host: ARM_HOST,
    path: new RegExp(`^${BILLING}/${SEG}/billingProfiles/${SEG}/billingSubscriptions$`, "i"),
  },
  {
    method: "GET",
    host: ARM_HOST,
    path: new RegExp(`^${BILLING}/${SEG}/billingProfiles/${SEG}/paymentMethodLinks$`, "i"),
  },
  { method: "GET", host: ARM_HOST, path: new RegExp(`^${BILLING}/${SEG}/billingProfiles/${SEG}/invoices$`, "i") },
  {
    method: "POST",
    host: ARM_HOST,
    path: new RegExp(
      String.raw`^${BILLING}/${SEG}/billingProfiles/${SEG}/providers/Microsoft\.CostManagement/query$`,
      "i",
    ),
  },
];

/** 不在白名單上的請求一律拒絕 —— 這個整合永遠不得改動 Azure 上的任何東西。 */
export function assertAzureReadOnly(method: string, url: string | URL): void {
  const u = typeof url === "string" ? new URL(url) : url;
  const m = method.toUpperCase();
  if (u.protocol !== "https:") throw new Error(`Azure 整合只允許 https，拒絕 ${u.protocol}`);
  const ok = RULES.some((r) => r.method === m && r.host === u.hostname && r.path.test(u.pathname));
  if (!ok) throw new Error(`Azure 整合是唯讀的，拒絕送出 ${m} ${u.hostname}${u.pathname}（不在白名單內）`);
}

/** 把 billing account / profile name 放進 path：只允許安全字元，冒號保留原樣。 */
function seg(v: string): string {
  if (!/^[A-Za-z0-9:_.-]+$/.test(v)) throw new Error(`Azure id 含有不允許的字元：${v.slice(0, 80)}`);
  return v;
}

// ---------------------------------------------------------------------------
// 錯誤
// ---------------------------------------------------------------------------

export class AzureApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "AzureApiError";
  }
}

/** 憑證被拒（tenant / client id / secret 錯、secret 過期）。 */
export class AzureAuthError extends AzureApiError {
  constructor(detail?: string) {
    const why = detail ? "（" + detail + "）" : "";
    super(401, `Azure 拒絕了 service principal 的憑證${why}，請 owner / admin 到 設定 › 整合 重新連接 Azure`);
    this.name = "AzureAuthError";
  }
}

/** 從 Azure 的錯誤回應抽出 code / message（截短）；不含我們送出的任何東西。 */
async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as { error?: { code?: string; message?: string } | string; error_codes?: number[] };
    if (j.error && typeof j.error === "object") {
      return [j.error.code, j.error.message].filter(Boolean).join(": ").slice(0, 300);
    }
    if (typeof j.error === "string") {
      const code = j.error_codes?.[0];
      return code ? `${j.error} AADSTS${code}` : j.error;
    }
  } catch {
    // 不是 JSON
  }
  return text.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Token
// ---------------------------------------------------------------------------

const AAD_AUTH_ERRORS = new Set(["invalid_client", "unauthorized_client", "invalid_request", "invalid_grant"]);

/** client credentials 換 ARM token。憑證錯 → AzureAuthError。 */
export async function fetchAzureToken(creds: IntegrationCredentials, fetchImpl: typeof fetch = fetch): Promise<TokenCache> {
  const tenantId = creds.tenantId?.trim();
  const clientId = creds.clientId?.trim();
  const clientSecret = creds.clientSecret;
  if (!tenantId || !clientId || !clientSecret) throw new AzureAuthError("缺少 tenantId / clientId / clientSecret");
  if (!/^[A-Za-z0-9.-]+$/.test(tenantId)) throw new AzureAuthError("tenantId 格式不對");
  const url = new URL(`https://${LOGIN_HOST}/${tenantId}/oauth2/v2.0/token`);
  assertAzureReadOnly("POST", url);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: `https://${ARM_HOST}/.default`,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AzureApiError(0, `無法連線到 Azure 登入服務：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) {
    const detail = await errorDetail(res);
    const code = detail.split(" ")[0];
    if (res.status === 401 || AAD_AUTH_ERRORS.has(code)) throw new AzureAuthError(detail);
    throw new AzureApiError(res.status, `Azure 登入回應 ${res.status}：${detail}`);
  }
  const j = (await res.json()) as { access_token?: string; expires_in?: number | string };
  if (!j.access_token) throw new AzureApiError(res.status, "Azure 登入沒有回傳 access token");
  const ttl = Number(j.expires_in) || 3600;
  return { value: j.access_token, expiresAt: new Date(Date.now() + ttl * 1000) };
}

// ---------------------------------------------------------------------------
// 回應解析（純函式，形狀以 2024-04-01 / 2023-11-01 為準，防禦式）
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

function obj(v: unknown): Json {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {};
}
function list(v: unknown): Json[] {
  return Array.isArray(v) ? v.map(obj) : [];
}
function s(v: unknown): string | null {
  if (typeof v === "string") return v.trim() === "" ? null : v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
function n(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}
/** ISO 時間 / 日期 → YYYY-MM-DD（Azure 的日期都是 UTC 午夜）。 */
function day(v: unknown): string | null {
  const str = s(v);
  return str && /^\d{4}-\d{2}-\d{2}/.test(str) ? str.slice(0, 10) : null;
}
/** ARM id 的最後一段。 */
function lastSegment(id: string | null): string | null {
  if (!id) return null;
  const parts = id.split("/").filter(Boolean);
  return parts.at(-1) ?? null;
}

export type AzureBillingAccount = { id: string; displayName: string | null; agreementType: string | null };

export function parseBillingAccounts(json: unknown): AzureBillingAccount[] {
  return list(obj(json).value).flatMap((v) => {
    const id = s(v.name);
    if (!id) return [];
    const p = obj(v.properties);
    return [{ id, displayName: s(p.displayName), agreementType: s(p.agreementType) }];
  });
}

export function parseBillingProfiles(json: unknown, account: AzureBillingAccount): AzureDiscoveredProfile[] {
  return list(obj(json).value).flatMap((v) => {
    const id = s(v.name);
    if (!id) return [];
    return [
      {
        billingAccountId: account.id,
        billingAccountName: account.displayName,
        id,
        displayName: s(obj(v.properties).displayName) ?? id,
      },
    ];
  });
}

export type AzureSubscription = {
  subscriptionId: string;
  displayName: string | null;
  billingProfileName: string | null;
  status: string | null;
};

export function parseBillingSubscriptions(json: unknown): AzureSubscription[] {
  return list(obj(json).value).flatMap((v) => {
    const p = obj(v.properties);
    const subscriptionId = s(p.subscriptionId) ?? s(v.name);
    if (!subscriptionId) return [];
    return [
      {
        subscriptionId,
        displayName: s(p.displayName),
        billingProfileName: s(p.billingProfileName) ?? lastSegment(s(p.billingProfileId)),
        status: s(p.status),
      },
    ];
  });
}

/**
 * 只留屬於這個 billing profile 的 subscription（billingProfileName，或 billingProfileId 的最後一段）。
 * profile 層級的端點本來就只回這個 profile 的，但多驗一次；沒帶 profile 欄位的視為屬於它。
 */
export function subscriptionsForProfile(subs: readonly AzureSubscription[], profileId: string): AzureSubscription[] {
  return subs.filter((x) => !x.billingProfileName || x.billingProfileName.toLowerCase() === profileId.toLowerCase());
}

/** Azure 的 subscription 狀態 → 資源狀態：Active / Warned / PastDue 仍在；Deleted、Disabled 等視為不在了。 */
export function subscriptionResourceStatus(status: string | null): "active" | "missing" {
  if (!status) return "active";
  return ["active", "warned", "pastdue"].includes(status.toLowerCase()) ? "active" : "missing";
}

export type ParsedPaymentMethod = {
  /** 去重鍵：payment method 本身的 id（同一張卡掛在多個 profile 也只算一張）；沒有才用 link name。 */
  externalRef: string;
  kind: "card" | "other";
  label: string;
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  holderName: string | null;
  status: string | null;
};

/** '10/2028' → { month: 10, year: 2028 }；也接受 '10/28'、'2028-10'。 */
export function parseExpiration(v: string | null): { month: number; year: number } | null {
  if (!v) return null;
  let m = /^(\d{1,2})\/(\d{2}|\d{4})$/.exec(v.trim());
  if (m) {
    const month = Number(m[1]);
    const year = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return month >= 1 && month <= 12 ? { month, year } : null;
  }
  m = /^(\d{4})-(\d{1,2})/.exec(v.trim());
  if (m) {
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? { month, year: Number(m[1]) } : null;
  }
  return null;
}

/**
 * paymentMethodLinks → 付款方式。卡的欄位直接在 `properties` 上：displayName（'MasterCard'）、
 * family（'CreditCard'）、paymentMethodType（'mc'）、lastFourDigits、expiration（'10/2028'）、
 * accountHolderName、status。只取這些欄位，完整卡號 Azure 本來就不回，我們也不存。
 */
export function parsePaymentMethodLinks(json: unknown): ParsedPaymentMethod[] {
  return list(obj(json).value).flatMap((v) => {
    const p = obj(v.properties);
    const linkName = s(v.name) ?? lastSegment(s(v.id));
    const pmId = lastSegment(s(p.paymentMethodId) ?? s(obj(p.paymentMethod).id));
    const externalRef = pmId ?? linkName;
    if (!externalRef) return [];
    const family = s(p.family);
    const brand = s(p.displayName) ?? s(p.paymentMethodType);
    const digits = s(p.lastFourDigits);
    const last4 = digits && /^\d{4}$/.test(digits) ? digits : null;
    const exp = parseExpiration(s(p.expiration));
    const kind: "card" | "other" = family?.toLowerCase() === "creditcard" || last4 ? "card" : "other";
    const label = [brand ?? family ?? "Azure", last4 ? `•${last4}` : null].filter(Boolean).join(" ");
    return [
      {
        externalRef,
        kind,
        label,
        brand,
        last4,
        expiryMonth: exp?.month ?? null,
        expiryYear: exp?.year ?? null,
        holderName: s(p.accountHolderName),
        status: s(p.status),
      },
    ];
  });
}

export type ParsedAzureInvoice = {
  externalRef: string;
  invoiceDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  amount: number;
  currency: string;
  status: string | null;
  invoiceType: string | null;
  /** 尚未付清的金額（`amountDue.value`）；逾期未付的提醒用。 */
  amountDue: number | null;
};

export function parseInvoices(json: unknown): ParsedAzureInvoice[] {
  return list(obj(json).value).flatMap((v) => {
    const p = obj(v.properties);
    const externalRef = s(v.name);
    const invoiceDate = day(p.invoiceDate);
    const total = obj(p.totalAmount);
    const amount = n(total.value);
    const currency = s(total.currency)?.toUpperCase() ?? null;
    if (!externalRef || !invoiceDate || amount === null || !currency || currency.length !== 3) return [];
    return [
      {
        externalRef,
        invoiceDate,
        periodStart: day(p.invoicePeriodStartDate),
        periodEnd: day(p.invoicePeriodEndDate),
        amount,
        currency,
        status: s(p.status),
        invoiceType: s(p.invoiceType) ?? s(p.documentType),
        amountDue: n(obj(p.amountDue).value),
      },
    ];
  });
}

export type AzureCostRow = {
  /** YYYY-MM-01 */
  month: string;
  /** 有 SubscriptionId 欄位才有值（profile 範圍的 query 依 SubscriptionName 分組，通常沒有）。 */
  subscriptionId: string;
  subscriptionName: string;
  service: string;
  amount: number;
  currency: string;
};

/**
 * Cost Management query 的結果：`properties.columns[{name}]` + `properties.rows[][]`。
 * 欄位順序不固定，一律依名稱找（Cost / PreTaxCost、BillingMonth / UsageDate、SubscriptionId /
 * SubscriptionName、ServiceName、Currency）。月份可能是 '2026-09-01T00:00:00' 或數字 20260901。
 * 實測會有一列 SubscriptionName、ServiceName 都是空的負數（折扣 / 調整），照樣保留，名稱留空。
 */
type CostColumns = { cost: number; month: number; subId: number; subName: number; service: number; currency: number };

function costColumns(columns: unknown): CostColumns {
  const cols = list(columns).map((c) => (s(c.name) ?? "").toLowerCase());
  const idx = (...names: string[]) => cols.findIndex((c) => names.includes(c));
  return {
    cost: idx("cost", "pretaxcost", "costusd"),
    month: idx("billingmonth", "usagedate"),
    subId: idx("subscriptionid"),
    subName: idx("subscriptionname"),
    service: idx("servicename"),
    currency: idx("currency", "billingcurrency"),
  };
}

/** 欄位不存在（index -1）就當空值。 */
function cell(row: unknown[], i: number): string | null {
  return i >= 0 ? s(row[i]) : null;
}

/** '2026-09-01T00:00:00' 或 20260901 → '2026-09-01'；認不得回 null。 */
function costMonth(raw: string | null): string | null {
  const digits = (raw ?? "").replaceAll("-", "");
  return /^\d{6}/.test(digits) ? `${digits.slice(0, 4)}-${digits.slice(4, 6)}-01` : null;
}

function costRow(r: unknown[], c: CostColumns): AzureCostRow | null {
  const amount = n(r[c.cost]);
  const month = costMonth(s(r[c.month]));
  if (amount === null || !month) return null;
  return {
    month,
    subscriptionId: cell(r, c.subId)?.toLowerCase() ?? "",
    subscriptionName: cell(r, c.subName) ?? "",
    service: cell(r, c.service) ?? "",
    amount,
    currency: cell(r, c.currency)?.toUpperCase() ?? "USD",
  };
}

export function parseCostQuery(json: unknown): { rows: AzureCostRow[]; nextLink: string | null } {
  const p = obj(obj(json).properties);
  const c = costColumns(p.columns);
  const raw = Array.isArray(p.rows) ? (p.rows as unknown[]) : [];
  const rows =
    c.cost >= 0 && c.month >= 0
      ? raw.flatMap((r) => {
          const row = Array.isArray(r) ? costRow(r, c) : null;
          return row ? [row] : [];
        })
      : [];
  return { rows, nextLink: s(p.nextLink) };
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type AzureClient = {
  listBillingAccounts(): Promise<AzureBillingAccount[]>;
  listBillingProfiles(account: AzureBillingAccount): Promise<AzureDiscoveredProfile[]>;
  listBillingSubscriptions(billingAccountId: string, profileId: string): Promise<AzureSubscription[]>;
  listPaymentMethodLinks(billingAccountId: string, profileId: string): Promise<ParsedPaymentMethod[]>;
  /** from / to 是 YYYY-MM-DD（發票日）。 */
  listInvoices(billingAccountId: string, profileId: string, from: string, to: string): Promise<ParsedAzureInvoice[]>;
  /** 每月實際費用，依 subscription 名稱 × 服務分組。from / to 是 YYYY-MM-DD。 */
  queryCosts(billingAccountId: string, profileId: string, from: string, to: string): Promise<AzureCostRow[]>;
};

function billingUrl(path: string, apiVersion = AZURE_BILLING_API, query: Record<string, string> = {}): URL {
  const u = new URL(`https://${ARM_HOST}${BILLING.replaceAll("\\", "")}${path}`);
  u.searchParams.set("api-version", apiVersion);
  for (const [k, v] of Object.entries(query)) u.searchParams.set(k, v);
  return u;
}

type AzureHttp = { getToken: () => Promise<string>; fetchImpl: typeof fetch };

/** 非 2xx → 對應的錯誤（401 = 憑證、403 = 沒角色、429 = 太頻繁）。 */
async function azureHttpError(res: Response): Promise<AzureApiError> {
  const detail = await errorDetail(res);
  if (res.status === 401) return new AzureAuthError(detail);
  if (res.status === 403) {
    return new AzureApiError(403, `Azure 拒絕存取（403）：service principal 沒有這個計費範圍的讀取角色。${detail}`);
  }
  if (res.status === 429) return new AzureApiError(429, `Azure 請求太頻繁（429），稍後再試：${detail}`);
  return new AzureApiError(res.status, `Azure 回應 ${res.status}：${detail}`);
}

/** 唯一發請求的地方：先過白名單，再帶 token 送出。 */
async function azureCall(http: AzureHttp, method: "GET" | "POST", url: URL, body?: unknown): Promise<unknown> {
  assertAzureReadOnly(method, url);
  const token = await http.getToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await http.fetchImpl(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new AzureApiError(0, `無法連線到 Azure：${e instanceof Error ? e.message : String(e)}`);
  }
  if (!res.ok) throw await azureHttpError(res);
  return res.json();
}

/** GET 一路跟著 nextLink 走完（nextLink 也要過白名單）。 */
async function azureGetAll(http: AzureHttp, url: URL): Promise<Json[]> {
  const out: Json[] = [];
  let next: URL | null = url;
  for (let page = 0; next && page < MAX_PAGES; page++) {
    const json = obj(await azureCall(http, "GET", next));
    out.push(...list(json.value));
    const link = s(json.nextLink);
    next = link ? new URL(link) : null;
  }
  return out;
}

function costQueryBody(from: string, to: string) {
  return {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: { from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` },
    dataset: {
      granularity: "Monthly",
      aggregation: { totalCost: { name: "Cost", function: "Sum" } },
      grouping: [
        { type: "Dimension", name: "SubscriptionName" },
        { type: "Dimension", name: "ServiceName" },
      ],
    },
  };
}

/**
 * 建立 client。getToken 由呼叫端提供（快取 / 換新）；fetchImpl 可注入（測試用）。
 * 401 → 丟 AzureAuthError（呼叫端決定要不要換 token 重試）。
 */
export function makeAzureClient(getToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): AzureClient {
  const http: AzureHttp = { getToken, fetchImpl };
  const getAll = (url: URL) => azureGetAll(http, url);
  return {
    async listBillingAccounts() {
      return parseBillingAccounts({ value: await getAll(billingUrl("")) });
    },
    async listBillingProfiles(account) {
      return parseBillingProfiles({ value: await getAll(billingUrl(`/${seg(account.id)}/billingProfiles`)) }, account);
    },
    async listBillingSubscriptions(ba, bp) {
      return parseBillingSubscriptions({
        value: await getAll(billingUrl(`/${seg(ba)}/billingProfiles/${seg(bp)}/billingSubscriptions`)),
      });
    },
    async listPaymentMethodLinks(ba, bp) {
      return parsePaymentMethodLinks({
        value: await getAll(billingUrl(`/${seg(ba)}/billingProfiles/${seg(bp)}/paymentMethodLinks`)),
      });
    },
    async listInvoices(ba, bp, from, to) {
      const url = billingUrl(`/${seg(ba)}/billingProfiles/${seg(bp)}/invoices`, AZURE_BILLING_API, {
        periodStartDate: from,
        periodEndDate: to,
      });
      return parseInvoices({ value: await getAll(url) });
    },
    async queryCosts(ba, bp, from, to) {
      const body = costQueryBody(from, to);
      const rows: AzureCostRow[] = [];
      let url: URL | null = billingUrl(
        `/${seg(ba)}/billingProfiles/${seg(bp)}/providers/Microsoft.CostManagement/query`,
        AZURE_COST_API,
      );
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const parsed = parseCostQuery(await azureCall(http, "POST", url, body));
        rows.push(...parsed.rows);
        url = parsed.nextLink ? new URL(parsed.nextLink) : null;
      }
      return rows;
    },
  };
}

/** config.billingAccountId（連接時填的 MCA billing account id）。格式不對回 null。 */
export function azureBillingAccountId(config: Record<string, unknown> | null | undefined): string | null {
  const v = config?.billingAccountId;
  return typeof v === "string" && /^[A-Za-z0-9:_.-]+$/.test(v.trim()) ? v.trim() : null;
}

/**
 * 列出這個 service principal 在指定 billing account 底下看得到的 billing profile。
 * 只有 profile 層級的讀取角色時，Azure 只回有權限的那幾個 —— 這正是我們要的候選。
 */
export async function discoverAzureProfiles(
  client: AzureClient,
  billingAccountId: string,
): Promise<AzureDiscoveredProfile[]> {
  return client.listBillingProfiles({ id: billingAccountId, displayName: null, agreementType: null });
}

// ---------------------------------------------------------------------------
// 組織層級：token 快取 + 成功 / 失敗回報
// ---------------------------------------------------------------------------

/**
 * 拿這個組織的 Azure client 並執行 fn。整合必須已連接、已開啟。
 * token 先用快取；ARM 回 401 時丟掉快取、換新 token 重試一次，再被拒才 markNeedsReauth。
 * 成功 → recordSyncSuccess；其他 Azure 錯誤 → recordSyncFailure。錯誤原樣往外丟。
 */
export async function withAzureClient<T>(
  orgId: string,
  fn: (client: AzureClient, row: IntegrationSummary) => Promise<T>,
): Promise<T> {
  const { row, credentials } = await requireEnabledIntegration(orgId, "azure");
  let cached: string | null = (await loadTokenCache(orgId, "azure"))?.value ?? null;
  const getToken = async () => {
    if (cached) return cached;
    const fresh = await fetchAzureToken(credentials);
    await saveTokenCache(orgId, "azure", fresh.value, fresh.expiresAt);
    cached = fresh.value;
    return fresh.value;
  };
  const client = makeAzureClient(getToken);
  try {
    let out: T;
    try {
      out = await fn(client, row);
    } catch (e) {
      // 快取的 token 被拒（被撤銷、時鐘差）：換新的重試一次
      if (!(e instanceof AzureAuthError) || cached === null) throw e;
      cached = null;
      await clearTokenCache(orgId, "azure");
      out = await fn(client, row);
    }
    await recordSyncSuccess(orgId, "azure");
    return out;
  } catch (e) {
    if (e instanceof AzureAuthError) {
      await markNeedsReauth(orgId, "azure", "Azure 拒絕了 service principal 的憑證");
    } else if (e instanceof AzureApiError) {
      await recordSyncFailure(orgId, "azure", e.message);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Provider（testConnection）
// ---------------------------------------------------------------------------

export const azureProvider: IntegrationProvider = {
  id: "azure",
  async testConnection(creds, config) {
    const billingAccountId = azureBillingAccountId(config);
    if (!billingAccountId) {
      return { ok: false, error: "請填寫 billing account ID（Azure 入口網站 › 成本管理 + 計費 › 計費範圍 › 屬性）" };
    }
    try {
      const token = await fetchAzureToken(creds);
      const client = makeAzureClient(async () => token.value);
      const profiles = await discoverAzureProfiles(client, billingAccountId);
      if (profiles.length === 0) {
        return {
          ok: false,
          error: "這個 service principal 在這個 billing account 底下看不到任何 billing profile。請在要同步的 billing profile 指派「Billing profile reader」給它",
        };
      }
      return {
        ok: true,
        config: { billingAccountId, discovered: profiles, discoveredAt: new Date().toISOString() },
        tokenCache: token,
      };
    } catch (e) {
      if (e instanceof AzureApiError) return { ok: false, error: e.message };
      throw e;
    }
  },
};
