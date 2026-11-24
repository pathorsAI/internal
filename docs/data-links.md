# 資料聯動（data links）

> 一筆錢屬於誰，由系統推導，不靠每個入口記得填。

交易表有一組「這筆錢屬於誰」的欄位。過去每個寫入入口（網頁、MCP／站內 AI／REST、Wise 同步、
廠商帳單對帳、GCP 抵用記帳、Simpany、發薪、撥款）各填各的，結果多半沒填。現在所有入口都經過
同一層：`src/lib/linking/`。

## 規則一：只有連結層能寫交易

`src/lib/linking/write.ts` 是**唯一**能 `insert` / `update` `transactions` 的地方：

| 函式 | 用途 |
|---|---|
| `insertTransactions(ctx, rows, { onConflictDoNothing })` / `insertTransaction` | 建立交易。先跑 `resolveLinksMany` 再寫入，回傳每筆的 `{ row, report }` |
| `updateTransactionLinked(ctx, id, patch)` | 改到對象、金額、幣別、日期、類型或任何連結欄位的更新，會重新推導 |
| `updateTransactionsPlain(db, orgId, where, set)` | 只改跟連結無關的欄位（軟刪除、發票、分類、`needsReview`）。型別上拿不到連結欄位 |

`src/lib/linking/guard.test.ts` 靜態掃描整個 `src`：連結層以外出現 `.insert(transactions)`、
`.update(transactions)` 或原生 SQL `INSERT INTO transactions` / `UPDATE transactions` 就失敗。
**新增寫入入口時，測試會擋住沒走連結層的寫法。**

例外：合併交易對象（`src/lib/party-merge-deps.ts`）用通用的 `update(table)` 把 `party_id` 換成目標
對象，只換對象、不動任何連結。

## 規則二：每個關聯怎麼來

| 欄位 | 誰設 | 怎麼推導（只補空的，給了的值優先） | 哪裡讀 |
|---|---|---|---|
| `party_id` 對象 | 入口（名稱 → id） | 名稱、別名完全相同就用既有的；**相似但不同**時：網頁與 MCP 照樣新建，但回傳相似候選；自動同步**不新建**，交易標 `party_similar` 待確認 | 所有報表、看板 |
| `billing_item_id` 請款項 | 人選、MCP、請款看板「登記收款」、自動比對 | 收入比對（見下） | 請款看板已收、合約進度 |
| `subscription_id` + `subscription_period` 訂閱期別 | 人選、MCP、請款看板、自動比對 | 收入比對（見下） | 訂閱各期已收、看板 |
| `contract_id` 合約 | 人選、MCP、自動比對 | 繼承自請款項 → 訂閱 → 原代墊（撥款） | 合約已收／未收、合約收齊提示 |
| `project_id` 專案 | 人選、MCP | 繼承自請款項 → 訂閱 → 原代墊 → 合約 | 專案損益（另見規則四） |
| `vendor_billing_account_id` 廠商計費帳戶 | 廠商帳單對帳、GCP 抵用記帳、自動 | 支出的對象剛好只有一個開著的廠商計費帳戶 → 掛上 | 固定支出「付了沒」、Discord 扣款提醒、月回顧 |
| `review_reason` + `link_candidates` 待連結 | 連結層 | 見下 | 待連結頁、`list_unlinked_transactions` |

### 收入的自動比對

收入有客戶、但沒有請款項／訂閱／合約時，在**這位客戶**開著的項目裡找同幣別的候選：

- 請款項：沒取消、還沒收的金額（以綁定的交易算）超過手續費容許差、應請款日不晚於收款日 60 天。人工標了「已收」但沒綁交易的也算候選
- 訂閱：進行中，取交易日當期（含）之前最早一期還沒收齊的；都收齊了就取下一期（預收，最多 60 天後開始的期別）
- 合約：草稿或進行中、有金額、還沒收齊，**而且底下沒有開著的請款項或訂閱**（不然會跟子項目重複）

每個候選的「應收」= 含稅應收（稅別照請款項／訂閱 → 合約 → 組織）減已收。只差手續費容許差以內的視同收齊，不再當候選。金額相符的定義：交易金額可以比應收少（匯款手續費），
不能多；容許差 = max(應收 × 1.5%, 幣別下限：TWD 100、USD 50…)（`src/lib/linking/match.ts`）。

