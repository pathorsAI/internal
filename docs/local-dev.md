# Local development env

Two git-ignored env files drive local runs, so `next dev` uses the dev database
and the built-worker preview uses a copy of production:

| Command | Reads | Database |
| --- | --- | --- |
| `bun dev` (next dev) | `.env.local` | Neon **dev** branch (`br-bold-wildflower-a1fce385`) |
| `bun run cf:preview` (built worker) | `.dev.vars` | Neon **local-preview** branch (`br-raspy-lab-a10s90pg`, a copy of production) |

`next dev` reads `process.env` from `.env*`; the OpenNext/`wrangler dev` preview
reads `process.env` from `.dev.vars`. That's why each can point at a different DB.

The `local-preview` branch is an isolated point-in-time copy of production, so
local testing (including writes) never touches the live production database.

## Notes
- **`BETTER_AUTH_SECRET`** in these files is a local-only value. The production
  secret is a Cloudflare Worker secret and cannot be read back, so it is not
  synced — a fresh local secret is fine for local sessions.
- **`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`** are not synced (Worker secrets
  are write-only). To use Google login locally, paste them into the env file and
  add the matching redirect URI to the Google OAuth client:
  `http://localhost:3000/api/auth/callback/google` for `next dev`,
  `http://localhost:8787/api/auth/callback/google` for `cf:preview`.
- **Refresh prod data** in the preview branch by resetting `local-preview` from
  `production` (Neon console / `reset_from_parent`), or recreate the branch.
- Production secrets are managed with `wrangler secret put` — this repo does not
  use Infisical.
