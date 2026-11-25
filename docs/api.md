# REST API

Every MCP tool of this server is also a REST endpoint. There is no second set of
handlers: `/api/v1` is generated from the same tool registry (`src/lib/mcp/tools.ts`)
and calls go through the same `runToolWithAudit` as `/mcp` — same organization
check, same owner/admin rules, same validation, same activity log.

| | |
| --- | --- |
| List tools | `GET /api/v1/tools` |
| Call a tool | `POST /api/v1/tools/<tool_name>` — body = the tool's input (the MCP `arguments`) |
| OpenAPI 3.1 | `GET /api/v1/openapi.json` (public; schemas only, no data) |
| Auth | `Authorization: Bearer pik_…` (or `X-API-Key: pik_…`) |

Tool names, inputs and outputs are documented in [mcp.md](./mcp.md) and in each
tool's JSON schema (`GET /api/v1/tools`).

## API keys

An owner or admin creates keys in **設定 › API** (`/dashboard/settings/api`):

- **Name** — shown in the list and in the activity log.
- **Scope** — `read` (唯讀) can only call `[read]` tools (`readOnlyHint`; the
  `list_*` / `get_*` tools). `write` (可寫) can call every tool except the two
  account-level ones (`list_my_invitations`, `accept_invitation`).
- **Expiry** — optional; the key stops working at the end of that day (Asia/Taipei).

The full key is shown **once**, right after it is created. The database only stores its
SHA-256 hash plus a short prefix (`pik_AbCd1234`) so you can tell keys apart. Lost it?
Revoke it and create a new one. Revoking takes effect immediately (web, or the
`revoke_api_key` tool); revoked keys stay in the list for the audit trail.

A key acts **as the member who created it**, with that member's current role. If the
creator leaves the organization the key stops working; if they lose owner/admin, the
owner/admin-only tools start failing for the key too. A key is bound to its own
organization — `organizationId` may name it, never another one.

The same key works on `/mcp` (`Authorization: Bearer pik_…`) for agents that can't do
OAuth, with the same permissions.

## Examples

```bash
export INTERNAL=https://internal.pathors.com
export KEY=pik_…   # from 設定 › API

# what can this key call?
curl -s "$INTERNAL/api/v1/tools" -H "Authorization: Bearer $KEY" | jq '.tools[].name'

# a read tool
curl -s -X POST "$INTERNAL/api/v1/tools/list_integrations" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d '{}'

# a read tool with input
curl -s -X POST "$INTERNAL/api/v1/tools/list_transactions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"period":"2026-11","limit":20}'

# a write tool (needs a read-write key, and owner/admin for settings tools)
curl -s -X POST "$INTERNAL/api/v1/tools/set_integration_auto_sync" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"provider":"wise","autoSync":false}'

# attach a receipt PDF to an existing transaction: upload it to the inbox, then attach it
DOC=$(jq -n --arg b64 "$(base64 < receipt.pdf | tr -d '\n')" \
  '{fileName:"receipt.pdf",contentType:"application/pdf",contentBase64:$b64}' |
  curl -s -X POST "$INTERNAL/api/v1/tools/upload_document" \
    -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d @- |
  jq '.result.documentId')
curl -s -X POST "$INTERNAL/api/v1/tools/update_transaction" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"id\":1234,\"documentIds\":[$DOC],\"docKind\":\"receipt\"}"
```

Responses:

```jsonc
// 200
{ "result": { /* the tool's output, as in MCP structuredContent */ } }

// 4xx
{ "error": { "code": "forbidden", "message": "create_transaction is not a [read] tool; this API key is read-only. …" } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `bad_request` | Body is not a JSON object |
| 400 | `tool_error` | The tool rejected the input or failed (the message says why — same text MCP returns) |
| 401 | `unauthorized` | Missing, malformed, expired or revoked key |
| 403 | `forbidden` | Read-only key on a non-`[read]` tool, or an account-level tool |
| 404 | `not_found` | No such tool |
| 429 | `rate_limited` | Over the per-key limit; see `Retry-After` |

## Credentials never go through the API

Integration secrets — Simpany password, Wise API token, Azure client secret, GCP
service-account JSON key, Discord webhook URL — are **not accepted and not returned** by
any tool, over REST or MCP. This is a deliberate security decision:

- `get_integration_connect_link` returns a URL that opens the integration's connect
  sheet in the web app (`/dashboard/settings/integrations?connect=<provider>`), for an
  owner/admin to type the secret there.
- Connection modes that need **no** secret can be done over the API with
  `connect_integration` — today GCP billing with workload identity (`wifAudience`,
  `serviceAccountEmail`). It runs the same live connection test as the web sheet and
  saves only when it passes. Passing a credential field is refused outright.
- Creating an API key is web-only for the same reason (it produces a secret); listing and
  revoking are available as tools.

## Audit log

Every call made with an API key — reads, writes, refused calls and failures — is written
to the organization's activity log (操作紀錄) with source **API key** (`channel = 'api'`),
the creator as the actor, and the summary starting with `API key「<name>」`. Tools that
change a record also log that record (same entity types as the web), so you can filter
the log by entity as usual.

## Rate limit

Per key (not per IP): `API_RATE_LIMIT_MAX` requests per `API_RATE_LIMIT_WINDOW` seconds,
default **120 per 60 s**, shared by REST and `/mcp`. Storage follows the existing
`RATE_LIMIT_STORAGE` setting: `database` keeps the counters in the `rate_limit` table
(migration 0034) so they are shared across Worker isolates; otherwise they are
per-isolate memory. Responses carry `X-RateLimit-Remaining`; a 429 carries `Retry-After`.

## Deploying

Migration `0038_api_keys.sql` adds `api_keys` and the `api` activity channel. Run it
before (or together with) deploying the code: without the table every key is rejected
with 401; nothing else breaks.
