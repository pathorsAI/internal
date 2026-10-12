import type { GcpDiscoveredAccount } from "@/lib/vendor-billing/scope";
import { OidcConfigError, pemBody, signOrgAssertion, signRs256Jwt } from "@/lib/oidc";
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
 * Google Cloud 計費整合 —— **唯讀**。
 *
 * 兩種驗證方式（config.authMode，Workers 上不能用 Google SDK，全部自己用 WebCrypto + fetch）：
 *   - key：一份 service account JSON key（加密存放），自己簽 RS256 JWT 換 token。
 *   - workload_identity：不存任何金鑰。平台用 OIDC_SIGNING_KEY 簽一個 sub = 這個組織 id 的
 *     短效 JWT（src/lib/oidc.ts）→ STS token exchange → iamcredentials generateAccessToken
 *     impersonate config.serviceAccountEmail。GCP 端只把 `principal://…/subject/<orgId>` 綁到
 *     roles/iam.workloadIdentityUser，所以別的組織的 sub 換不到這個 SA 的 token（403）。
 * 權限：每個要同步的 billing account 給 SA roles/billing.viewer；要讀費用另外在 export 所在
 * 專案給 roles/bigquery.dataViewer + roles/bigquery.jobUser。
 *
 * 讀的東西：billing account、底下專案（+ best-effort 讀專案名稱 / labels）、選填的 BigQuery
 * billing export。所有請求都經過 `gcpFetch()` 的 method + host + path 白名單；只有 GET，例外是
 * 換 token 與 BigQuery `jobs.query`（跑 SELECT，資料是唯讀的）兩個明確列出的 POST。
 * 沒有任何修改 billing account、專案、付款的程式碼路徑。GCP 的 API 讀不到付款卡。
 *
 * Key 與 token 只在 server 記憶體：不進 log、錯誤訊息、回傳值。
 */

export const GCP_SCOPES = [
  "https://www.googleapis.com/auth/cloud-billing.readonly",
  "https://www.googleapis.com/auth/cloud-platform.read-only",
  "https://www.googleapis.com/auth/bigquery.readonly",
].join(" ");

const TOKEN_HOST = "oauth2.googleapis.com";
const STS_HOST = "sts.googleapis.com";
const IAM_CREDENTIALS_HOST = "iamcredentials.googleapis.com";
const BILLING_HOST = "cloudbilling.googleapis.com";
const CRM_HOST = "cloudresourcemanager.googleapis.com";
const BQ_HOST = "bigquery.googleapis.com";
const TOKEN_URL = `https://${TOKEN_HOST}/token`;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_PAGES = 50;

const ACCT = String.raw`[A-Za-z0-9-]+`;
const PROJ = String.raw`[a-z0-9.:-]+`;
const BQID = String.raw`[\w.:$-]+`;

type Rule = { method: "GET" | "POST"; host: string; path: RegExp };

/** 允許的請求。新增端點只能加在這裡，而且必須是讀取。 */
const RULES: readonly Rule[] = [
  { method: "POST", host: TOKEN_HOST, path: /^\/token$/ },
  { method: "POST", host: STS_HOST, path: /^\/v1\/token$/ },
  {
    method: "POST",
    host: IAM_CREDENTIALS_HOST,
    path: /^\/v1\/projects\/-\/serviceAccounts\/[\w.@-]+:generateAccessToken$/,
  },
  { method: "GET", host: BILLING_HOST, path: /^\/v1\/billingAccounts$/ },
  { method: "GET", host: BILLING_HOST, path: new RegExp(`^/v1/billingAccounts/${ACCT}$`) },
  { method: "GET", host: BILLING_HOST, path: new RegExp(`^/v1/billingAccounts/${ACCT}/projects$`) },
  { method: "GET", host: CRM_HOST, path: new RegExp(`^/v1/projects/${PROJ}$`) },
  { method: "GET", host: BQ_HOST, path: new RegExp(`^/bigquery/v2/projects/${PROJ}/datasets/${BQID}/tables$`) },
  { method: "POST", host: BQ_HOST, path: new RegExp(`^/bigquery/v2/projects/${PROJ}/queries$`) },
  { method: "GET", host: BQ_HOST, path: new RegExp(`^/bigquery/v2/projects/${PROJ}/queries/${BQID}$`) },
];

