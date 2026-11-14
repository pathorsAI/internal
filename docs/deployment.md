# Deployment

This project (an internal-accounting / 內外帳 + client-finance app) is a standard
**Next.js 16 (App Router)** application backed by **Postgres**. There is nothing
that forces a particular host on you — if you can run Next.js and reach a
Postgres database, you can run this app.

This document describes two paths:

1. **[Our way](#our-way-cloudflare-workers--neon)** — how *we* run it
   (Cloudflare Workers + Neon). This is the default the repo is wired for, but
   it is **not the only way**.
2. **[Docker self-host](#docker-self-host)** — a portable, vendor-neutral setup
   (Node + Postgres) with a `docker-compose.yml`, for running it on your own box.

> **Heads-up on file uploads.** The document-upload feature stores files in
> **Cloudflare R2** through a Workers binding (`env.STORAGE`). That binding only
> exists on Cloudflare. On any other host (including Docker) uploads/downloads
> need an alternative storage backend — see
> [Storage portability](#storage-portability). Everything else (auth,
> accounting, client finance, reports) is host-agnostic.

---

## What the app actually needs

| Requirement | Notes |
| --- | --- |
| A Node-compatible runtime | Next.js 16, React 19. We build with **Bun**. |
| Postgres | Any Postgres. Schema is introspect-only (`bun run db:pull`); migrations under [`migrations/`](../migrations) are plain forward-only SQL, applied with `bun run db:apply` (see [Migrations](#migrations)). |
| A Postgres driver | Picked at runtime, no code change: Neon hosts use Neon's HTTP driver, everything else uses node-postgres (`pg`), and a Cloudflare Hyperdrive binding is used when present. Override with `DATABASE_DRIVER`. See [Database driver](#database-driver). |
| Object storage *(only for document uploads)* | Cloudflare R2 by default. Swappable — see [Storage portability](#storage-portability). |
| Env vars | `DATABASE_URL` (optional: `DATABASE_DRIVER`, `DATABASE_POOL_MAX`), `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `FIELD_ENCRYPTION_KEY`, `RESEND_API_KEY` (optional: `RESEND_FROM`). See [`.env.example`](../.env.example). |
| `OIDC_SIGNING_KEY` | Optional. RSA private key (PKCS#8, base64 one line or PEM) used to sign per-organization OIDC JWTs for GCP Workload Identity Federation (keyless GCP billing). Without it, GCP can only be connected with a service account key. |
| `RESEND_API_KEY` | [Resend](https://resend.com) API key. **Required in production** for public sign-up (`/signup` sends a confirmation link) and forgot-password (`/reset-password` links). Without it those emails are not sent — the pages still say "check your inbox", and the Worker log shows `[auth-email] failed to send …`. In development (`NODE_ENV !== "production"`) a missing key prints each email, link included, to the server console instead. |
| `RESEND_FROM` *(optional)* | Sender, default `Pathors Internal <noreply@pathors.com>`. The domain must be verified in Resend. Self-hosters set this to their own domain. |
| `FIELD_ENCRYPTION_KEY` | 32 random bytes, base64 (`openssl rand -base64 32`). AES-256-GCM key for field-level encryption of integration credentials (Simpany, Wise — see [integrations.md](integrations.md)) and other high-sensitivity fields. Without it, connecting an integration fails with a clear error. **Losing or rotating it makes stored credentials unreadable** — every integration must be reconnected. |

---

## Our way: Cloudflare Workers + Neon

This is the configuration the repo ships with.

- **Compute:** Cloudflare Workers, via [OpenNext](https://opennext.js.org)
  (`@opennextjs/cloudflare`).
- **Database:** [Neon](https://neon.tech) serverless Postgres, over its **HTTP**
  driver (`drizzle-orm/neon-http` + `@neondatabase/serverless`).
- **Files:** Cloudflare R2, bound to the Worker as `STORAGE`.

**Why Neon here?** It is a managed Postgres whose HTTP driver needs no
connection pooling on the Worker side, and the app auto-selects that driver for
any `*.neon.tech` host. It is not a requirement: on Workers you can use any
Postgres through [Cloudflare Hyperdrive](https://developers.cloudflare.com/hyperdrive/)
(bind it as `HYPERDRIVE`, see [Database driver](#database-driver)), and off
Workers any Postgres works over plain TCP.

### Deploy

```bash
# Build with OpenNext and deploy to Workers
bun run cf:deploy
```

`wrangler.jsonc` is **committed to the repo** — Cloudflare Workers Builds clones
the repository and runs `wrangler deploy` inside its own container, so a config
that only exists on one laptop is not enough. It holds no secrets: the worker
name, the R2 bucket name and the custom domain are all public information, and
real credentials go through `wrangler secret` (below).

If you are self-hosting a fork, change these fields:

- `name` (worker name) and `r2_buckets[].bucket_name` — your own.
- `routes` — your custom domain; delete the block to deploy on `*.workers.dev`.
- `account_id` — deliberately absent. Workers Builds already runs inside the
  right account; for local deploys export `CLOUDFLARE_ACCOUNT_ID` (wrangler
  reads it natively). Add the field back if you prefer it pinned in the file.

…or leave the file alone and point wrangler at your own copy:
`wrangler deploy --config wrangler.local.jsonc` (that filename is gitignored).

### Continuous deployment (Cloudflare Workers Builds)

To deploy on every push to `main` instead of running `cf:deploy` by hand, connect
the repository in the Cloudflare dashboard (Workers → the worker → Settings →
Builds) and use:

| Field | Value |
| --- | --- |
| Build command | `bun run cf:build` |
| Deploy command | `bunx wrangler deploy` |
| Root directory | *(leave empty)* |
| Build variables | **none** |

Two things worth knowing:

- **Deploy command is `wrangler deploy`, not `bun run cf:deploy`.** The latter is
  `cf:build && deploy`, which would build the app twice.
- **The build needs no environment variables at all** — not even `DATABASE_URL`.
  That is a property worth protecting: the database client is a lazy proxy (see
  [`src/db/index.ts`](../src/db/index.ts)), so modules can hold a `getDb()`
  reference at import time — which `next build` does when it collects page data —
  without any credentials. If someone ever runs a query at module scope, the
  build will start demanding a live connection string and CI will need a fake one
  to get past it. Don't let that happen.

Secrets set with `wrangler secret put` live on the Worker, not in the build, so
they survive every Workers Builds deploy and do not need to be re-entered.

### Secrets

Local dev reads `.env.local`. For the deployed Worker, set secrets with wrangler
(never commit them):

```bash
echo "$BETTER_AUTH_SECRET" | bunx wrangler secret put BETTER_AUTH_SECRET
echo "$DATABASE_URL"       | bunx wrangler secret put DATABASE_URL
echo "$GOOGLE_CLIENT_ID"   | bunx wrangler secret put GOOGLE_CLIENT_ID
echo "$FIELD_ENCRYPTION_KEY" | bunx wrangler secret put FIELD_ENCRYPTION_KEY
echo "$OIDC_SIGNING_KEY"     | bunx wrangler secret put OIDC_SIGNING_KEY
echo "$RESEND_API_KEY"     | bunx wrangler secret put RESEND_API_KEY
# …and GOOGLE_CLIENT_SECRET, BETTER_AUTH_URL (and RESEND_FROM if you override the sender)
```

`OIDC_SIGNING_KEY` is the platform's RSA signing key (PKCS#8 DER, one line of
base64; a full PEM also works) for GCP Workload Identity Federation — see
[integrations.md](integrations.md) (Workload Identity Federation). It is
one key for the whole deployment; organizations are told apart by the JWT `sub`
(= organization id). Optional plain vars: `OIDC_SIGNING_KID` (default
`internal-2026-10b`, must match the `kid` in the JWKS uploaded to GCP) and
`OIDC_ISSUER` (default `https://internal.pathors.com`). The public key is served
unauthenticated at `/.well-known/jwks.json` (and `/.well-known/openid-configuration`)
for future rotation; GCP currently uses the JWKS uploaded to the provider.

### Custom worker entry + Cron Trigger (daily integration auto-sync)

`wrangler.jsonc` does **not** point `main` at OpenNext's generated
`.open-next/worker.js`. It points at [`worker.ts`](../worker.ts) in the repo root,
which follows OpenNext's
[custom worker](https://opennext.js.org/cloudflare/howtos/custom-worker) pattern:

- `fetch` is OpenNext's handler, forwarded unchanged.
- `scheduled` is new — Cloudflare calls it for the Cron Trigger
  `"triggers": { "crons": ["0 22 * * *"] }` (cron is always UTC: 22:00 UTC =
  **06:00 Asia/Taipei**). It runs the daily integration auto-sync
  (see [integrations.md](integrations.md#每日自動同步)).
- The Durable Object classes OpenNext's worker exports (`DOQueueHandler`,
  `DOShardedTagCache`, `BucketCachePurge`) are re-exported as-is. None are bound
  today; they are there so turning on OpenNext caching later needs no change here.

How `scheduled` runs app code: it does **not** import `src/lib/…` directly (that
code expects a Next request context — cookies/headers for next-intl, the session —
and wrangler would bundle it a second time). Instead it calls OpenNext's `fetch`
**as a function in the same isolate** with a synthetic
`POST <BETTER_AUTH_URL origin>/api/cron/integrations-autosync`. So the sync runs in
an ordinary Next route handler, and:

- **Env / secrets**: OpenNext's `fetch` wrapper copies every string binding
  (`vars` and `wrangler secret`s: `DATABASE_URL`, `FIELD_ENCRYPTION_KEY`, …) into
  `process.env` on the isolate's first request — the synthetic request counts —
  exactly as for web traffic. Nothing extra to configure. (The synthetic request
  uses the real public origin because OpenNext also derives its origin from the
  isolate's first request.)
- **Auth of the internal route**: `scheduled` mints a one-time 256-bit token, keeps
  it in a `globalThis` set for the duration of the call and sends it in a header;
  the route consumes it or answers 404. The token never leaves isolate memory, so
  the route is unreachable from the internet and needs **no new secret**
  ([`src/lib/cron-token.ts`](../src/lib/cron-token.ts)). `/api/cron` is excluded
  from the auth proxy's matcher (`src/proxy.ts`), since there is no session.
- **Limits**: a cron invocation may run up to 15 minutes wall-clock on the paid
  plan; the sync is sequential and I/O bound. A non-2xx from the route throws, so
  Cloudflare marks that cron run as failed (Workers → the worker → Settings →
  Trigger Events / logs). Every org × integration result is also logged
  (`[autosync] …`) and stored in the integration's `config.lastAutoSync`.

Nothing changes for deploys: `bun run cf:build` still produces `.open-next/`, and
`wrangler deploy` (Workers Builds' deploy command) bundles `worker.ts`, which
imports it. The cron schedule is part of `wrangler.jsonc`, so it is created/updated
by that same deploy. To exercise `scheduled` locally:
`bun run cf:build && bunx wrangler dev --test-scheduled`, then
`curl "http://localhost:8787/__scheduled?cron=0+22+*+*+*"` (wrangler's test
endpoint). **This really syncs** against whatever DB and integrations `.dev.vars`
points to — for a harmless check of the wiring, point it at a DB with no enabled
integrations. On production, the owner-facing way to test is 設定 › 整合 →
「立即執行自動同步」 (or MCP `run_integration_sync`), which runs the same code for
one organization.

**Migration 0030** (`migrations/0030_party_avatars.sql`) adds `parties.avatar_r2_key` /
`avatar_updated_at`. Run it **before** deploying that code: the parties, transactions
and overview pages select these columns. Avatars live in the same `STORAGE` bucket under
`orgs/<organizationId>/parties/<partyId>/`.

**Migration 0033** (`migrations/0033_party_aliases.sql`) adds `parties.aliases`
(`text[] NOT NULL DEFAULT '{}'`, additive). Run it **before** deploying that code: the
parties page, `list_parties` / `get_party` and every name → party lookup (Wise sync,
`create_transaction` / `bulk_create_transactions`, the forms' customer field, Simpany
sync) select this column.

**Migration**: `migrations/0028_activity_channel_system.sql` allows
`activity_log.channel = 'system'` (the auto-sync's audit entries, no human actor).
Deploying before running it is safe — those log inserts are silently dropped by
the CHECK until it runs; the sync itself is unaffected.

The same route then posts the recurring-expense Discord notifications
(`src/lib/billing-notify.ts`, see
[integrations.md](integrations.md#discord固定支出通知)), so the local
`__scheduled` check above **also posts to Discord** for any org whose Discord
integration is on. `migrations/0032_recurring_expenses_discord.sql` (run it after
`0031`; it references `payment_methods`) adds the tables and allows
`provider = 'discord'`. Run it before deploying: until it
runs, the 固定支出 page fails, and Discord cannot be connected (the CHECK rejects
it), so the cron finds no Discord rows and the notification step does nothing.

### Useful scripts

| Script | What it does |
| --- | --- |
| `bun run cf:build` | OpenNext build only |
| `bun run cf:preview` | Build + run the Worker locally |
| `bun run cf:deploy` | Build + deploy to Cloudflare |
| `bun run db:apply` | Apply pending `migrations/*.sql` (see [Migrations](#migrations)) |

---

## Docker self-host

A vendor-neutral path: a plain Node server (built with Bun) plus a Postgres
container. No Cloudflare, no Neon. The database needs **no code changes**: with
a non-Neon `DATABASE_URL` the app uses node-postgres automatically (the compose
file also sets `DATABASE_DRIVER=pg` to make it explicit). Only document uploads
need work — see Step 1.

### Step 1 — Storage (only if you need document uploads)

See [Storage portability](#storage-portability). If you don't need the upload
feature, you can skip this; the rest of the app runs fine.

### Step 2 — Build and run

The repo ships a [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml),
and [`.dockerignore`](../.dockerignore).

```bash
# 1. Provide env (compose reads .env)
cp .env.example .env
#   set DATABASE_URL=postgres://app:app@db:5432/app   (the compose service name)
#   set BETTER_AUTH_URL to your public URL
#   generate BETTER_AUTH_SECRET:  openssl rand -base64 32

# 2. Build and start postgres, apply migrations, start the app
docker compose up --build -d
```

`docker compose up` runs the one-shot `migrate` service first: it applies
`migrations/*.sql` in filename order with [`scripts/migrate.ts`](../scripts/migrate.ts)
and exits, and `app` only starts once it succeeded. Re-runs are no-ops, so this
also picks up new migrations after you pull and rebuild. To run it by hand:
`docker compose run --rm migrate`. See [Migrations](#migrations) for how it
tracks what has been applied.

The app is then on `http://localhost:3000` (map/route it behind your own TLS
proxy for production).

> **Note on `next start`.** We deliberately do **not** set
> `output: "standalone"` in `next.config.ts`, to avoid interfering with the
> OpenNext build. The Docker image therefore runs the normal `next build` /
> `next start`. It's a little larger but needs no special config.

---

## Database driver

[`src/db/index.ts`](../src/db/index.ts) picks the driver the first time a query
runs (the client stays lazy, so `next build` still needs no `DATABASE_URL`):

| Situation | Driver |
| --- | --- |
| Cloudflare Workers with a Hyperdrive binding named `HYPERDRIVE` | node-postgres through Hyperdrive (`env.HYPERDRIVE.connectionString`); `DATABASE_URL` is not read |
| `DATABASE_DRIVER=neon-http` or `DATABASE_DRIVER=pg` | that driver |
| `DATABASE_DRIVER` unset, `DATABASE_URL` host ends in `.neon.tech` | Neon HTTP (`drizzle-orm/neon-http`) — what we run |
| `DATABASE_DRIVER` unset, any other host | node-postgres (`drizzle-orm/node-postgres`) |

`DATABASE_POOL_MAX` (default `10`) sizes the node-postgres pool per process.
Under Hyperdrive the app creates a small pool (max 5) **per request** instead:
Workers cannot reuse a socket across requests, and the real pooling happens on
Hyperdrive's side.

**Workers + any Postgres (Hyperdrive).** Create a Hyperdrive config pointing at
your database (`wrangler hyperdrive create <name> --connection-string=…`), then
uncomment the `hyperdrive` block in `wrangler.jsonc` with the returned id. For
`next dev`, also give that binding a `localConnectionString`.

**Atomic multi-statement writes.** Neon's HTTP driver has no interactive
transactions, so code that needs "all or nothing" uses `runBatch()` from
`src/db/index.ts`: `db.batch` on neon-http, `db.transaction` on node-postgres,
same result shape. Build the queries from the `q` it hands you, not from an
outer `db` — on node-postgres only queries built from the transaction run inside
it. The `transaction: false` flag in [`src/lib/auth.ts`](../src/lib/auth.ts) is
kept because it is correct on both drivers.

### Migrations

`bun run db:apply` (= `bun scripts/migrate.ts`) applies `migrations/*.sql` to
`DATABASE_URL` over plain TCP, whatever driver the app itself uses:

- Applied files are recorded in a `_migrations` table (filename, sha256
  checksum, applied_at); re-runs only apply new files.
- Each file runs in its own transaction, so a failure rolls back only that file.
  Migration files therefore must not contain `BEGIN`/`COMMIT` or statements that
  cannot run in a transaction (e.g. `CREATE INDEX CONCURRENTLY`).
- If an already-applied file's checksum changed, it refuses to run anything —
  add a new migration instead of editing an old one.
- `--dry-run` lists what would be applied and writes nothing.
- **Existing databases** (migrated by hand before this script existed) start
  with an empty `_migrations`. Record the history first, without executing it:
  `bun scripts/migrate.ts --mark-applied-through <last-applied-file>.sql`.

On an empty database it starts with `0000_baseline.sql`, which creates the tables
that predate `migrations/`. Afterwards `bun run db:pull` against it should
produce the same tables and columns as `src/db/schema.ts`. CI
([`.github/workflows/postgres.yml`](../.github/workflows/postgres.yml)) applies
the full history to a stock `postgres:17` on every PR.

## Storage portability

Document uploads and counterparty avatars currently depend on Cloudflare R2 through
the Workers binding:

- [`src/lib/storage.ts`](../src/lib/storage.ts) — `getCloudflareContext().env.STORAGE`
  for `put` / `get` / `delete` (avatars stream through `getObjectStream`, served by
  `src/app/api/parties/[id]/avatar/route.ts`).
- [`src/app/api/documents/[id]/route.ts`](../src/app/api/documents/[id]/route.ts) —
  `getCloudflareContext().env.STORAGE.get(...)` to stream files back.

`getCloudflareContext()` only resolves inside a Cloudflare Worker, so on Docker /
plain Node these two spots must be swapped for an S3-compatible client. R2 itself
speaks the S3 API, so an `@aws-sdk/client-s3` implementation works against R2,
AWS S3, or self-hosted **MinIO** alike. Sketch:

```ts
// src/lib/storage.ts (S3-compatible version)
import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,            // e.g. http://minio:9000
  region: process.env.S3_REGION ?? "auto",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
  forcePathStyle: true,                           // required for MinIO
});
// then PutObjectCommand / DeleteObjectCommand / GetObjectCommand against process.env.S3_BUCKET
```

The provided `docker-compose.yml` includes an **optional, commented-out MinIO
service** as a starting point. Until you make this swap, the accounting app runs
fine but the document upload/preview feature will error.
