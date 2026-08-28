# MCP server

This app exposes a [Model Context Protocol](https://modelcontextprotocol.io) server
so an MCP client (Claude, etc.) can run essentially the whole app in natural
language — the ledger (內外帳), parties, categories, bank accounts, invoices,
projects, recurring subscriptions, contracts, employees, payroll records, and
reconciliations.

A headline use: **never forget when to bill a client for recurring work.**
`list_upcoming_billing` projects the next charge of every active subscription from
`interval_months` + `start_date`. One-off collection is tracked on contracts (已收/未收).

> **Bookkeeping only — this server moves no money.** Every write creates or edits
> a row in the organization's own books. Nothing here initiates, authorizes or
> executes a payment, transfer, payout or trade, and the server has no connection
> to a bank, card network or payment provider. `pay_employee_salary` writes a
> payslip plus the matching salary-expense ledger entry; `create_reimbursement`
> books a repaid advance; a `transfer` transaction is a book entry between two of
> the organization's own ledger accounts; `create_billing_item` adds a reminder to
> an internal board and bills nobody; `create_invoice` records an invoice, it does
> not issue one. Tool titles and descriptions are worded to say so explicitly —
> keep them that way, both directories reject anything that reads like a payment
> rail.

Design: read tools reuse the app's own query layer; writes are org-scoped and
validate every referenced id against your org. Fixed value sets are exposed as
enums in each tool's input schema; ids (categories, accounts, parties, …) are
discovered via `list_*` tools — so the model looks them up rather than guessing.

## Endpoints

| Purpose | URL |
| --- | --- |
| MCP server (configure this in your client) | `<BASE_URL>/mcp` |
| OAuth Authorization Server metadata (RFC 8414) | `<BASE_URL>/.well-known/oauth-authorization-server` |
| OAuth Protected Resource metadata (RFC 9728), canonical | `<BASE_URL>/.well-known/oauth-protected-resource/mcp` |
| …same document, root form for clients that skip path insertion | `<BASE_URL>/.well-known/oauth-protected-resource` |
| OpenAI plugin domain verification (only while a submission is open) | `<BASE_URL>/.well-known/openai-apps-challenge` |

`<BASE_URL>` is `BETTER_AUTH_URL`. It must be the public URL the client reaches
(it doubles as the OAuth issuer), e.g. `https://app.example.com`.

### Transport

Streamable HTTP, **stateless**. Everything goes over `POST /mcp`; the server
never opens an SSE stream and never issues an `Mcp-Session-Id`, so `GET` and
`DELETE` answer `405` with an `Allow: POST, OPTIONS` header (both are explicitly
permitted by the spec, and clients must handle them). `OPTIONS` answers the CORS
preflight, and `Mcp-Session-Id` / `MCP-Protocol-Version` / `WWW-Authenticate` are
allowed and exposed so a browser-side client can work. `Origin` is validated
against an allowlist (DNS-rebinding defence) — requests with no `Origin` at all,
which is how ChatGPT, Codex and Claude connect, are unaffected. An unsupported
`MCP-Protocol-Version` header gets `400`. Negotiated protocol revisions:
`2025-06-18` (default), `2025-03-26`, `2024-11-05`.

## Auth

OAuth 2.0 is handled by better-auth's `mcp` plugin (see `src/lib/auth.ts`):
Dynamic Client Registration, PKCE, authorize/token, and bearer-token validation.
On first connect the client opens the OAuth flow; you sign in with Google (the
same login as the dashboard) and a token is issued. The `/login` page then
returns you to `/api/auth/mcp/authorize` to complete the grant.

An unauthenticated request gets `401` with an RFC 9728 challenge:

```
WWW-Authenticate: Bearer resource_metadata="<BASE_URL>/.well-known/oauth-protected-resource/mcp",
                  scope="openid profile email offline_access", error="invalid_token", …
```

so a client that has never seen this server can bootstrap the whole OAuth flow
from that one response. The `resource` published in that metadata document is
`<BASE_URL>/mcp` — the endpoint itself, not the bare origin — because clients
echo it back as the `resource` parameter on the authorize and token requests.

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
  against your memberships) — one connection per org, no asking. The `/dashboard/settings/mcp`
  page lists ready-to-copy per-org URLs.

With a single-org account it just uses that org automatically.

## Tools

Every tool carries, all derived centrally in `src/lib/mcp/handler.ts` (never in
the `tools-*.ts` modules):

- a human-readable `title` — de-snake-cased from the tool name, with a small
  override table for names that don't read well, plus the ones whose default
  title would read like moving money (`pay_employee_salary` → "Record a salary
  payslip", `create_reimbursement` → "Record an advance reimbursement",
  `create_invoice` → "Record an invoice");
- MCP `annotations`: `readOnlyHint` / `destructiveHint` / `idempotentHint`
  derived from the verb, plus `openWorldHint`, which is `false` for everything
  except `sync_billing_calendar` (the only tool that writes to a third-party
  system). Four overrides correct the verb heuristic: `sync_billing_calendar`
  gets `openWorldHint: true`; `pay_employee_salary` gets `destructiveHint: true`
  — it writes the payslip plus the salary-expense ledger entry, the month can't
  be booked twice and no tool reverses it; and `set_subscription_period`
  (an upsert) and `unmark_accountant_notified` (clears a flag to null) get
  `idempotentHint: true`, which the `update_`/`delete_` prefix rule misses;
- a `[read]` / `[write]` / `[delete]` tag prefixed to the description, so
  clients can group read vs write at a glance;