/** 不在白名單上的請求一律拒絕 —— 這個整合永遠不得改動 GCP 上的任何東西。 */
export function assertGcpReadOnly(method: string, url: string | URL): void {
  const u = typeof url === "string" ? new URL(url) : url;
  const m = method.toUpperCase();
  if (u.protocol !== "https:") throw new Error(`GCP 整合只允許 https，拒絕 ${u.protocol}`);
  const ok = RULES.some((r) => r.method === m && r.host === u.hostname && r.path.test(u.pathname));
  if (!ok) throw new Error(`GCP 整合是唯讀的，拒絕送出 ${m} ${u.hostname}${u.pathname}（不在白名單內）`);
}

// ---------------------------------------------------------------------------
// 錯誤
// ---------------------------------------------------------------------------

export class GcpApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GcpApiError";
  }
}

/** 憑證被拒（key 刪掉 / 停用 / JSON 不對、workload identity 換不到 token）。 */
export class GcpAuthError extends GcpApiError {
  constructor(
    detail?: string,
    /** 存進 last_error 給成員看的版本（不含任何金鑰）。 */
    readonly reauthMessage = "Google 拒絕了 GCP 的憑證",
  ) {
    const why = detail ? "（" + detail + "）" : "";
    super(401, `Google 拒絕了 GCP 的憑證${why}，請 owner / admin 到 設定 › 整合 重新連接 GCP`);
    this.name = "GcpAuthError";
  }
}

/** Workload identity：這個組織的 subject 沒有被授權 impersonate 這個 SA（impersonation 403）。 */
export class GcpBindingMissingError extends GcpAuthError {
  constructor(serviceAccountEmail: string) {
    const msg = `這個組織的 workload identity subject 沒有被授權使用 ${serviceAccountEmail}：請 GCP 管理員在這個 service account 加上 roles/iam.workloadIdentityUser 給本組織的 principal（設定 › 整合 › Google Cloud 計費 有可直接複製的指令）`;
    super(undefined, msg);
    this.message = msg;
    this.name = "GcpBindingMissingError";
  }
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  try {
    const j = JSON.parse(text) as {
      error?: { message?: string; status?: string } | string;
      error_description?: string;
    };
    if (j.error && typeof j.error === "object") return [j.error.status, j.error.message].filter(Boolean).join(": ").slice(0, 300);
    if (typeof j.error === "string") return [j.error, j.error_description].filter(Boolean).join(": ").slice(0, 300);
  } catch {
    // 不是 JSON
  }
  return text.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Service account key + JWT（WebCrypto，無 SDK）
// ---------------------------------------------------------------------------

export type ServiceAccountKey = {
  clientEmail: string;
  privateKey: string;
  privateKeyId: string | null;
  projectId: string | null;
};

/** 解析貼上的 JSON key；只取需要的欄位。錯誤訊息不含 key 的任何內容。 */
export function parseServiceAccountJson(raw: string | undefined): ServiceAccountKey | { error: string } {
  if (!raw || raw.trim() === "") return { error: "請貼上 service account JSON key" };
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { error: "Service account key 不是合法的 JSON（請整份檔案原樣貼上）" };
  }
  if (j.type !== "service_account") return { error: "這不是 service account key（type 應為 service_account）" };
  const clientEmail = typeof j.client_email === "string" ? j.client_email : "";
  const privateKey = typeof j.private_key === "string" ? j.private_key : "";
  if (!clientEmail || !privateKey.includes("PRIVATE KEY")) {
    return { error: "Service account key 缺少 client_email 或 private_key" };
  }
  return {
    clientEmail,
    privateKey,
    privateKeyId: typeof j.private_key_id === "string" ? j.private_key_id : null,
    projectId: typeof j.project_id === "string" ? j.project_id : null,
  };
}

