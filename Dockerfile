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

# Run the app unprivileged rather than as root. Created explicitly instead of
# reusing the base image's `bun` user so this does not silently break if the
# base image changes.
RUN addgroup -g 1001 -S nodejs && adduser -u 1001 -S nextjs -G nodejs

# Copy only what `next start` needs. Owned by the runtime user because Next.js
# writes into .next/cache while serving.
COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/package.json ./package.json
COPY --from=builder --chown=nextjs:nodejs /app/next.config.ts ./next.config.ts

USER nextjs
EXPOSE 3000
CMD ["bun", "run", "start"]