| 結果 | 處理 |
|---|---|
| 剛好一個相符 | 自動掛上，並繼承合約、專案；請款項的收款日空著就填上 |
| 多個相符 | `link_ambiguous`，候選寫進 `link_candidates` |
| 有候選但都不相符 | `link_amount_mismatch` |
| 沒有候選 | 不動（這位客戶沒有開著的應收） |

同一批（例如一次同步幾十筆）比對到同一個候選時，依日期先後，後面的交易會看到前面已經收的錢。

重新掃描既有交易（`rescan`）時，剛好一個相符也**不自動掛**，標成 `link_suggested` 等人確認：
歷史資料一律給人看過。

### 待連結（`review_reason`）

跟 `needs_review` 分開：`needs_review` 是「分類還沒確認」，指定分類就清掉；`review_reason` 是
「這筆錢屬於誰還沒定」，在待連結頁選候選、選對象或略過才清掉。

| 值 | 意思 |
|---|---|
| `link_suggested` | 重新掃描的舊交易，剛好一個相符，等人確認 |
| `link_ambiguous` | 多個相符 |
| `link_amount_mismatch` | 有候選但金額都不對 |
| `party_similar` | 對象名稱跟既有對象很像，沒自動新建；選既有對象時會把這個名稱加成別名 |
| `link_skipped` | 人看過、決定不連；之後不再自動比對（除非人手動選了連結） |

## 規則三：寫入工具的回傳（AI 的規則）

MCP／站內 AI／REST 的寫入工具（`create_transaction`、`bulk_create_transactions`、
`update_transaction`、`create_reimbursement`）回傳：

- `links`：掛上了什麼，`via` = `given`（呼叫端給的）／`inherited`（繼承）／`matched`（比對到的）
- `unlinked`：沒掛上的原因、說明與候選
- `hints`：合約已收齊但還開著、專案可以結案
- `partySimilar`：用 `partyName` 新建了對象，但有相似的既有對象

工具描述要求 AI：有候選時**只問使用者一次**，不要自己猜；有提示時先告訴使用者、得到同意才改狀態。

## 規則四：專案由合約與訂閱聚合

- **狀態**：`archived` 是人手動封存（override）；其餘由底下推導：有草稿／進行中的合約或進行中／
  暫停的訂閱 → 進行中；底下的都結束了 → 已完成（提示結案）；底下什麼都沒有 → 尚無合約
  （`src/lib/linking/project-status.ts`）。
- **損益**：交易屬於專案 P，若 `project_id = P`，或它的請款項、訂閱、合約屬於 P（`src/db/project-links.ts`）。
  每筆只歸一個專案，優先順序：交易自己的專案 > 請款項 > 訂閱 > 合約，各專案加總不會大於實際收支。
- 建合約時選專案，預設「新專案（同合約名）」。沒有專案的既有合約不自動建專案，在專案頁列出來讓人歸類。

## 規則五：固定支出就是廠商計費帳戶

一個廠商計費帳戶就是一筆固定支出（`vendor_billing_accounts` 的 `schedule`、`anchor_date`、
`interval_months`、`expected_amount`、`currency`、`billing_url`）。沒有 API 整合的廠商是
`provider = other`、`source = manual` 的「手動」帳戶。「付了沒」看交易的 `vendor_billing_account_id`
或該期帳單的對帳結果，不再用字串比對。原本的 `recurring_expenses` 資料在 migration 0041 搬過去，
MCP 的 recurring 工具保留為相容入口，轉呼叫廠商計費帳戶。

## 狀態提示

| 提示 | 條件 | 出現在 |
|---|---|---|
| 合約已收齊 | 已收（同幣別收入，含經由請款項／訂閱繼承合約的交易）≥ 金額，但狀態是草稿或進行中 | 合約頁、MCP 寫入回傳 `hints` |
| 專案可結案 | 底下的合約都已完成或取消，也沒有進行中的訂閱，且沒封存 | 專案頁、MCP 寫入回傳 `hints`、`list_projects` |

只提示，不自動改狀態。
