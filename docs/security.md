# Security overview for operators

This document is for people who deploy and run this app. It describes what the app
protects, how, and what it leaves to you. To report a vulnerability, see
[`SECURITY.md`](../SECURITY.md).

## Threat model

The app holds the books of small companies: transactions, invoices, contracts, payroll,
employee personal data and credentials for outside services. One deployment serves many
organizations.

What it is designed to defend against:

| Threat | Main defenses |
| --- | --- |
| A member of one organization reading or changing another organization's data | Every query is scoped by `organization_id`; MCP calls resolve the organization from the caller's memberships |
| A member without admin rights reaching owner/admin-only data or actions | Role checks (`owner` / `admin`) on sensitive server actions and MCP tools |
| A stolen database dump or backup exposing the most sensitive fields | Field-level AES-256-GCM encryption with a key kept outside the database |
| An AI client (MCP) leaking personal data it should never have seen | MCP only ever receives masked national IDs and bank account numbers, never credentials |
| Cross-site scripting through uploaded files, clickjacking, form exfiltration | Content-type allowlist for inline documents, CSP, `X-Frame-Options`, `nosniff` |
| Credential stuffing and abuse of email-sending endpoints | Rate limits on auth endpoints, per-recipient email cooldown, email verification before a password exists |

What it does **not** defend against, and you must handle yourself:

- A compromised host, runtime or hosting account. Anyone who can read both the database
  and the environment (where the encryption key lives) can decrypt everything.
- A malicious organization owner or admin. They can see and export their own
  organization's data by design.
- Network-level attacks on your deployment (TLS termination, DDoS, WAF). Put the app
  behind a proxy or platform that handles these.

## Multi-tenant isolation

