import type integrationsMessages from "@/i18n/messages/integrations";

// 組織層級外部整合的共用型別。client 與 server 都會 import 這支，所以這裡只能有
// 型別與純常數，不能碰 DB 或 crypto。

/**
 * 系統認得的整合代號。必須與 migrations/0023 的 chk_org_integration_provider 一致 ——
 * 新增一家要同時：寫新 migration 擴充 CHECK、在這裡加代號、在 catalog.ts 補一筆。
 */
export const INTEGRATION_PROVIDER_IDS = ["simpany", "wise"] as const;
export type IntegrationProviderId = (typeof INTEGRATION_PROVIDER_IDS)[number];

export function isIntegrationProviderId(v: unknown): v is IntegrationProviderId {
  return (
    typeof v === "string" && (INTEGRATION_PROVIDER_IDS as readonly string[]).includes(v)
  );
}

/** 對應 org_integrations.status。 */
export type IntegrationStatus = "connected" | "needs_reauth" | "error";

/**
 * 欄位的輸入型態。password / token 在 UI 以遮罩輸入、且永遠不回填；
 * text / email 是一般輸入。
 */
export type IntegrationFieldType = "text" | "email" | "password" | "token";

/** 欄位標籤的 i18n key（integrations.fields.<key>）；新增欄位要先補字串。 */
export type IntegrationFieldLabelKey = keyof (typeof integrationsMessages)["fields"];

export type IntegrationField = {
  /** 存進憑證 / config 物件時用的 key。 */
  key: string;
  labelKey: IntegrationFieldLabelKey;
  type: IntegrationFieldType;
  required: boolean;
  /** 瀏覽器自動填入提示；帳密類整合填了能讓密碼管理器幫忙。 */
  autoComplete?: string;
};

/** 解密後的憑證：key 就是 credentialFields 的 key。只存在 server 記憶體中。 */
export type IntegrationCredentials = Record<string, string>;

/** 非機密設定（公司 id、帳戶對應等）。會顯示給成員與 MCP。 */
export type IntegrationConfig = Record<string, unknown>;

/** 靜態目錄的一筆：UI 要畫出這個整合所需的一切，不含任何實作。 */
export type IntegrationCatalogEntry = {
  id: IntegrationProviderId;
  /** 清單上的 logo 方塊：一個字 + Tailwind 底色 / 字色 class。 */
  logo: { letter: string; className: string };
  /** 連接時要輸入的機密欄位（加密存放）。 */
  credentialFields: readonly IntegrationField[];
  /** 連接時可一併輸入的非機密設定（明文存 config）。沒有就省略。 */
  configFields?: readonly IntegrationField[];
  /** 服務本身的網站，給使用者參考。 */
  website?: string;
};

export type TokenCache = { value: string; expiresAt: Date };

export type TestConnectionResult =
  | {
      ok: true;
      /** 測試時順便發現的非機密設定（例如公司 id），會合併進 config。 */
      config?: IntegrationConfig;
      /** 登入換來的 session token，會加密存進 token_cache_enc。 */
      tokenCache?: TokenCache;
    }
  | { ok: false; error: string };

/**
 * 一個整合的「實作」。顯示用的資料（名稱、欄位）在 catalog.ts；這裡只放會打外部
 * 服務的邏輯。實作放在 src/lib/integrations/<id>.ts，並在 registry.ts 登記一行。
 *
 * 規則：
 * - testConnection 不得拋錯表達「憑證錯」，要回 { ok: false, error }（error 給人看，
 *   不得含憑證）。網路錯等非預期狀況可以拋，框架會轉成錯誤訊息。
 * - 不得把 creds 寫進 log、錯誤訊息或回傳值。
 */
export interface IntegrationProvider {
  id: IntegrationProviderId;
  testConnection(
    creds: IntegrationCredentials,
    config: IntegrationConfig,
  ): Promise<TestConnectionResult>;
}

/**
 * 給 client 與 MCP 看的整合狀態。刻意不含任何密文或憑證欄位 ——
 * 型別上就拿不到，避免哪天有人 `...row` 一路傳到前端。
 */
export type IntegrationSummary = {
  provider: IntegrationProviderId;
  enabled: boolean;
  status: IntegrationStatus;
  config: IntegrationConfig;
  connectedAt: string;
  connectedByUserId: string | null;
  connectedByName: string | null;
  tokenExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  lastErrorAt: string | null;
  updatedAt: string;
};
