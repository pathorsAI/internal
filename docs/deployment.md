# Deployment

This project is a standard **Next.js 16 (App Router)** application backed by
**Postgres**. There is nothing that forces a particular host on you — if you can
run Next.js and reach a Postgres database, you can run this app.

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
> bookkeeping, reports) is host-agnostic.

---

## What the app actually needs

| Requirement | Notes |
| --- | --- |
| A Node-compatible runtime | Next.js 16, React 19. We build with **Bun**. |
| Postgres | Any Postgres. Schema is introspect-only (`bun run db:pull`); migrations under [`migrations/`](../migrations) are plain forward-only SQL. |
| A Postgres driver that matches your runtime | On serverless/edge you need an **HTTP** driver (e.g. Neon). On a normal Node server you can use a regular TCP driver (`pg`). See [Database driver](#database-driver). |
| Object storage *(only for document uploads)* | Cloudflare R2 by default. Swappable — see [Storage portability](#storage-portability). |
| Env vars | `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. See [`.env.example`](../.env.example). |

---

## Our way: Cloudflare Workers + Neon

This is the configuration the repo ships with.

- **Compute:** Cloudflare Workers, via [OpenNext](https://opennext.js.org)
  (`@opennextjs/cloudflare`).
- **Database:** [Neon](https://neon.tech) serverless Postgres, over its **HTTP**
  driver (`drizzle-orm/neon-http` + `@neondatabase/serverless`).
- **Files:** Cloudflare R2, bound to the Worker as `STORAGE`.

**Why Neon here?** Workers can't open a raw TCP socket, so a normal Postgres
driver won't connect. Neon's HTTP driver works inside the Worker. This is the
*only* reason Neon is the default — the app is otherwise plain Postgres. Swap in
any Postgres-over-HTTP option, or move off Workers entirely, and it still runs.

### Deploy

```bash
# First time only: create your own wrangler config from the template
cp wrangler.jsonc.example wrangler.jsonc   # fill in account_id, routes, bucket name, worker name

# Build with OpenNext and deploy to Workers
bun run cf:deploy
```

`wrangler.jsonc` is gitignored (it holds account-specific values). In it:

- `account_id` — set it here, or omit it and export `CLOUDFLARE_ACCOUNT_ID`
  (wrangler reads it natively).
- `routes` — your custom domain; delete the block to deploy on `*.workers.dev`.
- `r2_buckets[].bucket_name` and the top-level `name` (worker name) — your own.

### Secrets

Local dev reads `.env.local`. For the deployed Worker, set secrets with wrangler
(never commit them):

```bash
echo "$BETTER_AUTH_SECRET" | bunx wrangler secret put BETTER_AUTH_SECRET
echo "$DATABASE_URL"       | bunx wrangler secret put DATABASE_URL
echo "$GOOGLE_CLIENT_ID"   | bunx wrangler secret put GOOGLE_CLIENT_ID
# …and GOOGLE_CLIENT_SECRET, BETTER_AUTH_URL
```

### Useful scripts

| Script | What it does |
| --- | --- |
| `bun run cf:build` | OpenNext build only |
| `bun run cf:preview` | Build + run the Worker locally |
| `bun run cf:deploy` | Build + deploy to Cloudflare |

---

## Docker self-host

A vendor-neutral path: a plain Node server (built with Bun) plus a Postgres
container. No Cloudflare, no Neon. Two code changes are required first — they're
small and the repo is structured to make them easy.

### Step 1 — Database driver

The default DB client uses Neon's HTTP driver, which is only needed on Workers.
On a normal server, use a TCP driver instead. Edit
[`src/db/index.ts`](../src/db/index.ts):

```ts
// Replace the neon-http driver…
//   import { drizzle } from "drizzle-orm/neon-http";
//   import { neon } from "@neondatabase/serverless";
//   _db = drizzle(neon(connectionString), { schema: fullSchema });

// …with node-postgres:
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
// inside getDb():
_db = drizzle(new Pool({ connectionString }), { schema: fullSchema });
```

Then add the driver: `bun add pg && bun add -d @types/pg`.

Because a TCP driver supports interactive transactions, you can also **remove**
the `transaction: false` line in [`src/lib/auth.ts`](../src/lib/auth.ts) (it's a
workaround for the HTTP driver only).

### Step 2 — Storage (only if you need document uploads)

See [Storage portability](#storage-portability). If you don't need the upload
feature, you can skip this; the rest of the app runs fine.

### Step 3 — Build and run

The repo ships a [`Dockerfile`](../Dockerfile), [`docker-compose.yml`](../docker-compose.yml),
and [`.dockerignore`](../.dockerignore).

```bash
# 1. Provide env (compose reads .env)
cp .env.example .env
#   set DATABASE_URL=postgres://app:app@db:5432/app   (the compose service name)
#   set BETTER_AUTH_URL to your public URL
#   generate BETTER_AUTH_SECRET:  openssl rand -base64 32

# 2. Build and start app + postgres
docker compose up --build -d

# 3. Apply the schema to the fresh database (one-time)
#    Pipe the SQL in migrations/ into the db container, e.g.:
cat migrations/*.sql | docker compose exec -T db psql -U app -d app
```

The app is then on `http://localhost:3000` (map/route it behind your own TLS
proxy for production).

> **Note on `next start`.** We deliberately do **not** set
> `output: "standalone"` in `next.config.ts`, to avoid interfering with the
> OpenNext build. The Docker image therefore runs the normal `next build` /
> `next start`. It's a little larger but needs no special config.

---

## Database driver

| Runtime | Driver | Import |
| --- | --- | --- |
| Cloudflare Workers / edge | Neon (HTTP) — **default** | `drizzle-orm/neon-http` |
| Node server / Docker | node-postgres (TCP) | `drizzle-orm/node-postgres` |
| Node server (alt) | postgres.js (TCP) | `drizzle-orm/postgres-js` |

Only [`src/db/index.ts`](../src/db/index.ts) and the `transaction: false` flag in
[`src/lib/auth.ts`](../src/lib/auth.ts) are driver-specific. Everything else is
plain Drizzle/Postgres.

## Storage portability

Document uploads currently depend on Cloudflare R2 through the Workers binding:

- [`src/lib/storage.ts`](../src/lib/storage.ts) — `getCloudflareContext().env.STORAGE`
  for `put` / `delete`.
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
service** as a starting point. Until you make this swap, the bookkeeping app runs
fine but the document upload/preview feature will error.