/** PEM（`-----BEGIN PRIVATE KEY-----`）→ PKCS#8 DER bytes。JSON 裡的 `\n` 已被 JSON.parse 還原。 */
export function pemToDer(pem: string): ArrayBuffer {
  const bin = atob(pemBody(pem));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.codePointAt(i) ?? 0;
  return out.buffer;
}

/** 組並簽一個 RS256 JWT（OAuth 2.0 JWT bearer grant 用）。 */
export async function buildServiceAccountJwt(
  key: ServiceAccountKey,
  opts: { scope?: string; nowSec?: number; audience?: string } = {},
): Promise<string> {
  const iat = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const header = key.privateKeyId ? { kid: key.privateKeyId } : {};
  const claims = {
    iss: key.clientEmail,
    scope: opts.scope ?? GCP_SCOPES,
    aud: opts.audience ?? TOKEN_URL,
    iat,
    exp: iat + 3600,
  };
  try {
    return await signRs256Jwt(header, claims, pemToDer(key.privateKey));
  } catch (e) {
    if (e instanceof OidcConfigError || e instanceof DOMException) throw new GcpAuthError("private_key 無法解析");
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Workload Identity Federation（不存金鑰）
// ---------------------------------------------------------------------------

export type GcpAuthMode = "key" | "workload_identity";

export function gcpAuthMode(config: Record<string, unknown> | null | undefined): GcpAuthMode {
  return config?.authMode === "workload_identity" ? "workload_identity" : "key";
}

export type WifAudience = { projectNumber: string; pool: string; provider: string };

const WIF_AUDIENCE_RE =
  /^\/\/iam\.googleapis\.com\/projects\/(\d+)\/locations\/global\/workloadIdentityPools\/([a-z0-9-]+)\/providers\/([a-z0-9-]+)$/;
const SA_EMAIL_RE = /^[a-z0-9-]+@[a-z0-9-]+\.iam\.gserviceaccount\.com$/;

/** `//iam.googleapis.com/projects/<n>/locations/global/workloadIdentityPools/<pool>/providers/<p>` → 各段。 */
export function parseWifAudience(v: unknown): WifAudience | null {
  if (typeof v !== "string") return null;
  const m = WIF_AUDIENCE_RE.exec(v.trim());
  return m ? { projectNumber: m[1], pool: m[2], provider: m[3] } : null;
}

export function isServiceAccountEmail(v: unknown): v is string {
  return typeof v === "string" && SA_EMAIL_RE.test(v.trim());
}

/** 這個組織在 GCP 上的 principal（subject = organization id）。 */
export function workloadIdentityPrincipal(aud: WifAudience, orgId: string): string {
  return `principal://iam.googleapis.com/projects/${aud.projectNumber}/locations/global/workloadIdentityPools/${aud.pool}/subject/${orgId}`;
}

/** 給 GCP 管理員複製的綁定指令；audience / SA 格式不對回 null。 */
export function workloadIdentityBindingCommand(serviceAccountEmail: unknown, audience: unknown, orgId: string): string | null {
  const aud = parseWifAudience(audience);
  if (!aud || !isServiceAccountEmail(serviceAccountEmail)) return null;
  return `gcloud iam service-accounts add-iam-policy-binding ${serviceAccountEmail.trim()} --role=roles/iam.workloadIdentityUser --member="${workloadIdentityPrincipal(aud, orgId)}"`;
}

/** config 裡的 workload identity 設定；缺 / 格式不對回 error（給人看）。 */
export function wifSettings(
  config: Record<string, unknown> | null | undefined,
): { audience: string; serviceAccountEmail: string } | { error: string } {
  const audience = typeof config?.wifAudience === "string" ? config.wifAudience.trim() : "";
  const email = typeof config?.serviceAccountEmail === "string" ? config.serviceAccountEmail.trim() : "";
  if (!parseWifAudience(audience)) {
    return { error: "Workload identity provider 格式不對（應為 //iam.googleapis.com/projects/<專案編號>/locations/global/workloadIdentityPools/<pool>/providers/<provider>）" };
  }
  if (!isServiceAccountEmail(email)) return { error: "Service account email 格式不對（…@<專案>.iam.gserviceaccount.com）" };
  return { audience, serviceAccountEmail: email };
}

async function postForm(url: string, body: URLSearchParams, fetchImpl: typeof fetch): Promise<Response> {
  assertGcpReadOnly("POST", url);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new GcpApiError(0, `無法連線到 Google 登入服務：${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 簽本組織的 assertion；平台沒設簽章金鑰是伺服器設定問題（500），不是憑證錯。 */
async function orgAssertion(orgId: string): Promise<string> {
  try {
    return await signOrgAssertion(orgId);
  } catch (e) {
    if (e instanceof OidcConfigError) throw new GcpApiError(500, e.message);
    throw e;
  }
}

/** STS token exchange：本組織的 JWT → federated access token。 */
async function stsExchange(audience: string, assertion: string, fetchImpl: typeof fetch): Promise<string> {
  const res = await postForm(
    `https://${STS_HOST}/v1/token`,
    new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      audience,
      scope: "https://www.googleapis.com/auth/cloud-platform",
      requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      subject_token: assertion,
    }),
    fetchImpl,
  );
  if (!res.ok) {
    const detail = await errorDetail(res);
    if ([400, 401, 403].includes(res.status)) {
      throw new GcpAuthError(`STS：${detail}`, `GCP workload identity 換 token 失敗（${detail}）`);
    }
    throw new GcpApiError(res.status, `GCP STS 回應 ${res.status}：${detail}`);
  }
  const body: { access_token?: string } = await res.json();
  const token = body.access_token;
  if (!token) throw new GcpApiError(res.status, "GCP STS 沒有回傳 access token");
  return token;
}

