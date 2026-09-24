# Integrations framework

Per-organization connections to external services (Simpany e-invoice, Wise, …).
Every integration is **off by default**: an owner/admin *connects* it (enters
credentials, which are tested server-side before being stored), then *switches it
on* separately. Disconnecting deletes the row, credentials included.

Google Calendar predates this framework and is **not** stored here (its token lives
in better-auth's `account` table, its settings in `calendar_settings`). The
settings page just lists it alongside the others.

## Pieces

| Where | What |
| --- | --- |
| `migrations/0023_org_integrations.sql` / `orgIntegrations` in `src/db/schema.ts` | One row per (organization, provider). `credentials_enc` / `token_cache_enc` are ciphertext from `src/lib/crypto.ts` (`FIELD_ENCRYPTION_KEY`). `config` is non-secret jsonb. |
| `src/lib/integrations/types.ts` | Provider ids, field/catalog/provider types, `IntegrationSummary` (the secret-free view). Client-safe. |
| `src/lib/integrations/catalog.ts` | Static catalog: logo + credential/config fields per provider. Drives the settings UI. Client-safe. |
| `src/lib/integrations/registry.ts` | Map of **implementations** (`testConnection`). Simpany and Wise are registered. Server only. |
| `src/lib/integrations/store.ts` | The only code that reads/writes `org_integrations`. Server only. |
| `src/app/dashboard/settings/integrations/` | Settings page, server actions (owner/admin only), connect Sheet. |
| `src/lib/mcp/tools-integrations.ts` | `list_integrations`, plus `requireIntegrationForTool` and `auditIntegrationCall` for provider tools. |

## Lifecycle

```
(no row) --connect: testConnection ok--> connected, enabled=false
connected --toggle--> enabled=true/false
any call gets 401/invalid creds --markNeedsReauth--> needs_reauth (enabled kept)
needs_reauth --reconnect: testConnection ok--> connected (enabled restored as it was)
any --disconnect--> (row deleted)
```

"Usable" means `enabled AND status = 'connected'`. `requireEnabledIntegration`
enforces exactly that and throws `IntegrationUnavailableError` whose message tells
the user what to do (e.g. 「Simpany 電子發票 整合尚未連接／未開啟，請 owner 或 admin 到 設定 › 整合 開啟」).

## Store API (`src/lib/integrations/store.ts`)

```ts
// secret-free reads
getIntegration(orgId, provider): Promise<IntegrationSummary | null>
listIntegrations(orgId): Promise<IntegrationSummary[]>
integrationDisplayName(provider): Promise<string>

// secret reads — server memory only, never return/log them
loadCredentials(orgId, provider): Promise<IntegrationCredentials | null>
loadTokenCache(orgId, provider): Promise<TokenCache | null>          // null if missing/expired (60s skew)
requireEnabledIntegration(orgId, provider): Promise<{ row: IntegrationSummary; credentials: IntegrationCredentials }>

// runtime reporting from provider code
saveTokenCache(orgId, provider, value: string, expiresAt: Date): Promise<void>
clearTokenCache(orgId, provider): Promise<void>
markNeedsReauth(orgId, provider, error: string): Promise<void>       // credentials rejected
recordSyncFailure(orgId, provider, error: string): Promise<void>     // transient failure, status unchanged
recordSyncSuccess(orgId, provider): Promise<void>                    // sets last_synced_at, clears last_error
updateConfig(orgId, provider, patch): Promise<IntegrationConfig | null>  // shallow jsonb merge

// used by the settings actions (they do the role check)
saveConnection({ orgId, provider, userId, credentials, config, tokenCache? }): Promise<void>
setIntegrationEnabled(orgId, provider, enabled): Promise<number>
deleteIntegration(orgId, provider): Promise<number>
```

## Adding a provider

Simpany and Wise are already in the DB `CHECK`, in `INTEGRATION_PROVIDER_IDS`, in
the catalog (Simpany: `account` email + `password`; Wise: `apiToken`) and in i18n.
To bring one to life:

1. **Implementation** — `src/lib/integrations/<id>.ts`:

   ```ts
   import type { IntegrationProvider } from "./types";

   export const wiseProvider: IntegrationProvider = {
     id: "wise",
     async testConnection(creds, config) {
       const res = await fetch("https://api.wise.com/v2/profiles", {
         headers: { Authorization: `Bearer ${creds.apiToken}` },
       });
       if (res.status === 401) return { ok: false, error: "API token 無效或已撤銷" };
       if (!res.ok) return { ok: false, error: `Wise 回應 ${res.status}` };
       const profiles = await res.json();
       return { ok: true, config: { profileId: profiles[0]?.id } };
     },
   };
   ```

   - Return `{ ok: false, error }` for bad credentials; `error` is shown to the user
     and must never contain the credentials. Throwing is reserved for unexpected
     failures (the framework turns it into a message).
   - Return discovered non-secret settings in `config`; return a session token in
     `tokenCache` if the service hands one out (it is encrypted).
   - Use `fetch` only — this runs on Cloudflare Workers.

2. **Register** it: one line in `PROVIDERS` in `registry.ts`
   (`wise: wiseProvider,`). The Connect button on 設定 › 整合 turns on
   automatically.

3. **Business logic** (web actions or MCP tools):

   ```ts
   const { row, credentials } = await requireEnabledIntegration(orgId, "wise");
   try {
     const data = await callWise(credentials, row.config);
     await recordSyncSuccess(orgId, "wise");
   } catch (e) {
     if (isAuthError(e)) await markNeedsReauth(orgId, "wise", "Wise token 已失效");
     else await recordSyncFailure(orgId, "wise", String(e));
     throw e;
   }
   ```

   For session-token providers (Simpany): try `loadTokenCache`, fall back to logging
   in with `credentials`, then `saveTokenCache`; on a rejected token
   `clearTokenCache` and retry once before `markNeedsReauth`.

4. **MCP tools** — a new `src/lib/mcp/tools-<id>.ts`, spread into `tools` in
   `tools.ts`, and bump `SERVER_VERSION` in `handler.ts`:
   - Tools are always listed; in `execute` call
     `requireIntegrationForTool(orgId, "<id>")` first so a disconnected/disabled
     integration fails with the clear zh-TW message (same as `sync_billing_calendar`).
   - Log each external call with `auditIntegrationCall(ctx, orgId, "<id>", action, detail)`
     (`detail` must not contain credentials or full PII).
   - Anything that reaches the third party must get `openWorldHint: true` in
     `OPENWORLD_OVERRIDES` (handler.ts); add title/destructive overrides as needed.
   - Never put credentials, tokens or ciphertext in a tool result.

5. **Extra settings** — declare `configFields` in the catalog entry (same shape as
   `credentialFields`, stored in plain `config`) and add labels under
   `integrations.fields` in `src/i18n/messages/integrations.ts` (zh-TW + en).

### A brand-new provider (not simpany/wise)

Also: a new migration extending `chk_org_integration_provider` (and the matching
`check(...)` in `schema.ts`), the id in `INTEGRATION_PROVIDER_IDS`, a catalog entry
+ `INTEGRATION_ORDER`, and `integrations.providers.<id>.name/description` in i18n.

## Wise（唯讀交易同步）

Wise 是**唯讀**整合：只把 Wise 對帳單的交易匯入本組織的帳本，讓 Wise 的帳不用再每月手動彙總。

### 唯讀保證

- 所有對 Wise 的請求都走 `src/lib/integrations/wise.ts` 的 `wiseGet()`：method 寫死 GET，
  `assertReadOnly()` 會拒絕任何非 GET，且 path 必須符合唯讀白名單
  （`/v2/profiles`、`/v4/profiles/{id}/balances`、`/v1/profiles/{id}/balance-statements/{balanceId}/statement.json`），
  否則不發請求直接丟錯。**沒有任何建立 quote / transfer / conversion 的程式碼路徑。**
- 同步唯一會寫的是本組織的 `transactions`（內帳），不會寫 Wise。
- Wise 回 401 → `markNeedsReauth`；回 403 且帶 `x-2fa-approval` header → 丟出「需要 SCA」的清楚錯誤
  （本系統不實作 SCA 簽章）；其他錯誤 → `recordSyncFailure`。成功 → `recordSyncSuccess`。

### 連接與帳戶對應

1. 設定 › 整合 › Wise → 連接，貼上 API token。`testConnection` 呼叫 `GET /v2/profiles` 與各 profile 的
   STANDARD 餘額，把 `profiles` / `balances`（含當下餘額與讀取時間）寫進 `config`。
2. 開啟整合後，同頁下方的「Wise 帳戶對應」把每個 Wise 餘額對應到**同幣別**的帳本帳戶，並設定切換日
   （`syncFrom`）。沒對應的餘額不同步。一個帳本帳戶只能對應一個 Wise 餘額；帳戶必須屬於本組織且幣別相同
   （`saveWiseMappings` 會驗）。
3. 「重新整理餘額」再向 Wise 讀一次 profile 與餘額（需整合已開啟）。

`config` 形狀（非機密、成員與 MCP 看得到）：

```jsonc
{
  "profiles": [{ "id": 73990862, "type": "BUSINESS", "name": "Cerana Technology" }],
  "balances": [{ "profileId": 73990862, "balanceId": 129476973, "currency": "USD", "amount": 1234.5, "fetchedAt": "…" }],
  "accountMappings": [{ "profileId": 73990862, "balanceId": 129476973, "currency": "USD", "bankAccountId": 3, "syncFrom": "2026-10-01" }],
  "syncFrom": null // 選填：全域切換日，對應本身沒設時用
}
```

### 切換日（cutover）

過去的 Wise 支出是手動以「月彙總」入帳（對象「Cerana Wise card (彙總)」，book = internal），
所以同步必須從某一天之後才開始，否則會重複記帳：

- **切換日之前的 Wise 交易永遠不同步**（依台北日期判斷）。
- 建議值 = 該帳本帳戶上最後一筆**非 Wise 同步**交易所在月份的下個月 1 號（帳戶沒交易時為本月 1 號）。
  設定頁會顯示建議值；有選帳戶但切換日留空時，儲存會直接套用建議值。
- 每次同步的起點 = max(切換日, 該帳戶最後一筆 Wise 同步交易日 − 3 天)，抓到現在，按台北日曆月切塊
  （Wise 單次上限 469 天）。MCP 的 `startDate` 可以覆寫起點，但不能早於切換日。

### 交易對應規則（`src/lib/wise-sync.ts`）

| Wise | 帳本 |
| --- | --- |
| CREDIT | `income`，入帳到對應帳戶 |
| DEBIT | `expense`，從對應帳戶支出 |
| 金額 | `abs(amount.value)`，餘額幣別；Wise 的金額已含手續費，手續費另記在說明與 `external_meta` |
| 日期 | `date` 換成台北日期 |
| 對象 | `merchant.name` → `senderName` → `recipient.name` → `details.description`（查無就新建 party） |
| 說明 | `details.description`（+ 原幣金額、+ `fee X`） |
| 分類 / 待確認 | 分類留空（未分類）、`needs_review = true` |
| book | `internal`（與過去手動輸入的 Wise 列一致） |
| `external_*` | `external_source = 'wise'`、`external_ref = referenceNumber`、`external_meta` = 商家、原幣金額、匯率、手續費、卡號末四碼、持卡人、Wise 分類 |

**換匯（CONVERSION）**：帳本一列只有一個幣別，不支援跨幣轉帳。所以換匯的兩腳各記一列：

- 另一腳的餘額**也有對應**時，每腳記成「單腳轉帳」（`type = transfer`，只填自己這邊的 from / to 帳戶），
  不進損益、兩邊帳戶餘額都正確，`needs_review = false`。
- 另一腳**沒有對應**時，退回 income / expense（對象「Wise 換匯」）並標 `needs_review`。
- 兩腳共用同一個 referenceNumber，所以 `external_ref` 加幣別後綴（`BALANCE-123:USD`）。
- 單腳轉帳可以照常編輯（web 表單只顯示原本那一腳的帳戶；MCP `update_transaction` 不動帳戶）：
  `src/lib/external-transfer.ts` 的 `externalSingleLegSide()` 只對「有 external_source、type = transfer、
  只有一邊帳戶」的列放寬，一般手動轉帳仍需兩個帳戶。編輯時保留原本的 book（不套「轉帳固定 both」）。
  交易列表的類型標籤依 `external_meta` 顯示成「換匯 USD → THB」。

**去重**：`(organization_id, external_source, external_ref)` 有部分唯一索引（migration 0026），寫入用
`ON CONFLICT DO NOTHING`。已存在的列（包括已軟刪除的）永遠不改、不重寫 —— 刪掉一筆同步進來的交易，
下次同步也不會再長回來。同一次抓回來的資料裡鍵重複時只取第一筆，並列在結果的 `duplicateRefs`。

**待確認**：交易列表上顯示「待確認」chip，列表上方可切到「只看待確認」（`?review=1`）。在 web 編輯並指定
分類、或 MCP `update_transaction` 指定分類 / 傳 `needsReview: false`，就會清掉。

### 入口

- Web：帳戶頁（`/dashboard/bank-accounts`）的「從 Wise 同步」（owner / admin、整合可用且有對應時才出現）：
  先跑 dry run，Sheet 顯示每個帳戶的期間、讀到 / 已存在 / 切換日前 / 將新增筆數與前 50 筆樣本，
  按「寫入 N 筆」才寫。對應到 Wise 的帳戶名稱旁有「Wise」標記。
- MCP：`wise_list_balances`、`wise_get_statement`、`wise_sync_transactions`（`dryRun` 預設 true，
  工具說明要求模型先給使用者看試算、取得同意才以 `dryRun: false` 寫入）。見 [mcp.md](mcp.md)。

## Simpany（電子發票）

Simpany（simpany.co）是公司的電子發票加值中心兼記帳士。**它沒有公開 API**：這裡用的是
它會員網頁背後的私有 REST API（讀前端 bundle、用真實 session 做唯讀呼叫確認過形狀）。
Simpany 改版就可能壞，所以所有回應都防禦式解析，認不得就把 Simpany 的原始錯誤訊息
（截短）丟給使用者，不猜。使用者明確選擇了這條路，並同意把 Simpany 帳密加密存放。

| Where | What |
| --- | --- |
| `src/lib/integrations/simpany.ts` | `simpanyProvider`（連接測試）與 `SimpanyClient` / `getSimpanyClient(orgId)` |
| `src/lib/simpany-sync.ts` | Simpany → `invoices` 同步、自動綁定、作廢清理 |
| `src/lib/simpany-issue.ts` | 預覽（`invoice_drafts`）→ 開立、作廢；MCP 與 web 共用 |
| `src/lib/mcp/tools-simpany.ts` | MCP 工具（見 [mcp.md](mcp.md)） |
| `src/app/dashboard/invoices/simpany-*.ts(x)` | 發票頁「從 Simpany 同步」、看板「在 Simpany 開立」、server actions |
| `migrations/0025_invoice_simpany_sync.sql` | invoices 的課稅別 / 零稅率原因 / 外幣匯率 / B2B-B2C / `external_id` / 作廢欄位，`invoice_drafts` 表 |

**Config**：`companyId` + `companyName`（非機密）。帳號底下只有一家公司時連接時自動選；
多家就要在連接 Sheet 填「公司 ID」（失敗訊息會列出可選的 ID）。

**用到的端點**（其他一概不碰）：

| Host | Endpoint | 用途 |
| --- | --- | --- |
| `api.simpany.co/v1` | `POST login` `{account, password}` → `data.token`（JWT，`exp` ≈ 30 天） | 登入 |
| | `GET me` → `data.companies[]` | 選公司 |
| `member2.simpany.co/api/v1/c/{companyId}/` | `GET receipts?status=ALL\|INVALID&startDate&endDate&page&limit[&query]` | 列表（`status` 必填） |
| | `GET receipts/{R-id}` | 明細（id 是 R…，不是發票號碼） |
| | `POST receipts/b2b` / `receipts/b2c` | **開立**（照會員網頁組的 body） |
| | `DELETE receipts/{R-id}` `{reason, emails: []}` | **作廢** |
| | `GET receipts/zero-tax-rate-reasons` | 零稅率原因清單 |
| | `GET track-numbers?year=<民國年>` | 字軌剩餘（形狀未驗證，只用來提示） |

所有請求帶 `Accept: application/json`、`X-Requested-With: XMLHttpRequest`、
`Authorization: Bearer <JWT>`。

**重新登入**：`getSimpanyClient` 先用 `loadTokenCache` 的 JWT（到期時間取自 JWT 的
`exp`）；沒有就用解密後的帳密登入並 `saveTokenCache`。請求回 401 → `clearTokenCache`、
重新登入、重試一次；重新登入本身被拒（密碼改了）→ `markNeedsReauth`，整合轉成「需要
重新連接」並丟出中文錯誤。網路錯 / 5xx → `recordSyncFailure`（狀態不變）；成功 →
`recordSyncSuccess`。帳密與 JWT 不進 log、錯誤訊息或任何回傳值。

**開立一定兩段式**：preview 把要送出的 body 原樣存成 `invoice_drafts`（2 小時過期）；
開立只收 `draftId`，先以 `pending → issued` 的條件式 update 搶下草稿（按兩次也只會開一張），
再送出。Simpany 明確拒絕（4xx）→ 草稿退回 `pending`；網路中斷 / 5xx（不知道開了沒）→
草稿改 `cancelled`，請使用者先同步確認再重新預覽，避免重複開立。

**稅務規則**（預覽時檢查）：B2B 要 8 碼統編；海外買方沒有台灣統編 → B2C、零稅率、
原因 72 外銷勞務、`NOT_VIA_CUSTOMS`；外幣收款一定要提供取自銀行水單的匯率，
台幣銷售額 = round(外幣 × 匯率)；稅額算法同 Simpany（含稅 round(sum − sum/1.05)、
未稅 round(sum × 0.05)）。外銷勞務**不是**免稅（FW10873800 就是開成 B2C 免稅而作廢）。

**xlsx 對帳**（`src/lib/simpany-export.ts`、發票 › Simpany 對帳）保留，給沒開整合的組織用；
API 同步取代它。

## Security rules

- Credentials are encrypted with `FIELD_ENCRYPTION_KEY` (see
  [deployment.md](deployment.md)). Losing or rotating the key means every
  integration has to be reconnected.
- Nothing that reaches a client — server-action results, page props, MCP results —
  may contain credentials, tokens or ciphertext. `IntegrationSummary` has no such
  fields by construction; don't bypass it with a raw select.
- Credentials are only entered in the web UI by owners/admins, never over MCP.
