# 外銷勞務收款：單據上傳與進度管理（輕量版）

> 狀態：**設計提案，尚未實作。** 供 review / 實作依據。
> 一句話：**外銷勞務收款有一條固定的收尾流程（收款 → 水單 → 算台幣銷售額 → 開零稅率發票 → 報單據）。這個模組只做兩件事——讓相應文件有地方上傳、讓每一案的進度看得到、追得動。不把 Simpany 做進流程。**

Simpany（開統一發票、申報檔案上傳）維持在原地由人操作；internal 不驅動它、不深連結、不做 e-invoice API。internal 只負責「該收該開該報」的**記錄、計算、單據存放、進度呈現**。

---

## 1. 決策摘要

| 決策 | 結論 | 理由 |
|---|---|---|
| Simpany 要不要接進流程 | **不接** | 開發票與申報是政府端、瀏覽器沙盒擋死程式上傳（已實測）；接了維運成本高、價值低 |
| 這模組做什麼 | **單據上傳 + 進度管理** | 使用者要的是「文件有地方放、進度看得到」，不是自動化 Simpany |
| 要不要拆新表 | **不拆**，沿用 `invoices` / `documents` / `billing_items` / `transactions` | 這四張表本來就為這件事鋪過路（見 §3），加欄位比開表誠實 |
| 台幣銷售額誰算 | **App 算並存下來** | `round(max(invoice, 匯款)×匯率)`，最容易人為算錯的一步，交給軟體 |
| 發票號碼 / 申報狀態 | **人工回填的狀態欄** | 事實在 Simpany；internal 記「開了沒、報了沒」，差異呈現而非同步 |
| 跨幣別會計 | **不做** | 只在發票層記台幣銷售額，夠報稅與對帳即止，延續 ledger-v2 的克制 |

---

## 2. 一案的生命週期（進度模型）

每一筆外銷勞務收款是一個「案」，狀態沿這條線推進。前四步 internal 能主動幫忙，後兩步是外部動作、internal 只記結果。

| # | 步驟 | 誰做 | internal 記什麼 |
|---|---|---|---|
| 1 | 外幣收款入帳 | 人工登錄 / CSV 匯入 | `transactions`（外幣 + `amount_twd`），綁 `billing_item_id` |
| 2 | 對到請款期別 | App 輔助 | 收款 ↔ `billing_items` 配對 |
| 3 | 上傳匯款水單 | 人上傳 PDF | `documents`（新 doc_type `remittance_cert`），讀出匯率 |
| 4 | 算台幣銷售額 | **App 算** | `invoices.exchange_rate` / `twd_sales_amount` |
| 5 | 在 Simpany 開零稅率發票 | 人（Simpany） | 回填 `external_ref`（發票號碼）+ `external_status=issued` |
| 6 | 申報單據上傳 Simpany | 人（Simpany 網頁） | `filed_to_authority_on`（人工標記） |

「進度管理」就是把這六格的 done / pending / blocked 呈現在一頁看板上，blocked 的直接給下一步提示。

---

## 3. 已經有的（沿用）vs 缺的（補）

實查自 `src/db/schema.ts` 與 `src/lib/mcp/`。schema 早就往這方向鋪過路：

| 能力 | 現況 | 差什麼 |
|---|---|---|
| 發票記錄 | **已有** `invoices`：direction / amount_gross / tax / currency / party_id / contract_id / billing_item_id | 缺跨幣與零稅率欄位 |
| 對 Simpany 的狀態 | **已有** `external_status`(pending/issued/void/n_a) + `external_ref`，註解寫明「Simpany 才是發票真相來源」 | 有工具回填即可（不需接 API） |
| 單據存放 | **已有** `documents`：doc_type / r2_key / invoice_id / transaction_id / `invoice_kind` / `accountant_notified_at` | `doc_type` 檢查約束沒有「水單」這類 |
| 請款板 | **已有** `billing_items`：due/billed/paid/`invoiced_on`/needs_invoice | 沒有「這期要開零稅率」旗標 |
| 台幣值 | **已有** `transactions.amount_twd`；ledger-v2 明白寫「跨幣結算暫不處理」 | 沒有匯率與台幣銷售額欄位 |
| 台幣銷售額換算 | **缺** | `max(invoice,匯款)×匯率` 的算式，全新 |
| 進度看板 | **缺** | 六步狀態頁 |

八個能力五個已在。這不是新蓋一棟，是把既有房間打通——工作量小、風險低。

---

## 4. Schema 增修（最小）

沿用現有表，不開新表。