/** 用 federated token impersonate SA。403 = 這個組織的 subject 沒被授權。 */
async function impersonate(serviceAccountEmail: string, federated: string, fetchImpl: typeof fetch): Promise<TokenCache> {
  const url = `https://${IAM_CREDENTIALS_HOST}/v1/projects/-/serviceAccounts/${serviceAccountEmail}:generateAccessToken`;
  assertGcpReadOnly("POST", url);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${federated}`, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ scope: GCP_SCOPES.split(" "), lifetime: "3600s" }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new GcpApiError(0, `無法連線到 Google IAM：${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 403) throw new GcpBindingMissingError(serviceAccountEmail);
  if (!res.ok) {
    const detail = await errorDetail(res);
    if (res.status === 401) throw new GcpAuthError(`impersonation：${detail}`);
    throw new GcpApiError(res.status, `Google IAM 回應 ${res.status}：${detail}`);
  }
  const j: { accessToken?: string; expireTime?: string } = await res.json();
  if (!j.accessToken) throw new GcpApiError(res.status, "Google IAM 沒有回傳 access token");
  const exp = new Date(j.expireTime ?? Date.now() + 3_600_000);
  return { value: j.accessToken, expiresAt: Number.isNaN(exp.getTime()) ? new Date(Date.now() + 3_600_000) : exp };
}

/**
 * Workload identity：簽本組織的 JWT → STS 換 federated token → impersonate SA。
 * orgId 一定來自 server 端 org context（同步的 orgId、設定頁 action 的 requireOrg）。
 */
async function fetchWifToken(
  orgId: string,
  config: Record<string, unknown> | null | undefined,
  fetchImpl: typeof fetch,
): Promise<TokenCache> {
  const wif = wifSettings(config);
  if ("error" in wif) throw new GcpAuthError(wif.error);
  const federated = await stsExchange(wif.audience, await orgAssertion(orgId), fetchImpl);
  return impersonate(wif.serviceAccountEmail, federated, fetchImpl);
}

/**
 * 換 GCP access token。key 模式用 service account key；workload_identity 模式以 orgId 的身分
 * 走 STS + impersonation。憑證錯 / 沒綁定 → GcpAuthError。
 */
