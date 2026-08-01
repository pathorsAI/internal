# MCP server

This app exposes a [Model Context Protocol](https://modelcontextprotocol.io) server
so an MCP client (Claude, etc.) can run essentially the whole app in natural
language — the ledger (內外帳), parties, categories, bank accounts, invoices,
projects, recurring subscriptions, contracts, employees, payroll
(read), and reconciliations.

A headline use: **never forget when to bill a client for recurring work.**
`list_upcoming_billing` projects the next charge of every active subscription from
`interval_months` + `start_date`. One-off collection is tracked on contracts (已收/未收).

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

**Discovery** — `list_organizations` (call first), `create_organization` (spin up a
new org, makes you its owner), `get_financial_overview`.

**Billing** — `list_billing_status` is the main one: the whole billing board in a
single call, merging one-off charges (contract instalments / project milestones)
with projected subscription periods. It answers 誰該請款 / 誰已繳款 / 誰還沒繳 /
發票該開給誰 — filter by `status` (`due`, `billed`, `partial`, `overdue`, `paid`,
`upcoming`), by `customerPartyId`, or with `needsInvoiceOnly`. Nothing unpaid is
ever hidden, however old it is. `list_upcoming_billing` is the narrower "what's
coming up in the next N days" view over the same data. Scheduled charges are
managed with `create_billing_item` / `update_billing_item` / `delete_billing_item`
(record 已請款 / 已收款 / 已開發票 by setting `billedOn` / `paidOn` / `invoicedOn`);
recurring fees belong in subscriptions instead, and their periods appear on the
board automatically. `sync_billing_calendar` pushes the board to Google Calendar.

> Money actually received is always computed from ledger transactions bound to the
> charge (`billingItemId`) or to a subscription period — never from `paidOn`, which
> is only a human annotation.

**Ledger (內外帳)** — `list_transactions`, `get_transaction`,
`list_outstanding_advances`, `create_transaction` (expense/income/advance/transfer),
`update_transaction` (date/amount/category/project/…), `delete_transaction`,
`create_reimbursement` (settle an advance).

**Accounting master data** — parties: `list_parties`/`get_party`/`create_party`/
`update_party`/`delete_party`; categories: `list_categories`/`create_category`/
`update_category`/`delete_category`; bank accounts: `list_bank_accounts`/
`get_bank_account`/`create_bank_account`/`update_bank_account`/`delete_bank_account`;
invoices: `list_invoices`/`get_invoice`/`create_invoice`/`delete_invoice`.
`create_invoice` takes `partyId` / `contractId` / `billingItemId`; binding an
invoice to a scheduled charge fills that charge's 開發票日, which clears it from
the 待開發票 list.

**Client ops** — projects/subscriptions/contracts each have `list_*` +
`create_*`/`update_*`/`delete_*` (`list_customers` is a convenience filter of
`list_parties`). A contract carries a `fileUrl` — the link to the signed contract
file (e.g. a Google Drive link). Contract status is stored, not derived: linking
an income transaction that fills the contract does **not** move it to
`completed` on its own. So `create_transaction` / `bulk_create_transactions` /
`update_transaction` return `contractProgress` (amount / received / remaining /
`fullyCollected`) for every contract they touched — when a contract comes back
fully collected while still draft/active, the client is told to surface it and
ask the user before calling `update_contract` with `status='completed'`. Status
is never flipped automatically.

**HR / payroll / recon** — employees: `list_employees`/`get_employee`/
`create_employee`/`update_employee`/`delete_employee`. Employee PII is
handled conservatively over MCP: national ID and salary account come back
**masked** (full values are web-app only), and every employee read is written
to the activity log as a `read` entry — so who pulled contact data, and when,
is always answerable. Payroll:
`list_payroll_runs`, `list_payslips`, `list_salary_status` (who's paid for a month
+ when), `pay_employee_salary` (records the payslip **and** posts the salary
expense to the ledger); reconciliations: `list_reconciliations` +
`create`/`update`/`delete`; accountant notices: `list_accountant_notices`,
`mark_accountant_notified`, `unmark_accountant_notified`.

**Not exposed (do in the app):** uploading invoice/receipt **files** (R2),
multi-currency FX entry, and *connecting* Google Calendar (the OAuth consent needs
a browser — do it once in 組織設定, after which `sync_billing_calendar` works over
MCP). These need file handling or extra UI. Deletes that would
break references return a clear error suggesting deactivation/archiving instead.

## Setup

1. Run the migration that adds the OAuth tables:
   `migrations/0006_mcp_oauth.sql` (apply it the same way as the other
   `migrations/*.sql` files against your database).
2. Ensure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set.
3. Add the server to your MCP client using `<BASE_URL>/mcp` and complete the
   OAuth sign-in when prompted.