```sql
-- invoices：補跨幣、零稅率、與申報狀態
ALTER TABLE invoices
  ADD tax_treatment        text DEFAULT 'taxable',  -- taxable | zero_rated | exempt
  ADD zero_rate_reason     text,                     -- '72_export_services' 等；zero_rated 時填
  ADD exchange_rate        numeric(18,6),            -- 水單即期匯率，如 32.208000
  ADD twd_sales_amount     numeric(18,2),            -- round(max(gross,匯款)×rate)，報稅銷售額
  ADD filed_to_authority_on date;                    -- 申報單據上傳 Simpany 的日期（人工標記）
  -- 發票號碼與已開狀態沿用既有 external_ref / external_status，不新增

-- documents：doc_type 增加「水單」一類
-- 現有：receipt|invoice|vat_return_401|withholding|payroll|contract|other
ALTER TABLE documents DROP CONSTRAINT chk_doc_type;
ALTER TABLE documents ADD CONSTRAINT chk_doc_type
  CHECK (doc_type IN ('receipt','invoice','vat_return_401',
    'withholding','payroll','contract','remittance_cert','other'));
    -- remittance_cert = 匯入匯款交易單證（水單）

-- billing_items：標記這期要開零稅率（給看板篩選）
ALTER TABLE billing_items ADD zero_rated boolean DEFAULT false NOT NULL;
```

一列外銷、美金入帳、零稅率的發票長這樣：
`currency=USD, amount_gross=13001.04, tax=0, tax_treatment=zero_rated,
zero_rate_reason='72_export_services', exchange_rate=32.208, twd_sales_amount=418737,
external_ref=(Simpany 發票號碼), filed_to_authority_on=(申報日)`。

**刻意不做**：完整多幣別帳（會計科目、期末評價）。只在發票層記「這筆外幣收款換算成多少台幣銷售額」，剛好夠報稅與對帳。與 ledger-v2 的克制一致。

---

## 5. MCP 工具（沿用現有 `ToolDef` 註冊法，掛進 `tools.ts`）

只補「上傳 + 計算 + 狀態」，不含任何 Simpany 驅動。

| 工具 | 做什麼 | 對應步驟 |
|---|---|---|
| `attach_remittance_cert` | 把水單 PDF 存成 `documents`(doc_type=remittance_cert)，關聯收款交易與發票，讀出匯率 | 3 |
| `compute_zero_rated_invoice` | 由收款 + 水單算 `twd_sales_amount = round(max(gross,匯款)×rate)`，建 zero_rated 的 invoices 列 | 4 |
| `mark_einvoice_issued` | 人在 Simpany 開立後，回填 `external_ref`(發票號碼) + `external_status=issued` + `billing_items.invoiced_on` | 5 |
| `mark_filed_to_authority` | 標記該案的申報單據已上傳 Simpany（`filed_to_authority_on`） | 6 |

直接沿用：`list_billing_status` · `create_invoice`/`get_invoice` · `create_transaction`(綁 billing_item_id) · 既有 `documents` 上傳路徑（`/api/documents`）。

---

## 6. UI：一頁「外銷勞務進度」

掛在 `/(dashboard)/invoices` 下，每一案一列，展開為六步狀態。

- **頂部一行結論**：收了沒 / 水單有沒有 / 台幣銷售額 / 發票開了沒 / 報了沒——一眼掃完。
- **上傳區**：水單、invoice、合約直接拖上傳，存進 `documents` 綁到本案。這就是使用者要的「有地方放文件」。
- **六步狀態條**：done / pending / blocked；blocked 給下一步提示（「跟永豐要水單」「發票號碼填了沒」）。
- **差異提示**：invoice 金額與水單匯款金額不一致時標出差額與原因欄（本次 Zonic 案的 USD 53.00 就是這種）。
- **手動狀態**：發票號碼、申報日兩欄人工填——事實在 Simpany，這裡只記結果。

**為什麼值得**：報稅雙月一次、容易漏、錯了一路髒到 401。把「該收該開該報」變成看板上不會消失的一列，比靠記憶或翻信箱可靠。這正是 internal 對 `billing_items` 已在做的事，延伸到外銷這條線。

---

## 7. 明確不做（Non-goals）

- **不接 Simpany。** 不驅動、不深連結、不做 e-invoice / 申報上傳 API。Simpany 上開發票、傳單據仍由人手動；internal 只記結果。
- **不自動抓水單 / 收款。** email（contact@ 的永豐 e-bill）與銀行匯入留待未來獨立提案，先靠人工上傳 / 登錄。
- **不做完整複式會計 / 多幣別評價。** 只在發票層記台幣銷售額。
- **不把 Simpany 當可寫同步對象。** external_ref 記發票號碼，差異呈現在看板，不硬雙向同步。

---

## 8. 落地順序

| 階段 | 內容 |
|---|---|
| A | Migration + drizzle schema（§4 三處 ALTER）；照 `/prod-migrate` 走 SSH tunnel |
| B | 計算核心 + 工具：`compute_zero_rated_invoice` 算式與測試（取高、四捨五入、不扣費）+ §5 其餘工具 |
| C | 進度看板頁（§6），含水單/合約上傳區 |
| D | 拿本次 Zonic 七月期當第一筆真實資料驗收：twd_sales_amount 418,737、水單、發票號碼、申報日一路填到綠 |

---

## 附註：本設計的緣起

2026-08 Zonic（HNT Marketing LLC）七月期收款，全程手動走過一次：永豐美金戶 2026-08-10 入帳 USD 12,935.62、水單匯率 32.208、台幣銷售額 `round(13001.04 × 32.208) = 418,737`。過程中的痛點——收款要翻銀行明細、水單要翻 contact@ 信箱、台幣銷售額要手算、進度靠記憶——正是這個模組要消掉的。