export async function fetchGcpToken(
  creds: IntegrationCredentials,
  config: Record<string, unknown> | null | undefined,
  orgId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<TokenCache> {
  if (gcpAuthMode(config) === "workload_identity") return fetchWifToken(orgId, config, fetchImpl);
  return fetchKeyToken(creds, fetchImpl);
}

/** 用 service account JWT 換 access token。金鑰錯 / 被停用 → GcpAuthError。 */
async function fetchKeyToken(creds: IntegrationCredentials, fetchImpl: typeof fetch): Promise<TokenCache> {
  const key = parseServiceAccountJson(creds.serviceAccountJson);
  if ("error" in key) throw new GcpAuthError(key.error);
  const assertion = await buildServiceAccountJwt(key);
  const res = await postForm(
    TOKEN_URL,
    new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    fetchImpl,
  );
  if (!res.ok) {
    const detail = await errorDetail(res);
    if (res.status === 400 || res.status === 401) throw new GcpAuthError(detail);
    throw new GcpApiError(res.status, `Google 登入回應 ${res.status}：${detail}`);
  }
  const j: { access_token?: string; expires_in?: number } = await res.json();
  if (!j.access_token) throw new GcpApiError(res.status, "Google 登入沒有回傳 access token");
  return { value: j.access_token, expiresAt: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000) };
}

// ---------------------------------------------------------------------------
// 回應解析（純函式）
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const list = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const stripPrefix = (v: string | null, prefix: string) => (v?.startsWith(prefix) ? v.slice(prefix.length) : v);

export function parseGcpBillingAccount(v: Json): GcpDiscoveredAccount | null {
  const id = stripPrefix(s(v.name), "billingAccounts/");
  if (!id) return null;
  return {
    id,
    displayName: s(v.displayName) ?? id,
    masterBillingAccount: stripPrefix(s(v.masterBillingAccount), "billingAccounts/"),
    currencyCode: s(v.currencyCode),
    open: v.open !== false,
  };
}

export type GcpProjectBilling = { projectId: string; billingEnabled: boolean };

export function parseProjectBillingInfo(json: unknown): GcpProjectBilling[] {
  return list(obj(json).projectBillingInfo).flatMap((v) => {
    const projectId = s(v.projectId) ?? stripPrefix(s(v.name), "projects/")?.split("/")[0] ?? null;
    return projectId ? [{ projectId, billingEnabled: v.billingEnabled !== false }] : [];
  });
}

export type GcpProjectInfo = { name: string | null; labels: Record<string, string>; lifecycleState: string | null };

export function parseProject(json: unknown): GcpProjectInfo {
  const j = obj(json);
  const labels: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj(j.labels))) if (typeof v === "string") labels[k] = v;
  return { name: s(j.name), labels, lifecycleState: s(j.lifecycleState) };
}

function cellText(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return null;
  return typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
}

/** BigQuery `{schema:{fields}, rows:[{f:[{v}]}]}` → 每列一個 { 欄位名: 字串值 }。 */
export function parseBigQueryRows(json: unknown): Record<string, string | null>[] {
  const j = obj(json);
  const fields = list(obj(j.schema).fields).map((f) => s(f.name) ?? "");
  return list(j.rows).map((r) => {
    const cells = list(r.f);
    const row: Record<string, string | null> = {};
    fields.forEach((name, i) => {
      row[name] = cellText(cells[i]?.v);
    });
    return row;
  });
}

export type GcpCostRow = {
  /** YYYY-MM-01 */
  month: string;
  projectId: string;
  projectName: string | null;
  service: string;
  amount: number;
  currency: string;
};

/**
 * 一個 billing account 的標準用量費用 export 表 → 每月 × 專案 × 服務的淨額（費用 + credits）。
 * 資料表名不能參數化，呼叫端要先用 scope.ts 的 isValidBigQueryTable / isValidBigQueryExport 驗過。
 */
