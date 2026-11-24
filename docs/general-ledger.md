# 總帳與財務報表

> 設計提案：Pensieve `internal/financial-statements-module`（方案 C）。這份是實作規格。

一句話：**交易、發票照舊是輸入；`src/lib/ledger` 照固定規則把它們轉成分錄，四大報表只讀分錄。**
政府帳與管理帳是同一套分錄規則跑兩次，差在「哪些帳戶、哪些認列算政府看得到的」。

## 1. 兩本帳

| 帳 | 收什麼 | 用途 |
| --- | --- | --- |
| **政府帳** `government` | 政府看得到的帳戶（`bank_accounts.ledger_scope = 'government'`）上的錢，加上 `book <> 'internal'` 的收入與費用 | 給會計師、報稅、401 |
| **管理帳** `management` | 全部交易、全部帳戶 | 老闆自己看的真實狀況 |

政府帳**自己一定借貸平衡、銀行科目一定對得上對帳單**。做法：一筆分錄裡不屬於政府帳的那一側，換成
**股東往來（2295）**。

- 隱形帳戶（Wise）付了一筆有發票、要報的費用 → 政府帳：借 費用、貸 股東往來（股東代墊）。
- 永豐戶付了一筆不入政府帳的支出（`book = internal`）→ 政府帳：借 股東往來、貸 銀行存款（股東取用）。
- 隱形帳戶上只在管理帳的收支 → 政府帳完全沒有。
- 隱形帳戶 ↔ 永豐戶互轉 → 政府帳只有永豐那側，對方是股東往來。

所以政府帳上的「股東往來」餘額 = 公司與隱形帳之間的淨流動。待處理清單列出每一筆被這樣沖轉的交易（`shareholder_plug`，資訊等級）。

## 2. 分錄規則（posting engine）

每筆來源產生一張分錄，對每本帳各跑一次（`post(source, ledger)`）。金額用本位幣：
`amount_twd`，沒有就 `amount × 匯率（交易日當天或之前最近一筆 fx_rates）`；都沒有 → 不入帳，待處理 `missing_fx`。
用的是「之前最近」但距離超過 7 天 → 照算，待處理 `fx_estimated`。

### 2.1 科目解析

- 分類 → `categories.gl_account_id`，NULL 用模組 `defaultCategoryCode`（待處理 `unmapped_default`，info）。沒分類 → `uncategorized_income` / `uncategorized_expense`（待處理 `uncategorized`）。
- 銀行帳戶 → `bank_accounts.gl_account_id`，NULL 用模組 `defaultBankAccountCode`。
- 外幣帳戶的那一行帶 `currency` 與 `fxAmount`（原幣，借正貸負）。

### 2.2 交易

一筆交易拆成幾「腳」（leg），每腳有一個角色：

| type | 腳 |
| --- | --- |
| `income` | 借 to 帳戶（沒有 → `unpaid_clearing`）；貸 分類科目。綁了有效的開立發票（`invoice_id`）→ 貸 `ar`，不貸分類 |
| `expense` | 借 分類科目（綁了財產 `fixed_assets.source_transaction_id` → 借財產科目）；貸 from 帳戶（沒有 → `unpaid_clearing`）。綁了有效的收到發票且 `tax > 0`、金額等於發票含稅 → 拆出 借 `input_vat` |
| `advance` | 借 分類科目；貸 `employee_payable`（子帳：settle_employee_id） |
| `reimbursement` | 借 `employee_payable`（子帳：settle_employee_id，沒有就 related 那筆的）；貸 from 帳戶 |
| `transfer` | 借 to 帳戶；貸 from 帳戶。少一邊 → 那邊用 `unpaid_clearing` |

分類 kind 是 `transfer`（換匯）的收支：分類科目預設對到 `fx_gain_loss`，一對換匯（USD 出、TWD 入）在損益上剛好淨成實際的兌換損益。只有一邊時待處理 `fx_transfer_one_sided`（同一天、同組織、另一筆換匯分類交易不存在）。

**角色與政府帳的關係**（只有政府帳要判斷）：

1. **銀行腳**：帳戶是 `management` → 換成 `shareholder`。
2. **認列腳**（分類／財產／進項稅／`ar`／`employee_payable` for advance／`unpaid_clearing`）：
   - `income`、`expense`、`advance`：`book = 'internal'` → 認列腳全部換成 `shareholder`。例外：income 綁了開立發票 → 不看 book（發票政府一定看得到）。
   - `reimbursement`：related 的那筆 advance 不在政府帳（book internal）→ `employee_payable` 腳換成 `shareholder`；沒有 related → 照常。
   - `transfer`：沒有認列腳。
3. 換完之後合併同科目同子帳的行；整張只剩 `shareholder` → 不產生（兩邊都不在政府帳）。
4. 有任何一腳被換成 `shareholder` 且分錄仍存在 → 待處理 `shareholder_plug`（info，ledger = government）。

管理帳不換任何東西。

### 2.3 發票

