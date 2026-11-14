# Vendor-neutral image for self-hosting on a normal Node server.
# Builds with Bun and runs `next start`. See docs/deployment.md.
#
# Database: no driver swap needed. src/db/index.ts uses node-postgres for any
# non-Neon host (set DATABASE_DRIVER=pg to be explicit). The same image applies
# the schema with `bun scripts/migrate.ts` — docker-compose.yml runs it as the
# one-shot `migrate` service.

# --- deps: install dependencies ---------------------------------------------
FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- builder: compile the Next.js app ---------------------------------------
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# The DB client is lazy, so a build does not need a live DATABASE_URL.
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# --- runner: minimal runtime image ------------------------------------------
FROM oven/bun:1-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000

# Run the app unprivileged rather than as root. Created explicitly instead of
# reusing the base image's `bun` user so this does not silently break if the
# base image changes.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# Copy only what `next start` needs. Deliberately left owned by root, so the
# app cannot rewrite its own code or dependencies at runtime — `--chown` on
# these would hand the server write access to everything it executes.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
# The migration runner and the SQL it applies, so the same image can run
# `bun scripts/migrate.ts` (docker-compose.yml's `migrate` service).
COPY --from=builder /app/scripts/migrate.ts ./scripts/migrate.ts
COPY --from=builder /app/migrations ./migrations

# The only paths the server writes to are handed to the runtime user:
# - .next/cache: ISR output and the fetch cache.
# - data/storage: file storage with STORAGE_DRIVER=fs (the docker-compose
#   default). Created in the image so a named volume mounted on it inherits this
#   ownership; otherwise the volume is root-owned and every upload fails with EACCES.
RUN mkdir -p .next/cache data/storage && chown -R nextjs:nodejs .next/cache data

USER nextjs
EXPOSE 3000
CMD ["bun", "run", "start"]
