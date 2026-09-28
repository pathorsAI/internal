import {
  clearTokenCache,
  loadTokenCache,
  markNeedsReauth,
  recordSyncFailure,
  recordSyncSuccess,
  requireEnabledIntegration,
  saveTokenCache,
  updateConfig,
} from "./store";
import type {
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationProvider,
  TokenCache,
} from "./types";

/**
 * Simpany（simpany.co）電子發票加值中心。
 *
 * ⚠️ Simpany 沒有公開 API。這裡用的是它會員網頁背後的私有 REST API（讀前端 bundle
 * 與實際唯讀呼叫確認過形狀），隨時可能改版。因此：
 * - 所有回應都當成 unknown 防禦式解析，認不得就把 Simpany 的原始錯誤訊息（截短）丟回去，
 *   不猜。
 * - 帳密（account / password）與 JWT 只存在 server 記憶體，不寫 log、不進錯誤訊息、
 *   不進任何回傳值。
 *
 * 兩個 host：
 * - api.simpany.co/v1        登入、/me（使用者與公司清單）
 * - member2.simpany.co/api/v1/c/{companyId}/   電子發票（receipts）
 */

const AUTH_BASE = "https://api.simpany.co/v1";
const EINVOICE_BASE = "https://member2.simpany.co/api/v1/c";

/** 取不到 JWT exp 時的保守效期。 */
const FALLBACK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const BASE_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

// ---------------------------------------------------------------------------
// Types (only the fields we rely on; everything else passes through as unknown)
// ---------------------------------------------------------------------------

export type SimpanyCompany = { id: number; name: string; regId: string | null };

export type SimpanyReceiptType = "B2B" | "B2C";
export type SimpanyTaxType = "TAXABLE" | "ZERO_TAX_RATE" | "EXEMPTION";

export type SimpanyReceiptListItem = {
  id: string;
  invoiceNumber: string | null;
  type: string;
  status: string;
  buyerVat: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  totalAmount: number;
  issuedAt: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
  /** Simpany 說這張現在能不能作廢；回應沒有這個欄位時為 null。 */
  canInvalidate: boolean | null;
  allowances: unknown[];
};

export type SimpanyReceiptItem = {
  name: string;
  quantity: number;
  price: number;
  amount: number;
};

export type SimpanyReceiptDetail = SimpanyReceiptListItem & {
  uploadStatus: string | null;
  printStatus: string | null;
  randomNumber: string | null;
  buyerEmails: string[];
  taxType: string | null;
  customsClearanceType: string | null;
  zeroTaxRateReason: { code: string; name: string } | null;
  taxRate: number | null;
  isTaxIncluded: boolean | null;
  taxAmount: number;
  untaxedAmount: number;
  remark: string | null;
  carrierType: string | null;
  items: SimpanyReceiptItem[];
};

export type SimpanyListParams = {
  status: "ALL" | "INVALID";
  startDate: string;
  endDate: string;
  query?: string;
  page?: number;
  limit?: number;
};

export type SimpanyPage<T> = {
  data: T[];
  currentPage: number;
  lastPage: number;
  total: number;
};

export type SimpanyZeroTaxReason = { code: string; name: string };

/** POST receipts/{b2b|b2c} 的 body，照 Simpany 會員網頁組的樣子。 */
export type SimpanyCreateBody = {
  customId: null;
  customer: { vat?: string; name: string; address: string; emails: string[] };
  taxType: SimpanyTaxType;
  customsClearanceType: "NOT_VIA_CUSTOMS" | "VIA_CUSTOMS" | null;
  remark: string;
  isTaxIncluded: boolean;
  shouldAdjustTaxAmount: false;
  carrier: { type: string | null; number: string | null };
  npoBan: null;
  items: { name: string; quantity: number; price: number; subTotal: number }[];
  autocompleteSelectedIsVender: false;
  zeroTaxRateReasonCode: string | null;
};

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SimpanyErrorKind = "auth" | "validation" | "business" | "http" | "network" | "config";

