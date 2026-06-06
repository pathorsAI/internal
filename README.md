# Pathors Internal — 內外帳記帳系統

[![License: Apache 2.0](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com)
[![Neon Postgres](https://img.shields.io/badge/Neon-Postgres-00E599?logo=postgresql&logoColor=white)](https://neon.tech)

多租戶的公司內部記帳系統：記帳 / 內外帳 / 薪資 / 憑證 / 專案 / 應收 / 報表。
單一部署即可服務多個組織（organization），資料以 `organization_id` 隔離。

> Next.js (App Router) + Drizzle + Neon Postgres，透過 OpenNext 部署到 Cloudflare Workers，檔案存 Cloudflare R2，登入用 better-auth（Email 密碼 + Google OAuth）。

---

## 截圖 Screenshots

> 以下皆為 placeholder，之後會換成真實（假資料）截圖 / GIF。

<p align="center">
  <img src="docs/images/demo.svg" alt="操作示範 Demo" width="80%" />
</p>

| 總覽 Dashboard | 交易帳本 Transactions |
| --- | --- |
| ![Dashboard](docs/images/dashboard.svg) | ![Transactions](docs/images/transactions.svg) |

| 報表 Reports | 成員與組織 Members & Orgs |
| --- | --- |
| ![Reports](docs/images/reports.svg) | ![Members](docs/images/members.svg) |

<!--
換成真實截圖時，把對應的 .png / .gif 放進 docs/images/，並把上面的 .svg 改成 .png / .gif：
  docs/images/demo.gif          建議：新增一筆交易的完整流程
  docs/images/dashboard.png     總覽頁
  docs/images/transactions.png  交易列表（含內外帳 book 標籤、篩選）
  docs/images/reports.png       報表頁
  docs/images/members.png       成員管理 + 組織切換器
擷取時請用假資料（建議在本機 dev 分支建一個示範 org），避免外流真實資料。
-->

---

## 功能 Features

- **多租戶**：better-auth organization plugin，一份部署多個組織，資料以 `organization_id` 隔離，內建組織切換器。
- **內外帳**：每筆交易帶 `book` 欄位區分內帳 / 外帳。
- **記帳核心**：交易、分類、銀行帳戶、往來對象（parties）、對帳（reconciliation）、代墊款（advances）。
- **客戶營運**：專案（projects）、訂閱（subscriptions）、合約（contracts）、應收帳款（receivables）。
- **薪資**：員工、薪資項目、發薪紀錄。
- **報表**：彙整收支 / 應收等視圖。
- **憑證**：檔案上傳，存放於 Cloudflare R2。
- **權限與成員**：Email 密碼 + Google OAuth 登入；邀請制成員管理；owner / admin 角色；組織設定（改名 / 刪除）。

## 技術 Tech stack

| 層 | 技術 |
| --- | --- |
| 前端 | Next.js 16（App Router）、React 19、Tailwind CSS v4、shadcn/ui + Base UI |
| 後端 | Next.js Route Handlers / Server Actions、better-auth |
| 資料庫 | Neon Postgres + Drizzle ORM（introspect-only schema） |
| 部署 | Cloudflare Workers（透過 OpenNext）、Cloudflare R2（檔案） |
| 套件管理 | Bun |

---

## 開發 Development

```bash
bun install
bun dev           # http://localhost:3000
```

需要 `.env.local`（不進版控）放 `DATABASE_URL`（Neon dev 分支的 pooled 連線字串，見 `.env.example`）。R2 / 環境綁定走 `wrangler.jsonc`，`next dev` 由 `initOpenNextCloudflareForDev()` 注入。

`.env.local` 至少要有（見 `.env.example`）：`DATABASE_URL`、`BETTER_AUTH_SECRET`、`BETTER_AUTH_URL`、`GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。

### 部署設定

`wrangler.jsonc` 不進版控（內含帳號專屬的 account id / 自訂網域 / bucket / worker 名稱）。第一次設定：

```bash
cp wrangler.jsonc.example wrangler.jsonc   # 填入你自己的值
```

- `account_id`：填在 `wrangler.jsonc`，或留空改 export `CLOUDFLARE_ACCOUNT_ID`（wrangler 會自動讀）。
- `routes`：自訂網域；只想用 `*.workers.dev` 就把整段刪掉。
- `r2_buckets[].bucket_name`、`name`（worker 名稱）：改成你自己的。

部署：`bun run cf:deploy`。

第一位 owner 在 app 上線後第一次登入只會看到 /onboarding；用 `scripts/bootstrap-owner.sql`（改好 `v_email`）把他掛成既有組織的 owner。

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

---

## 授權 License

本專案採 [Apache License 2.0](./LICENSE)。歡迎自由使用、修改、再散布；只要保留授權與著作權聲明即可。
