# 帳務設計（輕量版）：type 情境 + 內外帳 + 代墊追溯

> 狀態：**設計定案，尚未實作。** 只動 `transactions`，不拆表。供 review / 實作依據。
> 一句話：**用一個 `type` 標明這是哪種交易、用 `book` 標報稅與否、用 `related_to_id` 把多步驟的事串起來** —— 剛好滿足「分清內外帳 + 代墊可追溯」，不做完整複式會計。

---

## 1. 決策摘要

| 決策 | 結論 | 理由 |
|---|---|---|
| 要不要拆 entries / payments / allocations | **不拆**，沿用單一 `transactions` | 核心只要「內外帳 + 代墊追溯」，完整 AP/AR 太大、用不到分期/一付多 |
| `book`（內外帳）要不要收斂成布林 | **保留三分法** both/internal/external | 不確定內外帳會不會「同筆差金額」；三分法是金額差異的逃生門，代價為零 |
| 怎麼分辨交易種類 | **新增 `type` 欄位** | 不要靠「有沒有帳戶+有沒有 settle+有沒有 related」硬猜，脆弱又難查 |
| 進不進損益 由誰決定 | **`type`**（income/expense/advance 算；transfer/reimbursement 不算） | 跟 `book` 無關，兩條獨立的線 |
| `pnl_section` | **已移除**（2026-05-30） | 是先前主觀塞的、且沒被任何 query 用到；之後做正式損益表再跟會計師重建 |
| 跨幣結算 | **暫不處理** | 代墊都是台幣；Wise 美金是單筆事件、不走 link |

---

## 2. 兩個正交的軸（最重要的觀念）

| 軸 | 欄位 | 管什麼 |
|---|---|---|
| **這是哪種交易** | `type` | 情境：一般支出 / 收入 / 代墊 / 撥款 / 轉帳。驅動行為與顯示 |
| **報稅與否** | `book` | 內帳 / 外帳 / 兩者。純粹是「給哪本帳看」 |

且 **進不進損益** 是第三件獨立的事，由 `type` 決定（不是 book、不是 pnl_section）：
- `income / expense / advance` → 進損益（income 為 +，expense/advance 為 −）
- `transfer / reimbursement` → **不進損益**（只是搬錢 / 結算負債）

> 例：一筆「沒報稅、但從公司帳戶付的支出」= `type=expense` + `book=internal`。兩欄各自獨立、不互相牽動。

---

## 3. Schema 改動（只動 `transactions`）

```sql
-- (1) type：情境鑑別子（=使用者選的情境）
ALTER TABLE transactions ADD COLUMN type TEXT NOT NULL DEFAULT 'expense';
ALTER TABLE transactions ADD CONSTRAINT chk_txn_type
  CHECK (type IN ('expense','income','advance','reimbursement','transfer'));

-- (2) 結算 / 還款對象（代墊人）；NULL 視為 = party_id
ALTER TABLE transactions ADD COLUMN settle_party_id BIGINT REFERENCES parties(id);

-- (3) 關聯：撥款 → 原費用（可追溯）。也可給分期、退款等串接用
ALTER TABLE transactions ADD COLUMN related_to_id BIGINT REFERENCES transactions(id);
CREATE INDEX idx_txn_settle  ON transactions(settle_party_id);
CREATE INDEX idx_txn_related ON transactions(related_to_id);

-- (4) 放寬「一定要有帳戶」→ 允許「認列但未付現」（代墊費用沒綁公司帳戶）
ALTER TABLE transactions DROP CONSTRAINT chk_txn_accounts;
```

**保留不動**：`book`（三分法）、`billed_to_company_tax_id`（=有統編）、`party_id`、`category_id`、`from/to_account_id`、多幣別欄位等。

`type` 值清單（之後可加 `capital` 股東往來 / `refund` 退款）：

| type | 情境 | 進損益 | 綁帳戶 |
|---|---|---|---|
| `expense` | 一般支出 | 是（−） | from |
| `income` | 收入 | 是（+） | to |
| `advance` | 員工代墊 | 是（−） | **不綁** |
| `reimbursement` | 撥款 / 還代墊 | 否 | from |
| `transfer` | 帳戶互轉 | 否 | from + to |

---

## 4. UX：情境優先流程（避免欄位 morph）

**原則**：分岔只發生在「選情境」這一步；選完之後，該情境的表單是**固定欄位、不再變化**。情境同時把使用者看不到的欄位（type / book 預設 / 綁不綁帳戶 / settle_party / related_to）自動填好。

```
 ┌─ 新增交易 ──────────────┐        選了「員工代墊」後 ↓
 │  這是哪一種?            │      ┌─ 員工代墊 ──────────────┐
 │  ┌──────┐ ┌──────┐     │      │ 日期    [____]          │
 │  │💸一般 │ │💰收入 │     │  →   │ 廠商    [____]          │
 │  │  支出 │ │      │     │      │ 代墊人  [王小明 ▾]       │
 │  └──────┘ └──────┘     │      │ 分類    [設備費用 ▾]     │
 │  ┌──────┐ ┌──────┐     │      │ 金額    [10000]         │
 │  │🧑代墊 │ │🔄帳戶 │     │      │ ☐ 上外帳（要報稅）       │
 │  │      │ │  互轉 │     │      │           [儲存]        │
 │  └──────┘ └──────┘     │      └─────────────────────────┘
 └────────────────────────┘         (沒有帳戶欄 — 系統知道)
```