/** 給人看的錯誤。message 永遠不含帳密或 token。 */
export class SimpanyError extends Error {
  constructor(
    readonly kind: SimpanyErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "SimpanyError";
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** 回應 body 截短後的字串，錯誤訊息用。 */
function snippet(body: unknown): string {
  let s: string;
  try {
    s = typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    s = String(body);
  }
  s = s.replaceAll(/\s+/g, " ").trim();
  return s.length > 400 ? `${s.slice(0, 399)}…` : s;
}

/** 驗證錯誤：{ errors: { field: [msg] } } → 「field: msg、msg；field: msg」；沒有內容回 null。 */
function validationErrorsMessage(errors: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [field, msgs] of Object.entries(errors)) {
    const list = Array.isArray(msgs) ? msgs.map((m) => str(m) ?? snippet(m)) : [snippet(msgs)];
    parts.push(`${field}: ${list.join("、")}`);
  }
  return parts.length ? parts.join("；") : null;
}

/** 業務錯誤：{ status: "error", error: { title, details } } / { error: { code } }；沒有內容回 null。 */
function businessErrorMessage(e: Record<string, unknown>): string | null {
  const title = str(e.title) ?? str(e.message);
  const details = str(e.details) ?? (e.details === undefined ? null : snippet(e.details));
  const code = str(e.code);
  const text = [title, details].filter(Boolean).join("：");
  if (text) return code ? `${text}（${code}）` : text;
  if (code) return `錯誤代碼 ${code}`;
  return null;
}

/** 從 Simpany 的各種錯誤形狀裡抽出人看得懂的訊息。 */
export function simpanyErrorMessage(body: unknown): string | null {
  if (!isObj(body)) return typeof body === "string" && body.trim() ? snippet(body) : null;
  if (isObj(body.errors)) {
    const validation = validationErrorsMessage(body.errors);
    if (validation) return validation;
  }
  if (isObj(body.error)) {
    const business = businessErrorMessage(body.error);
    if (business) return business;
  }
  const message = str(body.message);
  if (message) return message;
  return snippet(body);
}

/** JWT 的 exp（秒）→ Date；解不出來回 null。只讀 payload，不驗簽（那是 Simpany 的事）。 */
export function jwtExpiry(token: string): Date | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    while (b64.length % 4) b64 += "=";
    const payload: unknown = JSON.parse(atob(b64));
    if (isObj(payload) && typeof payload.exp === "number") {
      const d = new Date(payload.exp * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  } catch {
    // fall through
  }
  return null;
}

function parseCompany(v: unknown): SimpanyCompany | null {
  if (!isObj(v)) return null;
  const id = numOrNull(v.id);
  if (id == null) return null;
  return { id, name: str(v.name) ?? String(id), regId: str(v.reg_id) ?? str(v.regId) };
}

export function parseListItem(v: unknown): SimpanyReceiptListItem | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  if (!id) return null;
  return {
    id,
    invoiceNumber: str(v.invoiceNumber),
    type: str(v.type) ?? "",
    status: str(v.status) ?? "",
    buyerVat: str(v.buyerVat),
    buyerName: str(v.buyerName),
    buyerAddress: str(v.buyerAddress),
    totalAmount: num(v.totalAmount),
    issuedAt: str(v.issuedAt),
    invalidatedAt: str(v.invalidatedAt),
    invalidReason: str(v.invalidReason),
    canInvalidate: bool(v.canInvalidate),
    allowances: Array.isArray(v.allowances) ? v.allowances : [],
  };
}

