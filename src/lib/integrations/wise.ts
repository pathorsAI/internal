import {
  markNeedsReauth,
  recordSyncFailure,
  recordSyncSuccess,
  requireEnabledIntegration,
} from "./store";
import type { IntegrationConfig, IntegrationProvider, IntegrationSummary } from "./types";

/**
 * Wise（TransferWise）整合 —— **唯讀**。
 *
 * 這支只會對 Wise 發 GET：列 profile、列餘額、讀對帳單（balance statement）。
 * 不建立 quote、transfer、conversion，也不碰任何會動到錢的端點。為了讓這件事在程式上
 * 成立而不是只靠自律，所有請求都經過 `wiseGet()`：
 *   1. method 寫死 GET，且 `assertReadOnly()` 會拒絕任何非 GET；
 *   2. path 必須符合 READ_ONLY_PATHS 白名單之一，否則直接丟錯、不發請求。
 * 要新增端點就只能加進白名單，而且必須是 GET 的讀取端點。
 *
 * Token 只存在 server 記憶體：不進 log、不進錯誤訊息、不進回傳值。
 */

const WISE_BASE = "https://api.wise.com";

/** 允許呼叫的端點（全部是 GET 讀取）。 */
const READ_ONLY_PATHS: readonly RegExp[] = [
  /^\/v2\/profiles$/,
  /^\/v4\/profiles\/\d+\/balances$/,
  /^\/v1\/profiles\/\d+\/balance-statements\/\d+\/statement\.json$/,
];

/** 對帳單單次查詢上限是 469 天；我們一律按月切，遠低於上限。 */
const REQUEST_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// 錯誤
// ---------------------------------------------------------------------------

export class WiseApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "WiseApiError";
  }
}

/** Token 被 Wise 拒絕（401）。 */
export class WiseAuthError extends WiseApiError {
  constructor() {
    super(401, "Wise API token 無效或已撤銷，請 owner / admin 到 設定 › 整合 重新連接 Wise");
    this.name = "WiseAuthError";
  }
}

/** Wise 要求強驗證（SCA）才能讀這份資料。我們不實作 SCA 簽章。 */
export class WiseScaRequiredError extends WiseApiError {
  constructor() {
    super(
      403,
      "Wise 要求強驗證（SCA）才能讀取這份對帳單。本系統不支援 SCA 簽章：請改用不需 SCA 的 token（Wise 的個人 API token 通常不需要），或縮短查詢區間後再試",
    );
    this.name = "WiseScaRequiredError";
  }
}

// ---------------------------------------------------------------------------
// Wise 回應型別（只列我們用到的欄位）
// ---------------------------------------------------------------------------

export type WiseMoney = { value: number; currency: string };

export type WiseProfile = {
  id: number;
  type: "PERSONAL" | "BUSINESS" | string;
  fullName?: string;
  businessName?: string;
  details?: { name?: string; firstName?: string; lastName?: string };
};

export type WiseBalance = {
  id: number;
  currency: string;
  amount: WiseMoney;
  type?: string;
  name?: string | null;
};

export type WiseStatementTransaction = {
  type: "DEBIT" | "CREDIT" | string;
  date: string;
  amount: WiseMoney;
  totalFees?: WiseMoney | null;
  details?: {
    type?: string;
    description?: string | null;
    amount?: WiseMoney | null;
    category?: string | null;
    merchant?: {
      name?: string | null;
      city?: string | null;
      country?: string | null;
      category?: string | null;
    } | null;
    cardLastFourDigits?: string | null;
    cardHolderFullName?: string | null;
    senderName?: string | null;
    senderAccount?: string | null;
    recipient?: { name?: string | null } | string | null;
    paymentReference?: string | null;
    sourceAmount?: WiseMoney | null;
    targetAmount?: WiseMoney | null;
    rate?: number | null;
  } | null;
  exchangeDetails?: {
    toAmount?: WiseMoney | null;
    fromAmount?: WiseMoney | null;
    rate?: number | null;
  } | null;
  runningBalance?: WiseMoney | null;
  referenceNumber: string;
};

export type WiseStatement = {
  transactions: WiseStatementTransaction[];
  startOfStatementBalance?: WiseMoney | null;
  endOfStatementBalance?: WiseMoney | null;
};

/** 寫進 config 的精簡 profile / balance（非機密）。 */
export type WiseProfileSummary = { id: number; type: string; name: string };
export type WiseBalanceSummary = {
  profileId: number;
  balanceId: number;
  currency: string;
  /** 發現時的餘額（顯示用，可能過時；以 fetchedAt 為準）。 */
  amount: number | null;
  fetchedAt: string;
};

export function profileName(p: WiseProfile): string {
  if (p.type === "BUSINESS") return p.businessName ?? p.details?.name ?? `Business ${p.id}`;
  return (
    p.fullName ??
    ([p.details?.firstName, p.details?.lastName].filter(Boolean).join(" ") ||
      `Personal ${p.id}`)
  );
}

// ---------------------------------------------------------------------------
// 唯讀 HTTP
// ---------------------------------------------------------------------------