**各情境的固定欄位：**
- **一般支出**：日期、對象、分類、金額、付款帳戶、☑上外帳、☐有統編
- **收入**：日期、客戶、分類、金額、收款帳戶、☑上外帳
- **員工代墊**：日期、廠商、**代墊人**、分類、金額、☑上外帳、☐有統編 ←（無帳戶欄）
- **帳戶互轉**：日期、轉出帳戶、轉入帳戶、金額 ←（無對象 / 分類）

**「上外帳（要報稅）」勾選** = 這筆要不要算進報給國稅局的外帳：勾→`book=both`、不勾→`book=internal`。多數支出預設勾。

**情境自動帶入（使用者看不到）：**

| 情境 | type | book | 其他自動 |
|---|---|---|---|
| 一般支出 | expense | 勾選決定（預設 both） | from=付款帳戶 |
| 收入 | income | 勾選決定（預設 both） | to=收款帳戶 |
| 員工代墊 | advance | 勾選決定（預設 both） | 不綁帳戶、settle_party=代墊人、未還 |
| 撥款 | reimbursement | internal | from=永豐、related_to=那筆代墊 |
| 帳戶互轉 | transfer | both | from+to |

> **「撥款還代墊」不放在情境清單** —— 從某筆未還代墊上按「記錄撥款」觸發，金額/對象/related_to 自動帶好。

---

## 5. 員工代墊：完整走一遍

**① 員工先付（公司還沒還）—— 一列，不綁帳戶：**
```
type=advance, txn_date=消費日, party=安德家品(廠商,發票/統編),
settle_party=王小明, category=設備費用, amount=10000,
book=both(有報稅), 有統編=true, from/to_account=NULL
```
→ 損益 −10,000 ✓、外帳認列 ✓、**永豐沒動** ✓、沒有任何列 related 到它 → **「代墊未還」顯示：欠王小明 10,000**

**② 公司撥款還員工（之後，不改 ①）—— 補一列：**
```
type=reimbursement, txn_date=撥款日, party=王小明,
amount=10000, from_account=永豐, to_account=NULL,
book=internal, category=(空/非損益), related_to_id=①
```
→ 永豐 −10,000 ✓、① 被 related 到 → 代墊歸零 ✓、`type=reimbursement` 不進損益 → **費用不重複** ✓

**追溯**：①②靠 `related_to_id` 串著，內帳一眼看到「這筆撥款 = 還那筆費用」。

---

## 6. 報表（query 草稿）

**損益表 — 由 `type` 決定進不進、正負：**
```sql
SELECT c.name AS 科目, c.kind,
       sum(CASE WHEN t.type = 'income' THEN t.amount_twd ELSE -t.amount_twd END) AS net_twd
FROM transactions t
JOIN categories c ON c.id = t.category_id
WHERE t.type IN ('income','expense','advance')           -- 只算損益類
  AND (:scope = 'internal' OR t.book IN ('both','external'))  -- 外帳: 只算上外帳的
GROUP BY c.name, c.kind;
```

**帳戶餘額 / 現金流 — 由帳戶進出算（沒綁帳戶的列自然不影響）：**
```sql
SELECT a.id, a.name,
  a.opening_balance
  + coalesce((SELECT sum(t.amount) FROM transactions t WHERE t.to_account_id   = a.id), 0)
  - coalesce((SELECT sum(t.amount) FROM transactions t WHERE t.from_account_id = a.id), 0) AS balance
FROM bank_accounts a WHERE a.is_active;
```

**代墊 / 應付未還 — 代墊列（無帳戶）尚未被撥款 related 的：**
```sql
SELECT sp.name AS 對象, sum(t.amount_twd) AS 未還
FROM transactions t
JOIN parties sp ON sp.id = t.settle_party_id
WHERE t.type = 'advance'
  AND NOT EXISTS (SELECT 1 FROM transactions r WHERE r.related_to_id = t.id)
GROUP BY sp.name;
```

---

## 7. 待確認 / 待辦

1. **問會計師**：你們的內帳/外帳會不會出現「**同一筆、金額不同**」，還是只有「有沒有報」的差別?
   - 只差有沒有報 → 之後可把 `book` 收斂成布林。
   - 會差金額 → 三分法 + 拆兩列（internal/external 各記金額，用 `related_to_id` 串）就是對的，留著。
2. **App 要做的**：
   - 新增交易改成「情境優先」流程（情境卡 → 固定表單）。
   - 「記錄撥款」動作（從未還代墊觸發，自動建 reimbursement 列 + related_to）。
   - 「代墊 / 應付未還」清單。
   - 損益表改用 `type`（pnl_section 已移除）。
3. **損益細分**：移除 pnl_section 後，損益只能用 `category.kind` 粗分；要做正式分段損益表時，再跟會計師用對的分類重建（可重加一個有約束的欄位或對照表）。

---

## 附錄：考慮過但沒採用 —— 完整版（entries / payments / allocations）

曾評估把 `transactions` 拆成三表的完整 AP/AR 模型：
- `entries`（認列，不綁銀行）、`payments`（現金結算）、`allocations`（M:N 連結）。
- 優點：語意最乾淨、報表零重複、天生支援分期 / 一付多 / 應收應付。
- **沒採用的原因**：對「兩個人的團隊、正式複式外帳本來就由會計師在 Simpany 做」而言過重；分期/一付多這種需求你們幾乎用不到（代墊都是 1 對 1）。輕量版用單表 + `type` + `related_to_id` 就能達到核心需求（內外帳 + 代墊追溯），動的筋骨最少。
- 若日後真的需要完整 AP/AR（大量應收帳款、分期），再升級到三表模型。