- 開立、`status = 'valid'`、有 `invoice_date`、**至少一筆 income 交易綁它** → 在發票日：借 `ar`（含稅）、貸 收入（未稅，科目取第一筆綁定交易的分類）、貸 `output_vat`（稅額）。兩本帳都有。
- 開立但沒有交易綁它 → 不入帳（收入改由收款認列會重複），待處理 `invoice_unlinked`（warning）。
- `ar` 沖銷：綁定交易貸 `ar` 的合計 ≠ 發票含稅 → 差額在最後一筆綁定交易日處理：
  發票有 `foreign_currency` → 差額記 `fx_gain_loss`；否則差額絕對值 ≤ max(100, 含稅 1%) → 記 `bank_fee`；
  其他 → 留在 `ar`，待處理 `ar_residual`。
- 收到的發票只在 expense 規則裡拆進項稅，不單獨產生分錄。
- 作廢、折讓不入帳。

### 2.4 期初、折舊、外幣評價

- **期初**：`booksStartDate`（NULL = 最早交易日）。每個帳戶的期初 = `opening_balance` + 起始日前所有交易的淨額（原幣），在起始日前一天記：借 帳戶、貸 期初權益科目（設定，預設 `capital`）。起始日前的交易本身不入帳。外幣用起始日前最近的匯率。隱形帳戶的期初只進管理帳。待處理 `opening_balance`（info）。
- **折舊**：每項財產直線法，`(cost − salvage) / life`，從取得當月起每月月底一筆：借 `depreciation_expense`、貸 `accumulated_depreciation`，到處分月或攤完為止。最後一個月吸收尾差。帳別跟著來源交易（沒有來源 → 兩本帳）。
- **外幣評價**：報表日（`asOf`）時，每個外幣科目×帳戶：原幣餘額 × asOf 匯率 − 本位幣餘額 = 未實現兌換損益，借／貸 帳戶、貸／借 `fx_gain_loss`，日期 = asOf。只在 build 時產生、不存快照。找不到匯率 → 不評價（檢查列出）。

### 2.5 手動分錄與結帳快照

- 手動分錄（`journal_entries.kind` = manual / opening / adjustment）照 `ledger` 欄位進對應的帳（both = 兩本）。
- 月份結帳：把該月兩本帳 engine 算出的分錄（不含外幣評價、不含手動分錄）存成 `kind = 'snapshot'`，之後 build 遇到已結帳月份一律讀快照、不再算。DB trigger 擋住已結帳月份的交易、發票、手動分錄、財產變動（`PERIOD_CLOSED`）。重新開帳 = 刪快照、status 改 open。

## 3. 報表

都是純函式，吃 `BuildResult.postings` 與科目表：

- **試算表**：每科目期初（from 前）、本期借、本期貸、期末。
- **資產負債表**（asOf，可比較另一個 asOf）：依 section 分組；股東往來是借方餘額時列在流動資產（台灣表達，不列成負的負債）；權益區自動加兩列「累積盈虧」（會計年度開始前的損益）與「本期損益」（會計年度開始到 asOf）。資產 = 負債 + 權益必成立。
- **綜合損益表**（期間，可比較）：依 section＋模組的小計。
- **現金流量表**（間接法）：本期淨利 → 加回非現金（折舊）、扣除未實現兌換損益 → 營業類科目變動 → 營業活動；投資類、籌資類科目變動；匯率影響（外幣評價對現金科目的部分）；期初現金 + 淨變動 = 期末現金（檢查）。
- **權益變動表**：股本（capital＋其他 financing 權益）、保留盈餘、合計；列：期初、本期淨利、股本變動、其他、期末。
- **營業稅**：一般營業人雙月、小規模每季。發票端與總帳端並列，差額 > 1 元標出來。
- **檢查**：分錄平衡、資產負債平衡、銀行對帳（`account_reconciliations`）、員工代墊子帳 = 未還代墊、應收未沖。
- **下鑽**：某科目某期間的分錄明細，每行連回來源。

## 4. 操作面

- **設定 → 會計與稅務**：國家、準則、營業稅制、會計年度、帳本起始日、期初餘額沖轉科目；每個帳戶選「政府帳／只在管理帳」與科目；分類對科目；科目表。
- **總帳**（`/dashboard/accounting`）：傳票（手動分錄）、財產目錄、結帳（月結＋結帳前檢查）、匯率（貼上、從 Wise 匯入每日匯率、補齊外幣交易台幣金額）。
- **報表 → 財務報表**：四大表、試算表、營業稅、待處理、附註；政府帳／管理帳切換、比較期、下鑽、Excel（7 張工作表）、列印／PDF。
- **MCP**：`get_financial_statement`、`list_ledger_review_items`、`get_vat_report`（唯讀）。

## 5. 國家模組

`src/lib/ledger/module.ts` 是介面，`jurisdictions/tw.ts` 是台灣。模組提供：科目範本、預設對應、報表區塊與小計、營業稅規則、會計年度與本位幣預設。核心不能出現國家判斷。

## 6. 限制（刻意的）

- 薪資以付款交易認列，薪資單的應付薪資、代扣款還沒有分錄（之後由 payslips 產生）。
- 收入以「綁了發票就發票日，否則收款日」認列；沒綁的發票列在待處理，靠資料聯動（`docs/data-links.md`）補綁。
- 一筆入帳分配多張應收：目前一筆交易只能綁一張發票；之後有分配表時改成一借多貸。