- `securitySchemes: [{ type: "oauth2", scopes: [...] }]` (mirrored under `_meta`
  for clients that only read `_meta`) — every tool touches org-private data, and
  ChatGPT only offers account linking for tools that declare this;
- `_meta["openai/toolInvocation/invoking" | "invoked"]`, the status line ChatGPT
  shows while a call is in flight.

**Output schemas.** Every tool declares an `outputSchema` — all 68 of them, as of
server version 1.2.0. When a tool declares one the handler additionally returns
the result as MCP `structuredContent` (the JSON text block stays, per MCP's
back-compat recommendation), which is what ChatGPT and Codex prefer over parsing
JSON out of text. `list_organizations` remains the reference implementation.

The schema is a **promise**: MCP requires `structuredContent` to validate against
it, so each one is derived from what that tool's `execute` actually returns —
drizzle `numeric` columns come back as strings, `date` columns as `YYYY-MM-DD`
strings, and every nullable field is declared as `["string", "null"]` rather than
quietly typed as non-null. Schemas over whole `.returning()` rows deliberately
leave `additionalProperties` open, so a future migration that adds a column
doesn't silently invalidate them; hand-built fixed shapes are closed.

Only an object-rooted result can carry a schema, because MCP will not mirror a
bare array into `structuredContent`. Every tool that used to answer with a bare
array — the `list_*` tools plus `get_financial_overview` — therefore returns
`{ items, count }`, built by the `listResult` / `listSchema` helpers in
`src/lib/mcp/shared.ts`. That wrapper is what makes 100% coverage possible. Two
tools predate the convention and keep their own named roots:
`list_organizations` returns `{ organizations, hint }` and
`list_upcoming_billing` returns `{ today, windowDays, upcomingCount, upcoming,
note }`. A new tool whose return shape isn't stable and object-rooted may still
omit `outputSchema`; it just keeps the JSON-in-a-text-block result shape. Do not
declare a schema you cannot guarantee.

**Discovery** — `list_organizations` (call first), `get_financial_overview`.
Organizations are created in the web app, not over MCP.

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
`create_reimbursement` (book an advance as repaid).

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
`list_payroll_runs`, `list_payslips`, `list_salary_status` (whose salary is
booked for a month + when), `pay_employee_salary` (writes the payslip **and** the
matching salary-expense ledger entry — bookkeeping only, it pays nobody);
reconciliations: `list_reconciliations` +
`create`/`update`/`delete`; accountant notices: `list_accountant_notices`,
`mark_accountant_notified`, `unmark_accountant_notified`.

**Not exposed (do in the app):** creating an organization, uploading
invoice/receipt **files** (R2), multi-currency FX entry, and *connecting* Google
Calendar (the OAuth consent needs a browser — do it once in 組織設定, after which
`sync_billing_calendar` works over MCP). These need file handling or extra UI.
Deletes that would break references return a clear error suggesting
deactivation/archiving instead.

## Setup

1. Run the migration that adds the OAuth tables:
   `migrations/0006_mcp_oauth.sql` (apply it the same way as the other
   `migrations/*.sql` files against your database).
2. Ensure `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set.
3. Add the server to your MCP client using `<BASE_URL>/mcp` and complete the
   OAuth sign-in when prompted.

### Optional environment variables

| Variable | Effect |
| --- | --- |
| `MCP_RESOURCE_DOCUMENTATION_URL` | Published as `resource_documentation` in the protected resource metadata. |
| `MCP_PRIVACY_POLICY_URL` | Published as `resource_policy_uri`. Also the privacy policy URL an OpenAI submission requires. |
| `MCP_TERMS_URL` | Published as `resource_tos_uri`. |
| `OPENAI_APPS_CHALLENGE_TOKEN` | Served verbatim at `/.well-known/openai-apps-challenge` for OpenAI domain verification. Unset ⇒ that route 404s. |

## Connecting from ChatGPT / Codex

The protocol side is done: OAuth 2.1 with PKCE (`S256`), RFC 7591 dynamic client
registration, RFC 9728 protected resource metadata, per-tool `securitySchemes`,
titles and annotations. What's left is account-level.

**To try it privately (no review, no listing):** use ChatGPT
[developer mode](https://platform.openai.com/docs/guides/developer-mode) and add
`<BASE_URL>/mcp` as a custom connector. This is the right mode for an internal
tool — OpenAI is explicit that a directory submission is only for plugins you
intend to make *publicly* available.

**To publish it in the Plugins Directory** (ChatGPT + Codex share one directory),
the submission portal at <https://platform.openai.com/plugins> additionally needs
things that don't live in this repo:

- an OpenAI org where the submitter has **Apps Management: write**, and a
  completed **individual or business identity verification** — publishing under
  an unverified name is an automatic rejection;
- public listing URLs: website, support, **privacy policy**, **terms**; plus a
  name, logo, short/long description and category;
- **domain verification**: set `OPENAI_APPS_CHALLENGE_TOKEN` to the token the
  portal generates and redeploy, so `/.well-known/openai-apps-challenge` returns
  it as bare text;
- **reviewer demo credentials** that work without MFA, SMS, email confirmation
  or VPN — today this server signs in with Google only, which is a problem
  worth solving before submitting;
- five positive and three negative test cases, starter prompts, country
  availability, and release notes.

Sources: [Build an MCP server](https://developers.openai.com/plugins/build/mcp-server),
[Authentication](https://developers.openai.com/plugins/build/auth),
[Submit plugins](https://developers.openai.com/plugins/deploy/submission),
[MCP server review requirements](https://developers.openai.com/plugins/deploy/app-review).