export function parseDetail(v: unknown): SimpanyReceiptDetail | null {
  const base = parseListItem(v);
  if (!base || !isObj(v)) return null;
  const reason = isObj(v.zeroTaxRateReason)
    ? {
        code: str(v.zeroTaxRateReason.code) ?? "",
        name: str(v.zeroTaxRateReason.name) ?? "",
      }
    : null;
  const items: SimpanyReceiptItem[] = Array.isArray(v.items)
    ? v.items.filter(isObj).map((it) => ({
        name: str(it.name) ?? "",
        quantity: num(it.quantity),
        price: num(it.price),
        amount: num(it.amount),
      }))
    : [];
  return {
    ...base,
    uploadStatus: str(v.uploadStatus),
    printStatus: str(v.printStatus),
    randomNumber: str(v.randomNumber),
    buyerEmails: Array.isArray(v.buyerEmails)
      ? v.buyerEmails.map((e) => str(e)).filter((e): e is string => Boolean(e))
      : [],
    taxType: str(v.taxType),
    customsClearanceType: str(v.customsClearanceType),
    zeroTaxRateReason: reason?.code ? reason : null,
    taxRate: numOrNull(v.taxRate),
    isTaxIncluded: bool(v.isTaxIncluded),
    taxAmount: num(v.taxAmount),
    untaxedAmount: num(v.untaxedAmount),
    remark: str(v.remark),
    carrierType: str(v.carrierType),
    items,
  };
}

/** `{ data: {...} }` 或直接是物件，兩種都接受。 */
function unwrapData(body: unknown): unknown {
  return isObj(body) && "data" in body ? body.data : body;
}

// ---------------------------------------------------------------------------
// Raw HTTP (no DB side effects) — shared by testConnection and the client
// ---------------------------------------------------------------------------

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    // 網路層錯誤的訊息不會含 headers，但保險起見只取 message。
    const msg = e instanceof Error ? e.message : String(e);
    throw new SimpanyError("network", `無法連線到 Simpany：${msg}`);
  }
}

/** 登入換 JWT。帳密錯誤丟 kind = "auth"。 */
async function login(creds: IntegrationCredentials): Promise<TokenCache> {
  const account = creds.account?.trim();
  const password = creds.password;
  if (!account || !password) {
    throw new SimpanyError("auth", "Simpany 帳號或密碼未設定");
  }
  const res = await safeFetch(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: { ...BASE_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });
  const body = await readBody(res);
  const token = isObj(body) && isObj(body.data) ? str(body.data.token) : null;
  if (res.ok && token && isObj(body) && (body.status === "ok" || body.status === undefined)) {
    const expiresAt = jwtExpiry(token) ?? new Date(Date.now() + FALLBACK_TOKEN_TTL_MS);
    return { value: token, expiresAt };
  }
  const code =
    isObj(body) && isObj(body.error) ? numOrNull(body.error.code) : null;
  if (res.status === 401 || code === 401 || code === 404) {
    throw new SimpanyError("auth", "Simpany 帳號或密碼錯誤", 401);
  }
  if (res.status >= 500) {
    throw new SimpanyError("http", `Simpany 登入失敗（HTTP ${res.status}）`, res.status);
  }
  const reason = simpanyErrorMessage(body) ?? `HTTP ${res.status}`;
  throw new SimpanyError("http", `Simpany 登入失敗：${reason}`, res.status);
}

async function fetchCompanies(token: string): Promise<SimpanyCompany[]> {
  const res = await safeFetch(`${AUTH_BASE}/me`, {
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
  });
  const body = await readBody(res);
  if (res.status === 401) throw new SimpanyError("auth", "Simpany 登入已失效", 401);
  if (!res.ok) {
    const reason = simpanyErrorMessage(body) ?? `HTTP ${res.status}`;
    throw new SimpanyError("http", `讀取 Simpany 公司清單失敗：${reason}`, res.status);
  }
  const data = unwrapData(body);
  const companies = isObj(data) && Array.isArray(data.companies) ? data.companies : [];
  return companies.map(parseCompany).filter((c): c is SimpanyCompany => c !== null);
}

/**
 * 決定要用哪一家公司。有指定 companyId 就驗證它在清單內；只有一家就自動選；
 * 多家且沒指定就要求使用者填。
 */