/** 任何非 GET 的請求一律拒絕 —— 這個整合永遠不得動到錢。 */
export function assertReadOnly(method: string, path: string): void {
  if (method.toUpperCase() !== "GET") {
    throw new Error(`Wise 整合是唯讀的，拒絕送出 ${method} ${path}`);
  }
  if (!READ_ONLY_PATHS.some((re) => re.test(path))) {
    throw new Error(`Wise 整合不允許呼叫 ${path}（不在唯讀端點白名單內）`);
  }
}

async function wiseGet<T>(
  token: string,
  path: string,
  query?: Record<string, string>,
): Promise<T> {
  assertReadOnly("GET", path);
  const url = new URL(path, WISE_BASE);
  for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (e) {
    throw new WiseApiError(0, `無法連線到 Wise：${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 401) throw new WiseAuthError();
  if (res.status === 403 && res.headers.get("x-2fa-approval")) throw new WiseScaRequiredError();
  if (!res.ok) {
    // 回應本文可能很長；只取開頭，且不含我們送出的任何東西（token 在 header，不會回顯）。
    const body = (await res.text().catch(() => "")).slice(0, 200);
    throw new WiseApiError(res.status, `Wise 回應 ${res.status}${body ? `：${body}` : ""}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export type WiseClient = {
  listProfiles(): Promise<WiseProfile[]>;
  listBalances(profileId: number): Promise<WiseBalance[]>;
  /** start / end 是 ISO 8601 時間點（UTC）。 */
  getStatement(
    profileId: number,
    balanceId: number,
    currency: string,
    start: string,
    end: string,
  ): Promise<WiseStatement>;
};

function makeClient(token: string): WiseClient {
  return {
    listProfiles: () => wiseGet<WiseProfile[]>(token, "/v2/profiles"),
    listBalances: (profileId) =>
      wiseGet<WiseBalance[]>(token, `/v4/profiles/${Math.trunc(profileId)}/balances`, {
        types: "STANDARD",
      }),
    getStatement: (profileId, balanceId, currency, start, end) =>
      wiseGet<WiseStatement>(
        token,
        `/v1/profiles/${Math.trunc(profileId)}/balance-statements/${Math.trunc(balanceId)}/statement.json`,
        { currency, intervalStart: start, intervalEnd: end, type: "COMPACT" },
      ),
  };
}

/** 探索這支 token 看得到的 profile 與 STANDARD 餘額。 */
export async function discoverAccounts(client: WiseClient): Promise<{
  profiles: WiseProfileSummary[];
  balances: WiseBalanceSummary[];
}> {
  const profiles = await client.listProfiles();
  const fetchedAt = new Date().toISOString();
  const balances: WiseBalanceSummary[] = [];
  for (const p of profiles) {
    const list = await client.listBalances(p.id);
    for (const b of list) {
      balances.push({
        profileId: p.id,
        balanceId: b.id,
        currency: b.currency,
        amount: typeof b.amount?.value === "number" ? b.amount.value : null,
        fetchedAt,
      });
    }
  }
  return {
    profiles: profiles.map((p) => ({ id: p.id, type: p.type, name: profileName(p) })),
    balances,
  };
}

/**
 * 拿這個組織的 Wise client 並執行 fn。整合必須已連接、已開啟（否則丟
 * IntegrationUnavailableError）。成功記 recordSyncSuccess；401 → markNeedsReauth；
 * 其他錯誤 → recordSyncFailure。錯誤會原樣往外丟。
 */
export async function withWiseClient<T>(
  orgId: string,
  fn: (client: WiseClient, row: IntegrationSummary) => Promise<T>,
): Promise<T> {
  const { row, credentials } = await requireEnabledIntegration(orgId, "wise");
  const token = credentials.apiToken;
  if (!token) throw new WiseAuthError();
  try {
    const out = await fn(makeClient(token), row);
    await recordSyncSuccess(orgId, "wise");
    return out;
  } catch (e) {
    if (e instanceof WiseAuthError) {
      await markNeedsReauth(orgId, "wise", "Wise API token 無效或已撤銷");
    } else if (e instanceof WiseApiError) {
      await recordSyncFailure(orgId, "wise", e.message);
    }
    throw e;
  }
}

/** getWiseClient 的「拿了就用」版本；不自動記錄成功 / 失敗，給需要自己控管的呼叫端。 */
export async function getWiseClient(orgId: string): Promise<{
  client: WiseClient;
  row: IntegrationSummary;
}> {
  const { row, credentials } = await requireEnabledIntegration(orgId, "wise");
  if (!credentials.apiToken) throw new WiseAuthError();
  return { client: makeClient(credentials.apiToken), row };
}

// ---------------------------------------------------------------------------
// Provider（testConnection）
// ---------------------------------------------------------------------------

export const wiseProvider: IntegrationProvider = {
  id: "wise",
  async testConnection(creds): Promise<
    { ok: true; config: IntegrationConfig } | { ok: false; error: string }
  > {
    const token = creds.apiToken?.trim();
    if (!token) return { ok: false, error: "請輸入 Wise API token" };
    try {
      const { profiles, balances } = await discoverAccounts(makeClient(token));
      if (profiles.length === 0) {
        return { ok: false, error: "這支 token 看不到任何 Wise profile" };
      }
      return { ok: true, config: { profiles, balances } };
    } catch (e) {
      if (e instanceof WiseAuthError) return { ok: false, error: "API token 無效或已撤銷" };
      if (e instanceof WiseApiError) return { ok: false, error: e.message };
      throw e;
    }
  },
};
