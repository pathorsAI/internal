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

需要 `.env.local`（不進版控）放 `DATABASE_URL`（Postgres 的 pooled 連線字串，見 `.env.example` 與下方「資料庫」）。R2 / 環境綁定走 `wrangler.jsonc`，`next dev` 由 `initOpenNextCloudflareForDev()` 注入。

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

## 資料庫 Database

用 **Postgres**，透過 **Drizzle ORM** 存取。`migrations/` 下都是純 SQL（forward-only），`src/db/schema.ts` 是從 DB introspect 出來的（`bun run db:pull`）——Drizzle 不負責改 schema。沒有任何廠商專屬語法，**接任何 Postgres 都可以**。

預設用 **Neon** 的 serverless（HTTP）driver，原因是本專案部署在 **Cloudflare Workers**：Workers 不能開一般的 TCP 連線，所以需要 HTTP-based 的 driver。這不是硬綁定——要換成別的 Postgres / 執行環境只要動一個檔：

- 改 `src/db/index.ts` 的 driver：
  - 一般 Node 主機 → `drizzle-orm/node-postgres`（`pg`）或 `drizzle-orm/postgres-js`。
  - 其他 serverless 平台 → 對應的 serverless driver。
- 換成支援 interactive transaction 的 driver 後，可把 `src/lib/auth.ts` 的 `transaction: false` 拿掉。
- 把 `.env` 的 `DATABASE_URL` 指向你的 Postgres 即可。

> schema 怎麼演進、要不要用分支型資料庫、migration 怎麼上線，都交給你自己的流程決定——這裡不做規範。

---

## 授權 License

本專案採 [Apache License 2.0](./LICENSE)。歡迎自由使用、修改、再散布；只要保留授權與著作權聲明即可。