export function buildCostQuery(projectId: string, dataset: string, table: string): string {
  return [
    "SELECT invoice.month AS invoice_month,",
    "  IFNULL(project.id, '') AS project_id,",
    "  ANY_VALUE(project.name) AS project_name,",
    "  IFNULL(service.description, '') AS service,",
    "  currency,",
    "  SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS amount",
    `FROM \`${projectId}.${dataset}.${table}\``,
    "WHERE billing_account_id = @account AND invoice.month >= @fromMonth",
    "GROUP BY invoice_month, project_id, service, currency",
  ].join("\n");
}

export function parseCostRows(rows: Record<string, string | null>[]): GcpCostRow[] {
  return rows.flatMap((r) => {
    const m = r.invoice_month ?? "";
    const amount = Number(r.amount);
    const currency = (r.currency ?? "").toUpperCase();
    if (!/^\d{6}$/.test(m) || !Number.isFinite(amount) || currency.length !== 3) return [];
    return [
      {
        month: `${m.slice(0, 4)}-${m.slice(4, 6)}-01`,
        projectId: r.project_id ?? "",
        projectName: r.project_name ?? null,
        service: r.service ?? "",
        amount,
        currency,
      },
    ];
  });
}

export type GcpMonthlyInvoice = {
  externalRef: string;
  /** YYYY-MM-01 */
  periodStart: string;
  /** 月底 */
  periodEnd: string;
  invoiceDate: string;
  amount: number;
  currency: string;
};

/**
 * 每個「已結束的月份」彙總成一張月帳（external_ref `<billingAccountId>:<YYYYMM>`，
 * 發票日 = 月底）。本月與之後的月份還在累積，不產生。同月份出現多種幣別就略過那個月。
 */
