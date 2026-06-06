# Pathors Internal — 內外帳記帳系統

公司內部記帳 / 薪資 / 憑證管理。Next.js (App Router) + Drizzle + Neon Postgres，透過 OpenNext 部署到 Cloudflare Workers，檔案存 Cloudflare R2。

## 開發

```bash
bun install
bun dev           # http://localhost:3000
```

需要 `.env.local`（不進版控）放 `DATABASE_URL`（Neon dev 分支的 pooled 連線字串，見 `.env.example`）。R2 / 環境綁定走 `wrangler.jsonc`，`next dev` 由 `initOpenNextCloudflareForDev()` 注入。

### 部署設定

`wrangler.jsonc` 不進版控（內含帳號專屬的 account id / 自訂網域 / bucket / worker 名稱）。第一次設定：

```bash
cp wrangler.jsonc.example wrangler.jsonc   # 填入你自己的值
```

- `account_id`：填在 `wrangler.jsonc`，或留空改 export `CLOUDFLARE_ACCOUNT_ID`（wrangler 會自動讀）。
- `routes`：自訂網域；只想用 `*.workers.dev` 就把整段刪掉。
- `r2_buckets[].bucket_name`、`name`（worker 名稱）：改成你自己的。

部署：`bun run cf:deploy`。

---

## 資料庫 / Neon 分支工作流程（SOP）

Neon 專案（`<your-neon-project-id>`），兩個分支：

| 分支 | 用途 |
|---|---|
| **production**（default / primary）| 正式資料，**資料的唯一真實來源** |
| **dev** | 開發用，**從 production 分出來的子分支**；本機 app 連這個 |

原則:
- **資料**只從 production → dev（dev 的資料永遠是可拋棄的副本）。
- **Schema** 只從 dev → production，而且**靠審過的 SQL migration 手動套用，不會自動 push**。
- Schema 改動以 **forward-only、加法優先**（加表/加欄位/可為 null/給 default）為主；要改名或刪欄位時用 expand → migrate → contract 兩段式，別在舊版 app 還在跑時直接 drop。
- `src/db/schema.ts` 是 introspect-only（drizzle 不負責改 schema），DBA 用 DDL 改完後跑 `bun run db:pull` 或手動同步。

### 1. 開發新功能前 — 把 production 資料同步到 dev

用 Neon「Reset from parent」，把 dev 重設成 production 當下的狀態（資料 + schema，copy-on-write、瞬間完成）。

```bash
neonctl branches reset dev --parent --project-id <your-neon-project-id>
# 或 Neon Console → dev 分支 → Reset from parent
```

> ⚠️ Reset 會**丟掉 dev 上所有東西**（測試資料 + 還沒推上 prod 的 schema 實驗）。所以只在「dev 沒有要保留的東西」時做——通常是在上一個功能的 schema 已經推上 production 之後。

Reset 完，dev = production（真實資料 + 目前的 prod schema），在這之上開發。

### 2. 在 dev 上改 schema

- 直接對 dev 下 DDL（ALTER / CREATE…）。
- **每一筆 schema 改動都要寫成 migration 檔**：`migrations/NNNN_說明.sql`（forward-only）。這份 SQL 就是之後要套到 production 的東西，不要只靠 console 隨手改。
- 同步更新 `src/db/schema.ts`（`bun run db:pull` 或手改）。
- 參考資料 / 種子（分類 categories、薪資項目 payroll_item_types…）也要寫成 seed SQL，因為 dev reset 後只會有 production 有的東西——這些 seed 之後要一起進 production。

### 3. 開發完 — 把 dev schema 推到 production

1. **看差異**確認 prod 缺什麼：
   ```bash
   neonctl branches schema-diff production dev --project-id <your-neon-project-id>
   ```
   （diff 是「讓 production 追上 dev」要做的改動。它是參考,不是可直接執行的腳本——實際要套的是你 step 2 寫好的 migration SQL。）
2. **先在 production 的拋棄式分支上試套**：
   ```bash
   neonctl branches create --name migrate-test --parent production --project-id <your-neon-project-id>
   # 對 migrate-test 套 migration SQL + seed，驗證沒問題
   neonctl branches delete migrate-test --project-id <your-neon-project-id>
   ```
3. 確認後**套到 production**（挑離峰、Neon 有 PITR 可回溯當保險）：對 production 跑 migration SQL + seed SQL。
4. **部署**用到新 schema 的 app（`bun run cf:deploy`）。
5. **再 reset dev from parent**（回到 step 1）→ dev 重新對齊新的 prod schema + 最新資料,準備做下一個功能。

### 黃金守則

- production 是資料來源;dev 資料隨時可丟。
- schema 在 dev 設計、用 migration SQL 推上 production,**永不反向**。
- 每個功能**開始前 reset dev、推完 schema 後再 reset dev**,讓 dev 不會跟 prod 漂太遠。
- migration 一律 forward-only、加法優先、先在拋棄式分支試過再上 production。
- 本機開發連 dev 分支;正式部署連 production 分支（換 `DATABASE_URL`）。
