# MCP server

This app exposes a [Model Context Protocol](https://modelcontextprotocol.io) server
so an MCP client (Claude, etc.) can query and update your client finance data —
projects, recurring subscriptions, contracts, and receivables — in natural language.

It is built for one job in particular: **never forget when to bill a client for
recurring work.** `list_upcoming_billing` projects the next charge of every active
subscription from `interval_months` + `start_date`, and surfaces overdue + soon-due
receivables.

## Endpoints

| Purpose | URL |
| --- | --- |
| MCP server (configure this in your client) | `<BASE_URL>/api/mcp` |
| OAuth Authorization Server metadata | `<BASE_URL>/.well-known/oauth-authorization-server` |
| OAuth Protected Resource metadata | `<BASE_URL>/.well-known/oauth-protected-resource` |

`<BASE_URL>` is `BETTER_AUTH_URL`. It must be the public URL the client reaches
(it doubles as the OAuth issuer), e.g. `https://app.example.com`.

## Auth

OAuth 2.0 is handled by better-auth's `mcp` plugin (see `src/lib/auth.ts`):
Dynamic Client Registration, PKCE, authorize/token, and bearer-token validation.
On first connect the client opens the OAuth flow; you sign in with Google (the
same login as the dashboard) and a token is issued. The `/login` page then
returns you to `/api/auth/mcp/authorize` to complete the grant.

All data is scoped to your organization. The token only carries your user id, so
the server resolves your org from membership (matching the dashboard's behaviour).
If you belong to multiple orgs, every tool accepts an optional `organizationId`.

## Tools

Read:
- `list_upcoming_billing` — overdue + soon-due receivables, plus projected next
  charges of active subscriptions (the "who do I bill, and when" tool)
- `list_overdue_receivables`
- `list_subscriptions` (with computed `nextChargeDate`)
- `list_receivables`, `list_contracts`, `list_projects`, `list_customers`

Write (safe):
- `mark_receivable_paid` — sets status=paid + paid_at (does **not** post a ledger
  transaction; record the income entry in the app)
- `create_receivable` — create an open receivable, optionally linked to a
  project / subscription / contract

## Setup

1. Run the migration that adds the OAuth tables:
   `migrations/0006_mcp_oauth.sql` (apply it the same way as the other
   `migrations/*.sql` files against your database).
2. Ensure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set.
3. Add the server to your MCP client using `<BASE_URL>/api/mcp` and complete the
   OAuth sign-in when prompted.