function resolveCompany(
  companies: SimpanyCompany[],
  wanted: unknown,
): { ok: true; company: SimpanyCompany } | { ok: false; error: string } {
  if (companies.length === 0) {
    return { ok: false, error: "這個 Simpany 帳號底下沒有任何公司" };
  }
  const wantedId = numOrNull(typeof wanted === "string" ? wanted.trim() : wanted);
  if (wantedId != null) {
    const hit = companies.find((c) => c.id === wantedId);
    if (hit) return { ok: true, company: hit };
    return {
      ok: false,
      error: `找不到公司 ID ${wantedId}。這個帳號可用的公司：${companies
        .map((c) => `${c.name}（${c.id}）`)
        .join("、")}`,
    };
  }
  if (companies.length === 1) return { ok: true, company: companies[0] };
  return {
    ok: false,
    error: `這個 Simpany 帳號有多家公司，請在「公司 ID」欄位填入要使用的那一家：${companies
      .map((c) => `${c.name}（${c.id}）`)
      .join("、")}`,
  };
}

// ---------------------------------------------------------------------------
// Provider (settings › integrations: connect / reconnect)
// ---------------------------------------------------------------------------

export const simpanyProvider: IntegrationProvider = {
  id: "simpany",
  async testConnection(creds, config) {
    let token: TokenCache;
    try {
      token = await login(creds);
    } catch (e) {
      if (e instanceof SimpanyError && e.kind === "auth") return { ok: false, error: e.message };
      throw e;
    }
    const companies = await fetchCompanies(token.value);
    const resolved = resolveCompany(companies, config.companyId);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return {
      ok: true,
      config: { companyId: resolved.company.id, companyName: resolved.company.name },
      tokenCache: token,
    };
  },
};

// ---------------------------------------------------------------------------
// Runtime client (business code)
// ---------------------------------------------------------------------------

/**
 * 用帳密重新登入並把新 token 加密存回快取。帳密被拒 → markNeedsReauth 並丟清楚的中文錯誤；
 * 其他失敗 → recordSyncFailure 後原樣丟出。
 */