export function monthlyInvoicesFromCosts(
  billingAccountId: string,
  rows: readonly GcpCostRow[],
  currentMonth: string,
): GcpMonthlyInvoice[] {
  const byMonth = new Map<string, { amount: number; currencies: Set<string> }>();
  for (const r of rows) {
    if (r.month >= currentMonth) continue;
    const m = byMonth.get(r.month) ?? { amount: 0, currencies: new Set<string>() };
    m.amount += r.amount;
    m.currencies.add(r.currency);
    byMonth.set(r.month, m);
  }
  const out: GcpMonthlyInvoice[] = [];
  for (const [month, m] of [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (m.currencies.size !== 1) continue;
    const [y, mo] = month.split("-").map(Number);
    const periodEnd = new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
    out.push({
      externalRef: `${billingAccountId}:${month.slice(0, 4)}${month.slice(5, 7)}`,
      periodStart: month,
      periodEnd,
      invoiceDate: periodEnd,
      amount: Math.round(m.amount * 100) / 100,
      currency: [...m.currencies][0],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type GcpClient = {
  listBillingAccounts(): Promise<GcpDiscoveredAccount[]>;
  getBillingAccount(id: string): Promise<GcpDiscoveredAccount | null>;
  listProjects(billingAccountId: string): Promise<GcpProjectBilling[]>;
  /** 讀不到（403 / 404）回 null —— 專案名稱只是 best-effort 的補充。 */
  getProject(projectId: string): Promise<GcpProjectInfo | null>;
  listTables(projectId: string, dataset: string): Promise<string[]>;
  queryCosts(projectId: string, dataset: string, table: string, billingAccountId: string, fromMonth: string): Promise<GcpCostRow[]>;
};

function safeId(v: string, re: RegExp, what: string): string {
  if (!re.test(v)) throw new Error(`GCP ${what} 含有不允許的字元：${v.slice(0, 80)}`);
  return v;
}

export function makeGcpClient(getToken: () => Promise<string>, fetchImpl: typeof fetch = fetch): GcpClient {
  async function call(method: "GET" | "POST", url: URL, body?: unknown, allow404 = false): Promise<unknown> {
    assertGcpReadOnly(method, url);
    const token = await getToken();
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      throw new GcpApiError(0, `無法連線到 Google Cloud：${e instanceof Error ? e.message : String(e)}`);
    }
    if (res.status === 401) throw new GcpAuthError(await errorDetail(res));
    if (allow404 && (res.status === 403 || res.status === 404)) return null;
    if (!res.ok) {
      const detail = await errorDetail(res);
      if (res.status === 403) {
        throw new GcpApiError(403, `Google Cloud 拒絕存取（403）：service account 沒有這個資源的讀取權限。${detail}`);
      }
      throw new GcpApiError(res.status, `Google Cloud 回應 ${res.status}：${detail}`);
    }
    return res.json();
  }

  async function pages(build: (pageToken: string | null) => URL, key: string): Promise<Json[]> {
    const out: Json[] = [];
    let token: string | null = null;
    for (let i = 0; i < MAX_PAGES; i++) {
      const j = obj(await call("GET", build(token)));
      out.push(...list(j[key]));
      token = s(j.nextPageToken);
      if (!token) break;
    }
    return out;
  }

  return {
    async listBillingAccounts() {
      const rows = await pages((t) => {
        const u = new URL(`https://${BILLING_HOST}/v1/billingAccounts`);
        u.searchParams.set("pageSize", "100");
        if (t) u.searchParams.set("pageToken", t);
        return u;
      }, "billingAccounts");
      return rows.map(parseGcpBillingAccount).filter((x): x is GcpDiscoveredAccount => x !== null);
    },
    async getBillingAccount(id) {
      const j = await call("GET", new URL(`https://${BILLING_HOST}/v1/billingAccounts/${safeId(id, /^[A-Za-z0-9-]+$/, "billing account")}`), undefined, true);
      return j ? parseGcpBillingAccount(obj(j)) : null;
    },
    async listProjects(id) {
      const rows = await pages((t) => {
        const u = new URL(`https://${BILLING_HOST}/v1/billingAccounts/${safeId(id, /^[A-Za-z0-9-]+$/, "billing account")}/projects`);
        u.searchParams.set("pageSize", "100");
        if (t) u.searchParams.set("pageToken", t);
        return u;
      }, "projectBillingInfo");
      return parseProjectBillingInfo({ projectBillingInfo: rows });
    },
    async getProject(projectId) {
      const j = await call("GET", new URL(`https://${CRM_HOST}/v1/projects/${safeId(projectId, /^[a-z0-9.:-]+$/, "project")}`), undefined, true);
      return j ? parseProject(j) : null;
    },
    async listTables(projectId, dataset) {
      const rows = await pages((t) => {
        const u = new URL(
          `https://${BQ_HOST}/bigquery/v2/projects/${safeId(projectId, /^[a-z0-9.:-]+$/, "project")}/datasets/${safeId(dataset, /^\w+$/, "dataset")}/tables`,
        );
        u.searchParams.set("maxResults", "1000");
        if (t) u.searchParams.set("pageToken", t);
        return u;
      }, "tables");
      return rows.map((r) => s(obj(r.tableReference).tableId)).filter((x): x is string => x !== null);
    },
    async queryCosts(projectId, dataset, table, billingAccountId, fromMonth) {
      const pid = safeId(projectId, /^[a-z0-9.:-]+$/, "project");
      const sql = buildCostQuery(pid, safeId(dataset, /^\w+$/, "dataset"), safeId(table, /^[\w$-]+$/, "table"));
      let j = obj(
        await call("POST", new URL(`https://${BQ_HOST}/bigquery/v2/projects/${pid}/queries`), {
          query: sql,
          useLegacySql: false,
          parameterMode: "NAMED",
          queryParameters: [
            { name: "account", parameterType: { type: "STRING" }, parameterValue: { value: billingAccountId } },
            { name: "fromMonth", parameterType: { type: "STRING" }, parameterValue: { value: fromMonth } },
          ],
          timeoutMs: 50_000,
          maxResults: 10_000,
        }),
      );
      const rows = parseBigQueryRows(j);
      const ref = obj(j.jobReference);
      const jobId = s(ref.jobId);
      const location = s(ref.location);
      // 還沒跑完、或結果超過一頁：用 getQueryResults（GET）接著讀
      for (let i = 0; jobId && (j.jobComplete === false || s(j.pageToken)) && i < MAX_PAGES; i++) {
        const u = new URL(`https://${BQ_HOST}/bigquery/v2/projects/${pid}/queries/${safeId(jobId, /^[\w.:$-]+$/, "job")}`);
        if (location) u.searchParams.set("location", location);
        u.searchParams.set("timeoutMs", "30000");
        u.searchParams.set("maxResults", "10000");
        const pageToken = j.jobComplete === false ? null : s(j.pageToken);
        if (pageToken) u.searchParams.set("pageToken", pageToken);
        j = obj(await call("GET", u));
        if (j.jobComplete !== false) rows.push(...parseBigQueryRows(j));
      }
      if (j.jobComplete === false) throw new GcpApiError(504, "BigQuery 查詢逾時，下次同步再試");
      return parseCostRows(rows);
    },
  };
}

// ---------------------------------------------------------------------------
// 組織層級：token 快取 + 成功 / 失敗回報
// ---------------------------------------------------------------------------

/**
 * 拿這個組織的 GCP client 並執行 fn。整合必須已連接、已開啟。
 * token 先用快取；401 時丟掉快取、換新 token 重試一次，再被拒才 markNeedsReauth。
 */
export async function withGcpClient<T>(
  orgId: string,
  fn: (client: GcpClient, row: IntegrationSummary) => Promise<T>,
): Promise<T> {
  const { row, credentials } = await requireEnabledIntegration(orgId, "gcp");
  let cached: string | null = (await loadTokenCache(orgId, "gcp"))?.value ?? null;
  const getToken = async () => {
    if (cached) return cached;
    const fresh = await fetchGcpToken(credentials, row.config, orgId);
    await saveTokenCache(orgId, "gcp", fresh.value, fresh.expiresAt);
    cached = fresh.value;
    return fresh.value;
  };
  const client = makeGcpClient(getToken);
  try {
    let out: T;
    try {
      out = await fn(client, row);
    } catch (e) {
      if (!(e instanceof GcpAuthError) || cached === null) throw e;
      cached = null;
      await clearTokenCache(orgId, "gcp");
      out = await fn(client, row);
    }
    await recordSyncSuccess(orgId, "gcp");
    return out;
  } catch (e) {
    if (e instanceof GcpAuthError) {
      await markNeedsReauth(orgId, "gcp", e.reauthMessage);
    } else if (e instanceof GcpApiError) {
      await recordSyncFailure(orgId, "gcp", e.message);
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Provider（testConnection）
// ---------------------------------------------------------------------------

export const gcpProvider: IntegrationProvider = {
  id: "gcp",
  async testConnection(creds, config, ctx) {
    const mode = gcpAuthMode(config);
    let principal: string;
    if (mode === "key") {
      const key = parseServiceAccountJson(creds.serviceAccountJson);
      if ("error" in key) return { ok: false, error: key.error };
      principal = key.clientEmail;
    } else {
      const wif = wifSettings(config);
      if ("error" in wif) return { ok: false, error: wif.error };
      principal = wif.serviceAccountEmail;
    }
    try {
      const token = await fetchGcpToken(creds, config, ctx.orgId);
      const client = makeGcpClient(async () => token.value);
      const accounts = await client.listBillingAccounts();
      if (accounts.length === 0) {
        return {
          ok: false,
          error: `這個 service account 看不到任何 billing account。請在要同步的 billing account 把 roles/billing.viewer 給 ${principal}`,
        };
      }
      return {
        ok: true,
        config: {
          discovered: accounts,
          discoveredAt: new Date().toISOString(),
          authMode: mode,
          serviceAccountEmail: principal,
        },
        tokenCache: token,
      };
    } catch (e) {
      if (e instanceof GcpApiError) return { ok: false, error: e.message };
      throw e;
    }
  },
};