- Authentication and organizations are provided by [better-auth](https://better-auth.com)
  and its organization plugin. Roles are `owner`, `admin` and `member`.
- Every business table carries `organization_id`, and every query in `src/db/` filters on
  the active organization. The web app reads the active organization from the session.
- The MCP server never trusts an organization id it is given: `resolveOrgId`
  (`src/lib/mcp/org.ts`) checks it against the signed-in user's memberships, and refuses
  to guess when a user belongs to several organizations and none was chosen.
- Writes through the web app and through MCP are recorded in `activity_log` (who, what,
  which entity, when). MCP entries are marked as such.

## Field-level encryption

`src/lib/crypto.ts` encrypts individual columns with **AES-256-GCM** (Web Crypto). Each
value gets a fresh random 96-bit IV; the stored format is `v1:<iv base64>:<ciphertext base64>`.
GCM's authentication tag means a tampered or truncated value fails to decrypt instead of
returning garbage. Encryption and decryption happen only on the server.

Encrypted columns:

| Data | Column | Notes |
| --- | --- | --- |
| Integration credentials (Simpany, Wise, Azure, GCP, Discord) | `org_integrations.credentials_enc` | JSON, decrypted only inside the provider implementation (`src/lib/integrations/store.ts`) |
| Cached integration tokens | `org_integrations.token_cache_enc` | Same handling as credentials |
| Employee national ID number | `employees.national_id_enc` | The legacy plaintext column is cleared on every write |
| Employee bank account number | `employee_bank_accounts.account_number_enc` | Only the last five digits are kept in plaintext, for display and matching |

### Masking and reveal

`src/lib/pii.ts` and `src/db/employee-accounts.ts` keep the plaintext away from every
read path that does not strictly need it:

- List and detail queries select a masked projection; the encrypted column is not even in
  the `SELECT` list, so it cannot leak through a list endpoint.
- National IDs are shown as the first three characters plus asterisks; bank accounts as
  asterisks plus the last five digits.
- Decryption has exactly two entry points. `revealEmployeeAccountNumber` is called only by
  the web app's "show full account number" action, which requires owner/admin and writes an
  `activity_log` entry for every reveal (the log entry itself holds only the masked form).
  `readNationalId` is used on the server to build the masked value and to fill the
  owner/admin edit form.
- MCP has no tool that returns a full national ID, a full account number or any
  integration credential.

### Key management

> **Status: in progress.** Key rotation and the multi-key configuration below are being
> added in parallel work. Until that lands, the app reads a single key from
> `FIELD_ENCRYPTION_KEY`. Check `.env.example` on your checkout for what your version
> supports.

Configuration:

| Variable | Format | Meaning |
| --- | --- | --- |
| `FIELD_ENCRYPTION_KEYS` | Comma-separated `kid:base64` pairs, e.g. `k2:…,k1:…` | Keyring. The **first** entry is the active key used for new writes; the others are kept only to decrypt older values |
| `FIELD_ENCRYPTION_KEY` | One base64 key | Legacy single-key setting, still accepted for decryption of values written before key ids existed |

Each key is 32 random bytes, base64-encoded: `openssl rand -base64 32`. Pick short, stable
key ids (`k1`, `2026-11`, …); the id is stored with each ciphertext so the app knows which
key to use.

Rotation procedure:

1. Generate a new key and **back it up** (see below) before using it.
2. Put it first in `FIELD_ENCRYPTION_KEYS`, keeping the old key(s) after it, and deploy.
   New writes now use the new key; old values still decrypt.
3. Re-encrypt existing values with the new key:
   `bun scripts/reencrypt-fields.ts` (run it against the same database and keyring as the
   app; use its dry-run option first if your version has one).
4. Once the script reports that nothing is left under the old key id, remove the old key
   from the keyring and deploy again.

Losing a key makes every value encrypted with it unreadable: integrations must be
reconnected and national IDs and account numbers re-entered. There is no recovery path.

Also in progress: encrypting the OAuth tokens that better-auth stores (for example Google
refresh tokens used by the Calendar integration) with the same keyring, and making the
database and object-storage layers portable across Postgres hosts and S3-compatible stores.

## Authentication

- Sign-in methods: Google OAuth, enterprise SSO (OIDC, routed by email domain) and email
  plus password. See [`sso.md`](sso.md).
- Password accounts are created only after the email address is verified; passwords must be
  at least 12 characters. This prevents pre-registering someone else's address before they
  sign in with Google.
- SSO providers cannot be registered over HTTP; registration is a server-side script.
- Session cookies are signed with `BETTER_AUTH_SECRET`. Rotating it signs everyone out.

### Rate limits

Configured in `src/lib/auth.ts` (better-auth's limiter, counted per IP and path, enabled in
production only):

| Path | Limit |
| --- | --- |
| Default for every auth endpoint | 100 requests / 10 s |
| `/sign-in/magic-link` | 10 / hour |
| `/sign-in/*` | 20 / minute |
| `/magic-link/verify` | 20 / minute |
| `/request-password-reset` | 10 / hour |
| `/reset-password` | 20 / hour |
| `/mcp/register` (dynamic client registration) | 20 / hour |
| `/organization/invite-member` | 30 / hour |

The limiter uses in-memory storage. On a single long-running server that is effective; on
serverless platforms with many short-lived instances (such as Cloudflare Workers) counts
are not shared, so it only stops bursts from one source. If that matters for you, add
rate limiting at your proxy or edge as well. Separately, `src/lib/email-cooldown.ts` limits
how often one recipient can be emailed, and that limit is stored in the database.

## MCP server and OAuth

- `/mcp` is protected by OAuth 2.1 using better-auth's MCP plugin. The app acts as the
  authorization server: discovery (RFC 8414 / RFC 9728), dynamic client registration
  (RFC 7591), authorization code with PKCE, and token endpoints live under `/api/auth/mcp/*`
  and `/.well-known/*`.
- Unauthenticated authorization requests go to the normal login page, so MCP access is
  granted by the same accounts, SSO rules and organization memberships as the web app.
- `BETTER_AUTH_URL` is the OAuth issuer and the protected resource identifier. It must be
  the exact public URL clients connect to.
- Dynamic registration is the only anonymous write endpoint in the app, which is why it has
  its own rate limit.
- MCP tools follow the same organization scoping and owner/admin checks as the web app, and
  every write lands in `activity_log`. No tool moves money; the Wise integration is
  read-only.
- See [`mcp.md`](mcp.md) for the tool list.

## HTTP security headers

Set for every route in `next.config.ts`:

- `Strict-Transport-Security: max-age=63072000; includeSubDomains` (no `preload`).
- `X-Content-Type-Options: nosniff`.
- `Referrer-Policy: strict-origin-when-cross-origin` (`no-referrer` on `/mcp` and
  `/.well-known/*`).
- `X-Frame-Options: DENY` and `Cross-Origin-Opener-Policy: same-origin`.
- `Permissions-Policy` that disables camera, microphone, geolocation, payment, USB and
  other unused browser features.
- An enforced `Content-Security-Policy` with `base-uri 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'` and `form-action 'self'`.
- A stricter `Content-Security-Policy-Report-Only` (`script-src 'self'` without
  `'unsafe-inline'`). It is report-only because Next's inline bootstrap scripts need
  per-request nonces before it can be enforced; `next.config.ts` lists what is missing.

`/mcp` and `/.well-known/*` get only the transport headers, because MCP clients must be able
to read them cross-origin.

Uploaded documents are served through `/api/documents/[id]` after an organization check,
from a private bucket. Only an allowlist of types that cannot run scripts (common image
formats and PDF, not SVG) is served inline; everything else is a download.

## Running it safely

### Secrets

Keep these out of the repository and out of logs, in your platform's secret store:
`BETTER_AUTH_SECRET`, `FIELD_ENCRYPTION_KEYS` / `FIELD_ENCRYPTION_KEY`, `DATABASE_URL`,
`GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `OIDC_SIGNING_KEY`. See
[`.env.example`](../.env.example) for the full list.

### Postgres

- **Require TLS** for every connection (`sslmode=require`, or `verify-full` with the server's
  CA where your provider supports it).
- **Use a dedicated, least-privilege role for the app.** It needs `SELECT`, `INSERT`,
  `UPDATE` and `DELETE` on the application tables and usage on their sequences. Run
  migrations with a separate owner role.
- **Never run the app as a superuser** or as the database owner.
- Do not expose Postgres to the public internet; restrict it to the app's network or
  an allowlist.
- Keep the server patched and enable connection and error logging.

### Backups

- Postgres backups contain the encrypted columns as ciphertext, so a leaked backup does not
  expose credentials, national IDs or bank account numbers on its own.
- The flip side: **a backup is useless for those fields without the key.** Back up the
  encryption key(s) separately from the database, for example in a password manager or a
  secrets vault with restricted access, and never in the same place as the database backups.
- Keep every key that might still be referenced by an old backup until that backup expires.
- Back up the object-storage bucket that holds uploaded documents as well; those files are
  not encrypted by the app, so rely on the storage provider's encryption at rest and keep
  the bucket private.
- Test a restore periodically, including decrypting a value with the backed-up key.

### Updates

Security fixes ship on `main`. Watch the repository's security advisories and redeploy
when one is published.
