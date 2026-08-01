<p align="center">
  <img src="docs/images/banner.svg" alt="Pathors Internal" width="100%" />
</p>

<p align="center">
  <a href="./LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-blue.svg"></a>
  <a href="https://nextjs.org"><img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-black?logo=next.js"></a>
  <a href="https://www.postgresql.org"><img alt="Postgres" src="https://img.shields.io/badge/Postgres-Drizzle-4169E1?logo=postgresql&logoColor=white"></a>
  <a href="https://better-auth.com"><img alt="better-auth" src="https://img.shields.io/badge/Auth-better--auth-1f6feb"></a>
  <img alt="PRs welcome" src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg">
</p>

<h1 align="center">Pathors Internal</h1>

<p align="center">
  <b>Self-hosted internal accounting (內外帳) &amp; client-finance management for small companies.</b><br/>
  One deployment serves many organizations, with data isolated per <code>organization_id</code>.
</p>

> **What it is** — an internal accounting system for small companies that keep both *internal* and *external* books (內外帳), with built-in management of **client income & expenses** (projects, subscriptions, contracts, receivables). It is *not* a generic accounting/ERP package — it's the in-house ledger + client-finance tool we run ourselves.
>
> **Note** — the application UI is in **Traditional Chinese (zh-TW)**; the codebase, docs, and configuration are in English. Built for small Taiwanese companies, but the data model is plain enough for any small team.

---

## Screenshots

> Placeholders for now — swap the `.svg` files in `docs/images/` for real (anonymized) screenshots / a GIF later.

<p align="center">
  <img src="docs/images/demo.svg" alt="Demo flow" width="80%" />
</p>

| Dashboard | Transactions (內外帳) |
| --- | --- |
| ![Dashboard](docs/images/dashboard.svg) | ![Transactions](docs/images/transactions.svg) |

| Reports | Members & Organizations |
| --- | --- |
| ![Reports](docs/images/reports.svg) | ![Members](docs/images/members.svg) |

<!--
To use real screenshots: drop .png / .gif files into docs/images/ and switch the
.svg references above to .png / .gif:
  docs/images/demo.gif          suggested: the "create a transaction" flow
  docs/images/dashboard.png     overview page
  docs/images/transactions.png  ledger list (book tags, filters)
  docs/images/reports.png       reports page
  docs/images/members.png       member management + org switcher
Capture with fake data (e.g. a demo org on a local/dev database) to avoid leaking real data.
-->

---

## Features

- **Multi-tenancy** — powered by the [better-auth](https://better-auth.com) organization plugin. A single deployment hosts many orgs; every row is scoped by `organization_id`, with a built-in org switcher and owner/admin roles.
- **Dual books (內外帳)** — each transaction carries a `book` field separating internal vs. external ledgers.
- **Accounting core** — transactions, categories, bank accounts, counterparties, reconciliation, and advances/reimbursements.
- **Client finance** — track client income & expenses across projects, subscriptions, contracts, and accounts receivable.
- **Billing board (請款看板)** — one page answering 誰該請款 / 誰已繳款 / 誰還沒繳 / 發票該開給誰, merging one-off contract instalments and project milestones with recurring subscription periods.
- **Google Calendar** — billing, collection and invoicing dates are pushed to a dedicated "請款提醒" calendar, so the reminders come from Google itself. No cron needed.
- **Payroll** — employees, payroll item types, and pay runs.
- **Reports** — aggregated income/expense and receivables views.
- **Documents** — file uploads to object storage (e.g. receipts attached to transactions).
- **Auth** — Google OAuth via better-auth; invite-based member management; org settings (rename / delete).

## Tech stack

| Layer | Choice |
| --- | --- |
| Frontend | Next.js 16 (App Router), React 19, Tailwind CSS v4, shadcn/ui + Base UI |
| Backend | Next.js Route Handlers / Server Actions, better-auth |
| Database | Postgres + Drizzle ORM (introspect-only schema, plain-SQL migrations) |
| Tooling | Bun |

Nothing here is tied to a specific host or cloud — it's a standard Next.js + Postgres app. Where *we* happen to run it is just one option; see [Deployment](#deployment).

---

## Quick start

**Prerequisites:** [Bun](https://bun.sh), a Postgres database, and Google OAuth credentials.

```bash
# 1. Install
bun install

# 2. Configure
cp .env.example .env.local      # fill in DATABASE_URL, BETTER_AUTH_SECRET, Google OAuth…

# 3. Run
bun dev                          # http://localhost:3000
```

Generate `BETTER_AUTH_SECRET` with `openssl rand -base64 32`. For Google OAuth, create a "Web application" OAuth client and add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI (add your production URL before deploying).

The first user to sign in lands on `/onboarding`. To make someone the owner of an existing organization, edit `v_email` in [`scripts/bootstrap-owner.sql`](scripts/bootstrap-owner.sql) and run it against your database.

## Configuration

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres connection string (pooled) |
| `BETTER_AUTH_SECRET` | Session signing secret (`openssl rand -base64 32`) |
| `BETTER_AUTH_URL` | App base URL, no trailing slash |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth credentials (sign-in **and** the optional Google Calendar integration) |

See [`.env.example`](.env.example) for the full template.

---

## Database

This app uses **Postgres** through **Drizzle ORM**. Everything under [`migrations/`](migrations) is plain forward-only SQL, and `src/db/schema.ts` is introspected from the database (`bun run db:pull`) — the app never pushes schema. There is no vendor-specific SQL, so **any Postgres works**.

The Drizzle client lives in [`src/db/index.ts`](src/db/index.ts) — point `DATABASE_URL` at your database and you're set. Which Postgres *driver* to use is the only runtime-dependent choice (a TCP driver like `node-postgres` on a normal server; an HTTP driver if you run somewhere that can't open TCP). That single swap is covered in the [deployment guide](docs/deployment.md#database-driver).

> How you evolve schema, branch your database, or roll out migrations is up to your own workflow — this project does not prescribe one.

## Deployment

Build it (`bun run build`) and run it like any other Next.js app, anywhere that can serve Next.js and reach a Postgres database. The repo prescribes no host.

The **[deployment guide](docs/deployment.md)** walks through two concrete setups as examples — a **Docker self-host** (vendor-neutral Node + Postgres, with a [`Dockerfile`](Dockerfile) and [`docker-compose.yml`](docker-compose.yml)), and the serverless setup *we* happen to run — but neither is a requirement.

---

## Project structure

```
src/
  app/            # Next.js App Router (dashboard pages, auth routes, onboarding)
  components/     # UI components (shadcn/ui + Base UI) and shared widgets
  db/             # Drizzle client, introspected schema, queries & mutations
  lib/            # auth (better-auth), session helpers, object storage, utils
migrations/       # plain forward-only SQL migrations
scripts/          # one-off operational SQL (e.g. bootstrap-owner)
docs/             # deployment guide + README assets
Dockerfile        # vendor-neutral self-host image
docker-compose.yml
```

## Contributing

Issues and pull requests are welcome — please use [GitHub Issues](../../issues) for bugs and feature requests. Note that user-facing strings are Traditional Chinese (zh-TW); please keep new UI copy consistent.

## License

Licensed under the [Apache License 2.0](./LICENSE). You're free to use, modify, and redistribute it, including commercially — just retain the license and copyright notices.
