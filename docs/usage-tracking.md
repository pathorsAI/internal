# Feature usage tracking

Settings › Feature usage (`/dashboard/settings/usage`, owners and admins only) lists every
dashboard page and every MCP tool with when it was last used, how often in the last 30 days, by
how many people, and through which channel. Features nobody has used, or nobody has used in 30
days, are listed first.

## Where the data comes from

| Source | What | Since |
| --- | --- | --- |
| `usage_events` (migration 0047) | Page loads (`kind = 'page'`) and tool calls (`kind = 'tool'`), reads included | The day this shipped; kept 180 days |
| `activity_log` | Writes only (the audit log) | Its whole history, but only rows older than the first `usage_events` row of the same kind, so nothing is counted twice |

`activity_log` rows are mapped back to features: MCP / AI / API / chat writes by their summary
(the tool name, or an integration tool's own summary such as `wise: 列出 5 個餘額`); web writes by
`entity_type` to the page that owns that kind of record (`src/lib/usage/stats.ts`, `ENTITY_PAGE`).
Scheduled jobs (`channel = 'system'`) are not usage and are ignored.

The two tables are deliberately separate: `activity_log` is the permanent audit trail of who
changed what; usage events are high-volume statistics with a retention limit.

## How it is recorded

- **Page views.** `src/proxy.ts` normalizes the pathname to a route pattern from
  `src/lib/usage/routes.ts` (`/dashboard/ai/42` → `/dashboard/ai/[id]`) and puts it in a request
  header. It skips non-GET requests, prefetches and server actions, and strips the header from
  incoming requests so it cannot be forged. `getSession()` (`src/lib/session.ts`) reads the header
  once it has the session and calls `recordPageView`. Paths that match no known page are not recorded.
- **Tool calls.** `runToolWithAudit` (`src/lib/mcp/handler.ts`) is the single entry point for MCP,
  REST `/api/v1`, the in-app AI and the LINE / WhatsApp bots. It times every call and calls
  `recordToolCall` with the tool name, channel (`api` whenever an API key is used), success and duration.
- **Never blocking.** Inserts run after the response via Next's `after()` (OpenNext implements it
  with `ctx.waitUntil` on Workers) and swallow their own errors. Nothing at module scope holds a
  promise across requests (see PR #122 / `src/lib/better-auth-als.ts`).
- **Deduplication.** The same user on the same page within 30 seconds is recorded once (per isolate).
- **Retention.** The daily cron (`/api/cron/integrations-autosync`) deletes rows older than 180 days.

## What is not recorded

Query strings, page content, tool arguments, tool results, IP addresses and user agents.

## Turning it off

Set `USAGE_TRACKING=off` (also accepts `false`, `0`, `no`, `disabled`). Nothing is written; the
usage page still shows the write history from `activity_log`, and the daily cleanup still removes
old rows. All data lives only in your own database.

## Adding a page

Add the route to `DASHBOARD_ROUTES` in `src/lib/usage/routes.ts` and a label under `pages` in
`src/i18n/messages/usage.ts`. `routes.test.ts` fails if the list drifts from `src/app/dashboard/**/page.tsx`.
