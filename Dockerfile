# Vendor-neutral image for self-hosting on a normal Node server.
# Builds with Bun and runs `next start`. See docs/deployment.md.
#
# NOTE: before this image's DB access works you must swap the Neon HTTP driver
# for a TCP driver (node-postgres) in src/db/index.ts — see docs/deployment.md.

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

# Copy only what `next start` needs.
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts

EXPOSE 3000
CMD ["bun", "run", "start"]
