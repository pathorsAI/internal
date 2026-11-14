# Security policy

## Supported versions

This project does not cut versioned releases. Security fixes land on the `main` branch
only; if you self-host, stay close to `main` to receive them.

| Version | Supported |
| --- | --- |
| `main` | Yes |
| Older commits and forks | No |

## Reporting a vulnerability

**Please do not open a public issue, pull request or discussion for a security problem.**

Report it privately through GitHub's private vulnerability reporting:

1. Open the repository's **Security** tab.
2. Click **Report a vulnerability**.
3. Describe the issue: what is affected, how to reproduce it, and the impact you expect.
   A minimal proof of concept helps. Do not include real personal or financial data.

Only the maintainers can see the report. We discuss the fix with you in the advisory and
credit you when it is published, unless you prefer to stay anonymous.

### What to expect

- **Acknowledgement** within 3 business days.
- **Initial assessment** (confirmed or not, and a severity estimate) within 10 business days.
- **Fix**: we aim to ship critical and high-severity fixes within 30 days of confirmation.
  Lower-severity issues are scheduled with regular work. We keep you posted in the advisory.
- **Disclosure**: we publish a GitHub security advisory once a fix is on `main`. Please
  hold off public disclosure until then, or for 90 days from your report, whichever is first.

We do not run a paid bug bounty.

## Scope

In scope:

- The code in this repository: the web app, server actions and route handlers, the MCP
  server (`/mcp`) and its OAuth endpoints, the integrations under `src/lib/integrations/`,
  the SQL migrations and the scripts under `scripts/`.
- The hosted service the maintainers operate at `internal.pathors.com`. Test only against
  an organization you created yourself. Do not access, modify or delete other people's
  data, do not run denial-of-service or volume tests, and do not send spam through the
  sign-up or invitation flows.

Out of scope:

- **Self-hosted deployments.** If you run this code yourself, you are responsible for that
  deployment: its infrastructure, secrets, database, backups, TLS, network exposure and
  patching. A vulnerability in *our code* that affects self-hosters is in scope; a
  misconfiguration of a particular deployment is not. See [`docs/security.md`](docs/security.md)
  for operator guidance.
- Vulnerabilities in third-party services (Google, Wise, Simpany, Azure, GCP, Discord,
  Resend, the hosting provider) unless our code uses them unsafely.
- Missing hardening headers or best practices with no demonstrated impact, self-XSS,
  clickjacking on pages without sensitive actions, and reports generated purely by
  automated scanners.

## Data we treat as sensitive

The app holds a small company's books, so most of its data is confidential. These
categories get extra protection, and issues that expose them are treated as high severity:

- **Integration credentials**: Simpany, Wise, Azure, GCP and Discord credentials and cached
  tokens. Encrypted at rest (AES-256-GCM) and never returned to the browser or to MCP clients.
- **Employee national ID numbers** and **employee bank account numbers**. Encrypted at
  rest and shown masked everywhere. In the web app only organization owners/admins see the
  full value (a national ID in the edit form; a bank account number through an explicit
  "reveal" that is written to the audit log). MCP clients can set them but only ever read
  masked values.
- **Authentication material**: sessions, OAuth tokens, MCP access tokens, password hashes,
  sign-in links and the OIDC signing key.
- **Financial records** of each organization: transactions, invoices, contracts, payroll
  and uploaded documents. Any way to read or write another organization's data (a broken
  `organization_id` scope) is a critical issue.

See [`docs/security.md`](docs/security.md) for how these protections work.
