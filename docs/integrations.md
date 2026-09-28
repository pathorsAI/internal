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
| `src/lib/mcp/tools-integrations.ts` | `list_integrations` (incl. `autoSync` / `lastAutoSync`), `run_integration_sync`, plus `requireIntegrationForTool` and `auditIntegrationCall` for provider tools. |
| `src/lib/integrations/autosync.ts` | Daily auto-sync (see [每日自動同步](#每日自動同步)). |

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
| `src/lib/simpany-salary.ts` | 薪資申報唯讀同步與欠薪對帳（見下方「薪資申報」） |
| `src/lib/simpany-payroll.ts` | 薪資申報寫入：準備（試算 + 草稿）→ 寫入 → 結算 → 寄薪資單（見下方「薪資申報寫入」） |
| `src/lib/mcp/tools-simpany.ts` | MCP 工具（見 [mcp.md](mcp.md)） |
| `src/app/dashboard/invoices/simpany-*.ts(x)` | 發票頁「從 Simpany 同步」、看板「在 Simpany 開立」、server actions |
| `migrations/0025_invoice_simpany_sync.sql` | invoices 的課稅別 / 零稅率原因 / 外幣匯率 / B2B-B2C / `external_id` / 作廢欄位，`invoice_drafts` 表 |

**Config**：`companyId` + `companyName`（非機密）。帳號底下只有一家公司時連接時自動選；
多家就要在連接 Sheet 填「公司 ID」（失敗訊息會列出可選的 ID）。

**用到的端點**（其他一概不碰；薪資申報的端點另見下方「薪資申報」與「薪資申報寫入」）：

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

### 薪資申報（唯讀）+ 欠薪對帳

Simpany 也是公司申報薪資（扣繳、勞健保）的地方。這裡**只讀**它的薪資申報，存到本地，再跟
本系統實際記錄的發薪對帳，算出每位員工每月的欠薪。

| Where | What |
| --- | --- |
| `src/lib/integrations/simpany.ts` | `SimpanyClient.listSalaryMonthlyForms(year)`、`getSalaryForm(year, month)`、`assertSalaryReadOnly()` |
| `src/lib/simpany-salary.ts` | `syncSalaryDeclarations(orgId, year)`、`salaryReconciliation(orgId, opts)`、`listSalaryDeclarationsLive()`、`allocatePayments()` |
| `migrations/0027_simpany_salary_declarations.sql` | `simpany_salary_forms`（一個月一列）、`simpany_salary_declarations`（員工 × 月一列） |
| `src/app/dashboard/payroll/simpany-salary-*.ts(x)` | 薪資頁「Simpany 薪資申報」區塊、同步 server action |

**端點**（不同 host / path：沒有 `c/`，在 `api.simpany.co`；header 與 JWT 同上；回應 `{status, code, data, meta}`）：

| Endpoint | 用途 |
| --- | --- |
| `GET api.simpany.co/v1/{companyId}/salary-declaration/form/monthly-forms/{year}` | 一年 12 格 `{id\|null, year, rocYear, month, employees[{id, name}]}`；`id` null = 那個月沒建表單 |
| `GET api.simpany.co/v1/{companyId}/salary-declaration/form?year=YYYY&month=M` | 那個月的表單：`payday`、`isSettled`、每位員工的 `salaryDeclaration.salaryDeclarationItems[{name, type, amount}]` |

`month` 是**薪資所屬月份**（`yearMonth`），發薪日通常是次月 5 日（`payday`）。

**唯讀護欄**：同步與對帳用的薪資請求一律走 `SimpanyClient` 的私有 `salaryGet()` → `assertSalaryReadOnly()`：
method 必須是 GET、路徑必須符合白名單（`form/monthly-forms/{yyyy}`、`form`）、query key 只能是
`year` / `month`，否則**不發請求**直接丟錯。寫入端點另有一條獨立的白名單（`assertSalaryWrite`，見下方
「薪資申報寫入」），只有 `src/lib/simpany-payroll.ts` 會用；同步、對帳、每日自動同步都不會碰到。

**個資**：Simpany 的回應含身分證字號（`personalId`）、戶籍地址（`address`）、國籍（`nationality`）。
`parseSalaryForm` 只挑白名單欄位組新物件，這三個欄位**從來不會被讀進記憶體裡的結構**，所以不會進
DB、log、錯誤訊息、server action 或 MCP 結果。薪資請求的錯誤訊息也不附 body 片段（`salaryErrorMessage`）。
本地只存姓名、Simpany 員工 id、金額、日期、旗標；`items` 只有 `{name, type, amount}`（不存 Simpany 的 `note`）。

**資料表**（兩張而不是一張加哨兵列：「沒建表單 / 表單空白 / 已申報」是月份層級的事實，跟員工無關）：

- `simpany_salary_forms`：`(org, year, month)` 唯一。`simpany_form_id` NULL = 未建立；
  `filed_count = 0` = 表單空白；`is_settled` = 已申報。沒有列 = 沒同步過。
- `simpany_salary_declarations`：`(org, year, month, simpany_employee_id)` 唯一。從明細抽出
  本薪、非經常性獎金、實際申報薪資（`gross_declared`）、實際發薪（`net_pay`）、勞健保個人 / 公司負擔、
  就業保險；`filed` = 有申報明細。`employee_id` = 同組織姓名完全相同的員工（重名不綁），否則 NULL。

月份狀態：`missing`（未建立）、`empty`（表單空白）、`draft`（有明細但沒結算）、`settled`（已申報）、
`not_synced`。

**同步**（`syncSalaryDeclarations`，owner / admin）：1 + (有表單的月數) 個 GET。以唯一鍵 upsert；
Simpany 上已不存在的表單 / 員工會從本地刪掉，所以重跑是冪等的。只寫本組織的這兩張表。

**對帳**（`salaryReconciliation`，只讀本地表）：

- 應發 = 已申報月份的 `net_pay`。未申報的月份（沒表單、表單空白、表單上沒有這個人）在任職期間內
  （`employees.start_date`，沒有就從第一個有申報的月份起；到 `end_date`）且發薪日已過時，用
  `expectedMonthlyNet` 估：預設 = 最近一次申報的實發 − 非經常性獎金，可用姓名覆寫；這些月份標
  `estimated: true`，另計在 `estimatedArrears`，不混進 `arrears`。
- 已發 = (1) `payslips`（有 `paid_transaction_id` 的以那筆交易為準；沒有交易但批次 `status = paid` 的以
  `net_pay` 計）+ (2) `type = expense`、分類「薪資費用」、`txn_date` 在 `paidFrom ~ paidTo` 的交易，
  對象是員工（`settle_employee_id`，或對象 party 名稱 = 員工姓名）。屬於別年 payslip 的交易不算。
- 分配（`allocatePayments`）：payslip 有期別的先補那個月；其餘（含超付部分）依付款日期先進先出，
  從最舊的欠款月份補起；再有剩 = `credit`。
- 發薪日（表單 `payday`，沒有就假設次月 5 日）還沒到的月份，未付金額算 `notYetDue`，不算欠薪。
- 分類是「薪資費用」卻對不到任何員工的交易 → `unallocatedPayments`，讓 owner 去交易頁指派。
- 預設 `throughMonth` = 今年的本月 / 過去年份 12；`paidFrom` = 1/1；`paidTo` = 今天 / 過去年份為隔年 1/31。

入口：薪資頁（`/dashboard/payroll?year=YYYY`）的「Simpany 薪資申報」區塊（月份狀態格、欠薪表、明細 Sheet、
未指定員工的薪資支出）；MCP `simpany_list_salary_declarations`、`simpany_sync_salary_declarations`、
`salary_arrears`（見 [mcp.md](mcp.md)）。

### 薪資申報寫入（準備 → 寫入 → 結算 → 寄薪資單）

讓 owner / admin 從本系統（薪資頁、MCP）直接在 Simpany 填每月薪資申報，不用再到 Simpany 介面一格一格點。
流程跟電子發票開立一樣是「預覽成草稿 → 使用者確認 → 只收 draft id 寫入」，結算與寄薪資單各自再要明確確認。

| Where | What |
| --- | --- |
| `src/lib/integrations/simpany.ts` | `assertSalaryWrite()`（寫入白名單）、`getSalaryDeclaration` / `getSalarySetting` / `calculateSalaryDeclaration` / `updateSalaryDeclaration` / `copySalaryForm` / `setSalaryPayday` / `setSalaryCompanyOwner` / `settleSalaryForm` / `sendSalaryPayslips` |
| `src/lib/simpany-payroll.ts` | `prepareSalaryFiling`、`applySalaryFiling`、`settleSalaryFiling`、`sendPayslips`、`buildDeclarationPayload`（純函式）、`salaryFilingDefaults`（web 預設值，只讀本地表） |
| `migrations/0029_simpany_salary_drafts.sql` | `simpany_salary_drafts`（pending → applied → settled；cancelled / expired） |
| `src/app/dashboard/payroll/simpany-salary-filing.tsx` | 月份格上的「準備申報 / 薪資單」Sheet |

**寫入白名單**（`assertSalaryWrite`，相對於 `api.simpany.co/v1/{companyId}/salary-declaration/`；method + 路徑逐條比對，不接受任何 query）：

| Method | Path | 用途 |
| --- | --- | --- |
| GET | `form/{formId}/salary-declaration/{declId}` | 單一申報明細（模板） |
| GET | `form/{formId}/setting` | 加項 / 減項選項、基本工資、投保級距表 |
| POST | `form/{formId}/salary-declaration/{declId}/calculate` | Simpany 的即時試算（不存檔）；只在「準備」時呼叫 |
| PUT | `form/{formId}/salary-declaration/{declId}` | 存檔申報明細（整份覆寫）；422 → `{errors:{field:[msg]}}` |
| POST | `form/{formId}/copy` `{sourceFormId, employeeIds}` | 從別的月份複製員工與申報明細 |
| PATCH | `form/{formId}/payday` `{payday}` | 發薪日；可能回 `healthInsuranceRangeByPayDateAdjustments` |
| PUT | `form/{formId}/salary-declaration/{declId}/company-owner` `{isCompanyOwner}` | 負責人旗標 |
| POST | `form/{formId}/settle` `{resignedEmployeeIds: []}` | **結算，送給記帳士** |
| POST | `form/{formId}/payslip/send` `{mode, mailContent[, salaryDeclarationIds]}` | 寄薪資單；404 = 薪資單還在產生 |

員工的建立 / 修改 / 刪除 / pre-check（都需要身分證字號）**刻意不在白名單**：表單上找不到的人一律回報
`notInSimpany`，請使用者到 Simpany 的介面新增。

> ⚠️ 這些端點是從 Simpany 前端 bundle 讀出來的，payload 形狀以真實 GET 的回應比對過，但**寫入端點從未實際呼叫驗證**
> （開發時嚴禁打寫入端點）。第一次上線使用時要人工在 Simpany 介面對一次結果。

**1. 準備（`prepareSalaryFiling`）**——對 Simpany 只發 GET 與 POST calculate（allowCopy 時另有 POST copy）：

- `GET form?year&month`（Simpany 對還沒建立的月份會自動建空白表單，它的介面也是這樣）。已結算 → 拒絕。
  `monthSequenceRestriction`（例如 `EXISTING_OUT_OF_SEQUENCE_RECORDS` + `missingMonths`）→ 警示：月份必須依序結算，不繞過。
- 對象：有給 `employees` 就用（`employeeId` 或與 Simpany 完全相同的姓名）；沒給 = 這個月表單上的人 + 最近一個已結算月份的人，
  排除本系統記錄在這個月之前就離職的。
- 表單上缺人 → 找最近一個有這些人的已結算表單（或 `sourceFormId`），規劃 `POST copy`。**複製是寫入**，只有
  `allowCopy: true` 才做；否則回傳計畫、不產生草稿。
- 每位員工：`GET` 申報明細當模板 → `buildDeclarationPayload`：
  - 只改日期與金額：薪資期間 = 整個月；勞保 / 勞退期間模板有值才改成整個月（沒有就維持 null）。
  - 本薪 = 輸入 → 員工資料的本薪 → 上次申報的本薪。
  - 沿用模板的：投保級距（INSURANCE_RANGE 原樣）、投保旗標、扶養人數、勞退自提 / 提繳率、每月固定的加項（1 免稅伙食津貼、36 經常性獎金）。
  - 一次性的**不沿用**並列在 `droppedItems`：非經常性獎金（11）、員工代墊款（49）、年終、加班費、減項（44 / 50）等；這個月有才用
    `bonus` / `reimbursement` / `otherAllowances` / `otherDeductions` 帶。
  - `salaryDeclarationItems` = 可編輯項目（ALLOWANCE、INSURANCE_RANGE、選項清單內的 DEDUCTION）；其餘放
    `calculatedSalaryDeclarationItems`。INSURANCE_FEE（員工補助金額）目前歸在「算出來的」那一邊 —— 未經驗證。
- `POST calculate` → 用回傳的 `calculatedSalaryDeclarationItems` 組成要 PUT 的 body，抽出應發、個人負擔、公司負擔、扣繳、
  實發（`實際發薪`）、實際申報薪資、投保級距。本薪高於級距、Simpany 建議級距不同、低於基本工資、月中到離職都只警示，**不自動改級距**。
- 負責人：`companyOwner` 輸入 → 最近一個已結算月份標記的人 → 這個月表單上標記的人。旗標不符時在寫入時修正（派斯是鄭宇傑：
  負責人健保全額自付、沒有就業保險）。
- 發薪日預設次月 5 日；不是的話警示（Simpany 介面也會警告）。
- 全部都算得出來、也沒有待複製的人，才寫一筆 `simpany_salary_drafts`（每份 PUT body 原樣 + 預覽，2 小時過期）。

**2. 寫入（`applySalaryFiling(draftId)`）**：條件式搶草稿（`pending → applied`，過期搶不到）→ 再讀一次表單（已結算 / 換了表單 /
申報明細不見 → 取消草稿）→ **負責人旗標 → 發薪日 → 逐一 PUT 申報明細**（旗標與發薪日是 Simpany 試算的輸入，所以先設）→
讀回來比對每人實發（`verification`、`verified`）→ `syncSalaryDeclarations(org, year)`。任何一步失敗：草稿退回 `pending`，
`apply_result` 與錯誤訊息列出已修正的旗標、是否已改發薪日、已寫入 / 尚未寫入的人。每一步都是覆寫式，可以用同一份草稿重試。

**3. 結算（`settleSalaryFiling`）**：`confirmPayday`、`confirmOwner`、`confirmSalary` 三個確認**都必須為 true**（同 Simpany 的三個勾選）；
表單未建立 / 已結算 / 沒有任何申報 / Simpany 標記資料不完整（`hasMissing*Data`）/ `canSettle = false`（回傳順序限制與缺的月份）
一律拒絕。`POST settle {resignedEmployeeIds: []}`；網路中斷或 5xx → 回報「結果不明，先同步確認，不要重送」。
成功後讀回來確認 `isSettled`、把該月 applied 草稿標 `settled`、重新同步。**送出後無法從這裡撤回。**

**4. 寄薪資單（`sendPayslips`）**：只限已結算的月份；沒指定人 = `COMPANY_SALARY_DECLARATION_FORM`（整張表單），
指定姓名 = `SALARY_DECLARATIONS` + 申報明細 id。信件內容用 Simpany 的預設文字（發薪日取表單的 `payday`）。
404 = 薪資單 PDF 還在產生，稍後再寄。

**個資**：申報明細只以白名單欄位解析（`parseSalaryDeclarationDetail`），身分證字號 / 地址 / 國籍不進記憶體結構、草稿、log、
回傳值；Simpany 回的調整建議先經 `stripSalaryPii`。請求 / 回應 body 都不寫 log，錯誤訊息只取結構化的 message。

**股東往來還款不是薪資**，永遠不填進 Simpany 的薪資申報（工具描述與 Sheet 都有提醒）。

入口：薪資頁月份格的「準備申報」（已結算的月份是「薪資單」）Sheet —— 可編輯每人本薪 / 非經常性獎金 / 員工代墊款、
發薪日（預設次月 5 日）、是否允許複製 →「計算」顯示 Simpany 試算結果與順序限制警示 →「寫入 Simpany」→ 三個勾選
→「送出給記帳士」→「寄送薪資單」。只對 owner / admin、整合可用、且月份不晚於本月時顯示。
MCP：`simpany_prepare_salary_filing`、`simpany_apply_salary_filing`、`simpany_settle_salary_filing`、`simpany_send_payslips`。

## 每日自動同步

已連接、已開啟、狀態正常的整合每天自動同步一次，不用再有人去按「同步」。

**排程**：Cloudflare Cron Trigger `0 22 * * *`（UTC）= 每天**台北 06:00**。接線方式
（`worker.ts` 的 `scheduled()` → 內部 route `/api/cron/integrations-autosync`）見
[deployment.md](deployment.md#custom-worker-entry--cron-trigger-daily-integration-auto-sync)。

**範圍**：`org_integrations` 裡 `enabled = true AND status = 'connected'`、且
`config.autoSync !== false` 的每一列（每個組織、每個整合）。

| 整合 | 跑什麼 | 等同於 |
| --- | --- | --- |
| Simpany | `syncSimpanyInvoices(org, 最近 90 天～今天)`（台北日期）→ `syncSalaryDeclarations(org, 今年)`；一月時另外跑去年 | 發票頁「從 Simpany 同步」+ 薪資頁「Simpany 薪資申報」同步 |
| Wise | `syncWiseTransactions(org, { dryRun: false })`；還沒設帳戶對應就略過（不算失敗、不打 Wise） | 帳戶頁「從 Wise 同步」按「寫入」 |

**安全**：

- **只同步，不開立**：Simpany 只走列表 / 明細 / 薪資申報的 GET；自動同步沒有任何開立、
  作廢發票、薪資申報寫入 / 結算或其他 Simpany 寫入端點的程式碼路徑。Wise 本來就只有 GET（見上方唯讀保證）。
- Wise 寫入是安全的：以 referenceNumber 去重（`ON CONFLICT DO NOTHING`，刪掉的也不會長回來）、
  永遠不早於切換日、新列一律「待確認」。Simpany 發票與薪資申報同步都是冪等 upsert。
- **依序、不平行**：一個組織一個整合接著跑，對 Simpany 的非官方 API 溫和一點。
- **互相隔離**：每個 組織 × 整合（以及 Simpany 的發票 / 薪資各步驟）各自 try/catch，
  一個失敗不影響其他。401 / 5xx 照舊由 provider 程式碼 `markNeedsReauth` /
  `recordSyncFailure`；本地錯誤（寫 DB…）由自動同步補記 `recordSyncFailure`。
  整合在跑的途中被關掉或轉成需要重新連接時不覆寫 `last_error`。
- 發票同步一次最多抓 80 張明細（`MAX_DETAIL_FETCHES`，Workers subrequest 上限）；
  沒抓完會在摘要註明，隔天接著做。

**結果**：

- `config.lastAutoSync = { at, ok, summary, error, trigger }`（`updateConfig` 淺層合併；非機密，
  成員與 MCP 看得到）。`summary` 是 zh-TW 的一行摘要，例如
  「發票 2026-07-01～2026-09-29：讀到 12 張、新增 1、更新 0、作廢 0、自動綁定 1、待確認 0；薪資申報 2026：寫入 36 筆」。
- 操作紀錄每個 組織 × 整合 一筆，entity = `integration`。排程觸發的來源是 **system**（`channel = 'system'`，
  操作人欄位全 NULL —— 不冒充任何成員；需要 `migrations/0028`）；手動觸發記成按下的那位成員（web / mcp）。

**開關**（owner / admin）：設定 › 整合 每個已連接的 Simpany / Wise 列上有「自動同步」開關，
存成 `config.autoSync`（沒有這個欄位 = 開，預設開）；下面一行顯示
「上次自動同步：YYYY-MM-DD HH:mm · 成功 / 失敗：…」（台北時間）。
關掉自動同步不影響手動同步與 MCP 工具。

**手動觸發**（測試用，只跑目前組織、同一條程式碼路徑 `runScheduledSync(now, { orgId, trigger: "manual" })`）：

- Web：設定 › 整合 上方的「立即執行自動同步」（owner / admin）。
- MCP：`run_integration_sync`（owner / admin，write，openWorldHint）。

| Where | What |
| --- | --- |
| `src/lib/integrations/autosync.ts` | `runScheduledSync(now, { orgId?, trigger?, audit? })`、`autoSyncWindow(now)` |
| `src/lib/integrations/autosync-config.ts` | client-safe：`isAutoSyncOn(config)`、`parseLastAutoSync(config)`、`AUTO_SYNC_PROVIDERS` |
| `src/app/api/cron/integrations-autosync/route.ts` | cron 的內部進入點（一次性 token，外部一律 404） |
| `src/lib/cron-token.ts` | 一次性 token（`worker.ts` 與 route 共用 `globalThis` 上的 Set） |
| `src/i18n/server-t.ts` | `runAsSystem()` / `getServerT(namespace)`：沒有 request 語系時用 zh-TW 字典 |
| `worker.ts`、`wrangler.jsonc` `triggers` | Cron Trigger 與自訂 worker 進入點 |

**i18n**：同步路徑上唯一用到翻譯的是 `store.ts`（`requireEnabledIntegration` 的錯誤訊息、
`integrationDisplayName`）。它們改用 `getServerT()`：在 `runAsSystem()` 裡（自動同步一律如此）
回傳 zh-TW 的 `createTranslator`，不碰 `cookies()` / `headers()`；其他情況就是原本的
`getTranslations`，web 與 MCP 行為不變。新增會在自動同步路徑上用到翻譯的程式碼時，
用 `getServerT` 而不是 `getTranslations`。

## Security rules

- Credentials are encrypted with `FIELD_ENCRYPTION_KEY` (see
  [deployment.md](deployment.md)). Losing or rotating the key means every
  integration has to be reconnected.
- Nothing that reaches a client — server-action results, page props, MCP results —
  may contain credentials, tokens or ciphertext. `IntegrationSummary` has no such
  fields by construction; don't bypass it with a raw select.
- Credentials are only entered in the web UI by owners/admins, never over MCP.