async function loginAndCache(orgId: string, credentials: IntegrationCredentials): Promise<string> {
  try {
    const fresh = await login(credentials);
    await saveTokenCache(orgId, "simpany", fresh.value, fresh.expiresAt);
    return fresh.value;
  } catch (e) {
    if (e instanceof SimpanyError && e.kind === "auth") {
      await markNeedsReauth(orgId, "simpany", "Simpany 帳號或密碼已失效");
      throw new SimpanyError(
        "auth",
        "Simpany 拒絕了儲存的帳號密碼（可能改過密碼）。請 owner 或 admin 到 設定 › 整合 重新連接 Simpany。",
        401,
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    await recordSyncFailure(orgId, "simpany", msg.slice(0, 500));
    throw e;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

/**
 * 已登入、已選定公司的 Simpany client。用 getSimpanyClient(orgId) 取得。
 *
 * Token 流程：先用快取的 JWT；收到 401 就丟掉快取、用帳密重新登入、重試一次；
 * 重新登入本身被拒（帳密錯）→ markNeedsReauth，整合轉為「需要重新連接」。
 * 網路錯 / 5xx → recordSyncFailure（狀態不變）。成功 → recordSyncSuccess（每個 client 只記一次）。
 */
export class SimpanyClient {
  private token: string | null;
  private successRecorded = false;

  constructor(
    private readonly orgId: string,
    private readonly credentials: IntegrationCredentials,
    readonly companyId: number,
    readonly companyName: string | null,
    cached: TokenCache | null,
  ) {
    this.token = cached?.value ?? null;
  }

  // ---- token ----

  private async relogin(): Promise<string> {
    this.token = await loginAndCache(this.orgId, this.credentials);
    return this.token;
  }

  private async failure(e: unknown): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e);
    await recordSyncFailure(this.orgId, "simpany", msg.slice(0, 500));
  }

  private async success(): Promise<void> {
    if (this.successRecorded) return;
    this.successRecorded = true;
    await recordSyncSuccess(this.orgId, "simpany");
  }

  // ---- HTTP ----

  private url(path: string, query?: RequestOptions["query"]): string {
    const u = new URL(`${EINVOICE_BASE}/${this.companyId}/${path}`);
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async send(token: string, path: string, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { ...BASE_HEADERS, Authorization: `Bearer ${token}` };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    return safeFetch(this.url(path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  }

  /** 發一個 e-invoice API 請求，回傳解析後的 body。錯誤一律丟 SimpanyError。 */
  async request(path: string, opts: RequestOptions = {}): Promise<unknown> {
    let res: Response;
    try {
      const token = this.token ?? (await this.relogin());
      res = await this.send(token, path, opts);
      if (res.status === 401) {
        // 快取的 token 過期或被撤銷：重新登入、重試一次。
        await clearTokenCache(this.orgId, "simpany");
        this.token = null;
        const fresh = await this.relogin();
        res = await this.send(fresh, path, opts);
        if (res.status === 401) {
          await markNeedsReauth(this.orgId, "simpany", "Simpany 拒絕了新登入的 token");
          throw new SimpanyError(
            "auth",
            "Simpany 重新登入後仍拒絕存取。請 owner 或 admin 到 設定 › 整合 重新連接 Simpany。",
            401,
          );
        }
      }
    } catch (e) {
      if (e instanceof SimpanyError && e.kind === "network") await this.failure(e);
      throw e;
    }

    const body = await readBody(res);
    if (res.ok) {
      // 業務錯誤有時仍是 2xx：{ status: "error", error: {...} }
      if (isObj(body) && body.status === "error") {
        throw new SimpanyError(
          "business",
          `Simpany 回應錯誤：${simpanyErrorMessage(body) ?? "未知錯誤"}`,
          res.status,
        );
      }
      await this.success();
      return body;
    }
    if (res.status >= 500 || res.status === 429) {
      const err = new SimpanyError(
        "http",
        `Simpany 暫時無法處理（HTTP ${res.status}）：${simpanyErrorMessage(body) ?? "無訊息"}`,
        res.status,
      );
      await this.failure(err);
      throw err;
    }
    const kind: SimpanyErrorKind = res.status === 422 || (isObj(body) && isObj(body.errors))
      ? "validation"
      : "business";
    throw new SimpanyError(
      kind,
      `Simpany 拒絕了這個請求（HTTP ${res.status}）：${simpanyErrorMessage(body) ?? "無訊息"}`,
      res.status,
    );
  }

  // ---- receipts ----

  async listReceipts(params: SimpanyListParams): Promise<SimpanyPage<SimpanyReceiptListItem>> {
    const body = await this.request("receipts", {
      query: {
        status: params.status,
        startDate: params.startDate,
        endDate: params.endDate,
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        query: params.query,
      },
    });
    const data = isObj(body) && Array.isArray(body.data) ? body.data : [];
    const meta = isObj(body) && isObj(body.meta) ? body.meta : {};
    return {
      data: data.map(parseListItem).filter((r): r is SimpanyReceiptListItem => r !== null),
      currentPage: num(meta.current_page) || params.page || 1,
      lastPage: num(meta.last_page) || 1,
      total: num(meta.total),
    };
  }

  /** 走完所有分頁。maxPages 是保險絲（Workers 的 subrequest 上限）。 */
  async listAllReceipts(
    params: Omit<SimpanyListParams, "page" | "limit">,
    maxPages = 20,
  ): Promise<{ items: SimpanyReceiptListItem[]; truncated: boolean }> {
    const items: SimpanyReceiptListItem[] = [];
    let page = 1;
    for (;;) {
      const res = await this.listReceipts({ ...params, page, limit: 100 });
      items.push(...res.data);
      if (page >= res.lastPage || res.data.length === 0) return { items, truncated: false };
      if (page >= maxPages) return { items, truncated: true };
      page++;
    }
  }

  async getReceipt(id: string): Promise<SimpanyReceiptDetail> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SimpanyError("config", `不合法的 Simpany 發票 id：${id}`);
    const body = await this.request(`receipts/${encodeURIComponent(id)}`);
    const detail = parseDetail(unwrapData(body));
    if (!detail) {
      throw new SimpanyError("business", `Simpany 回傳的發票明細格式無法辨識：${snippet(body)}`);
    }
    return detail;
  }

  /**
   * 開立發票（POST receipts/{b2b|b2c}）。**會產生正式的電子發票並上傳財政部、寄信給買受人。**
   * 只能由 simpany-issue.ts 以使用者確認過的草稿呼叫。
   * 回傳 Simpany 的回應 data（形狀未經實測，呼叫端應再以 getReceipt 取完整明細）。
   */
  async createReceipt(type: SimpanyReceiptType, payload: SimpanyCreateBody): Promise<unknown> {
    const body = await this.request(`receipts/${type.toLowerCase()}`, {
      method: "POST",
      body: payload,
    });
    return unwrapData(body);
  }

  /** 作廢（DELETE receipts/{id}）。不可復原，Simpany 會通知買受人。 */
  async invalidateReceipt(id: string, reason: string): Promise<unknown> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SimpanyError("config", `不合法的 Simpany 發票 id：${id}`);
    const body = await this.request(`receipts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: { reason, emails: [] },
    });
    return body;
  }

  async getZeroTaxReasons(): Promise<SimpanyZeroTaxReason[]> {
    const body = await this.request("receipts/zero-tax-rate-reasons");
    const data = unwrapData(body);
    const list = Array.isArray(data) ? data : [];
    return list
      .filter(isObj)
      .map((r) => ({ code: str(r.code) ?? "", name: str(r.name) ?? "" }))
      .filter((r) => r.code !== "");
  }

  /**
   * 今年（民國年）字軌剩餘號碼數。回應形狀未經驗證 —— 解析不出來就回 null，
   * 呼叫端只能拿來提示，不可據此擋開立。
   */
  async getRemainingTrackNumbers(date = new Date()): Promise<number | null> {
    const rocYear = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric" }).format(date),
    ) - 1911;
    try {
      const body = await this.request("track-numbers", { query: { year: rocYear } });
      return sumRemaining(unwrapData(body));
    } catch {
      return null;
    }
  }
}

/** 在未知形狀裡找「剩餘」類欄位加總；找不到回 null。 */
function sumRemaining(data: unknown): number | null {
  const KEYS = ["remaining", "remainingCount", "remaining_count", "availableCount", "available", "unusedCount", "remain"];
  let found = false;
  let total = 0;
  const visit = (v: unknown, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    for (const k of KEYS) {
      const n = numOrNull(v[k]);
      if (n != null) {
        found = true;
        total += n;
        return;
      }
    }
    for (const x of Object.values(v)) if (typeof x === "object") visit(x, depth + 1);
  };
  visit(data, 0);
  return found ? total : null;
}

/**
 * 業務程式碼的入口：確認整合可用、決定公司、帶上快取 token。
 * 整合沒連接 / 沒開 / 需要重新連接時丟 IntegrationUnavailableError（訊息告訴使用者怎麼修）。
 */
export async function getSimpanyClient(orgId: string): Promise<SimpanyClient> {
  const { row, credentials } = await requireEnabledIntegration(orgId, "simpany");
  let cached = await loadTokenCache(orgId, "simpany");
  const config: IntegrationConfig = row.config ?? {};
  const companyId = numOrNull(config.companyId);
  const companyName = typeof config.companyName === "string" ? config.companyName : null;
  if (companyId != null) {
    return new SimpanyClient(orgId, credentials, companyId, companyName, cached);
  }

  // 舊連接沒存公司：查一次 /me 並寫回 config。
  let companies: SimpanyCompany[];
  try {
    const token = cached?.value ?? (await loginAndCache(orgId, credentials));
    companies = await fetchCompanies(token);
  } catch (e) {
    if (!(e instanceof SimpanyError && e.kind === "auth" && cached)) throw e;
    await clearTokenCache(orgId, "simpany");
    cached = null;
    companies = await fetchCompanies(await loginAndCache(orgId, credentials));
  }
  const resolved = resolveCompany(companies, config.companyId);
  if (!resolved.ok) throw new SimpanyError("config", resolved.error);
  await updateConfig(orgId, "simpany", {
    companyId: resolved.company.id,
    companyName: resolved.company.name,
  });
  return new SimpanyClient(
    orgId,
    credentials,
    resolved.company.id,
    resolved.company.name,
    cached ?? (await loadTokenCache(orgId, "simpany")),
  );
}
