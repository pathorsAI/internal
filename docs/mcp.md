# MCP server

This app exposes a [Model Context Protocol](https://modelcontextprotocol.io) server
so an MCP client (Claude, etc.) can run essentially the whole app in natural
language — the ledger (內外帳), parties, categories, bank accounts, invoices,
projects, recurring subscriptions, contracts, receivables, employees, payroll
(read), and reconciliations.

A headline use: **never forget when to bill a client for recurring work.**
`list_upcoming_billing` projects the next charge of every active subscription from
`interval_months` + `start_date`, and surfaces overdue + soon-due receivables.

Design: read tools reuse the app's own query layer; writes are org-scoped and
validate every referenced id against your org. Fixed value sets are exposed as
enums in each tool's input schema; ids (categories, accounts, parties, …) are
discovered via `list_*` tools — so the model looks them up rather than guessing.

## Endpoints

| Purpose | URL |
| --- | --- |
| MCP server (configure this in your client) | `<BASE_URL>/mcp` |
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

If you belong to **multiple orgs**, the server never guesses. Two options:

- **One connection (recommended):** add a single `<BASE_URL>/mcp`. The server
  `instructions` tell the model to call `list_organizations` at the start of a
  session and ask which org to use, then pass it as `organizationId` on every
  call. If it skips that, org-scoped tools return an "ambiguous organization"
  error listing the choices, so it must ask and retry — no data ever lands in the
  wrong org.
- **Pin per connection:** add `<BASE_URL>/mcp?org=<slug-or-id>` (validated
  against your memberships) — one connection per org, no asking. The `/settings/mcp`
  page lists ready-to-copy per-org URLs.

With a single-org account it just uses that org automatically.

## Tools

Every tool is categorized via MCP `annotations` (`readOnlyHint` / `destructiveHint`
/ `idempotentHint`, derived from the verb) plus a `[read]` / `[write]` / `[delete]`
tag prefixed to its description — so clients can group read vs write and gate
destructive calls.

**Discovery** — `list_organizations` (call first), `get_financial_overview`.

**Billing / receivables** — `list_upcoming_billing` (who to bill & when),
`list_overdue_receivables`, `list_receivables`, `create_receivable`,
`update_receivable`, `delete_receivable`, `collect_receivable` (records the income
transaction **and** marks paid — preferred), `mark_receivable_paid` (lightweight
flag, no ledger entry).

**Ledger (內外帳)** — `list_transactions`, `get_transaction`,
`list_outstanding_advances`, `create_transaction` (expense/income/advance/transfer),
`update_transaction` (date/amount/category/project/…), `delete_transaction`,
`create_reimbursement` (settle an advance).

**Accounting master data** — parties: `list_parties`/`get_party`/`create_party`/
`update_party`/`delete_party`; categories: `list_categories`/`create_category`/
`update_category`/`delete_category`; bank accounts: `list_bank_accounts`/
`get_bank_account`/`create_bank_account`/`update_bank_account`/`delete_bank_account`;
invoices: `list_invoices`/`get_invoice`/`create_invoice`/`delete_invoice`.

**Client ops** — projects/subscriptions/contracts each have `list_*` +
`create_*`/`update_*`/`delete_*` (`list_customers` is a convenience filter of
`list_parties`). A contract carries a `fileUrl` — the link to the signed contract
file (e.g. a Google Drive link).

**HR / payroll / recon** — employees: `list_employees`/`get_employee`/
`create_employee`/`update_employee`/`delete_employee`; payroll:
`list_payroll_runs`, `list_payslips`, `list_salary_status` (who's paid for a month
+ when), `pay_employee_salary` (records the payslip **and** posts the salary
expense to the ledger); reconciliations: `list_reconciliations` +
`create`/`update`/`delete`; accountant notices: `list_accountant_notices`,
`mark_accountant_notified`, `unmark_accountant_notified`.

**Not exposed (do in the app):** uploading invoice/receipt **files** (R2) and
multi-currency FX entry — these need file handling or extra UI. Deletes that would
break references return a clear error suggesting deactivation/archiving instead.

## Setup

1. Run the migration that adds the OAuth tables:
   `migrations/0006_mcp_oauth.sql` (apply it the same way as the other
   `migrations/*.sql` files against your database).
2. Ensure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set.
3. Add the server to your MCP client using `<BASE_URL>/mcp` and complete the
   OAuth sign-in when prompted.
