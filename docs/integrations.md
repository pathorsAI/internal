# Integrations framework

Per-organization connections to external services (Simpany e-invoice, Wise, …).
Every integration is **off by default**: an owner/admin *connects* it (enters
credentials, which are tested server-side before being stored), then *switches it
on* separately. Disconnecting deletes the row, credentials included.

Google Calendar predates this framework and is **not** stored here (its token lives
in better-auth's `account` table, its settings in `calendar_settings`). The
settings page just lists it alongside the others.

## Pieces

| Where | What |
| --- | --- |
| `migrations/0023_org_integrations.sql` / `orgIntegrations` in `src/db/schema.ts` | One row per (organization, provider). `credentials_enc` / `token_cache_enc` are ciphertext from `src/lib/crypto.ts` (`FIELD_ENCRYPTION_KEY`). `config` is non-secret jsonb. |
| `src/lib/integrations/types.ts` | Provider ids, field/catalog/provider types, `IntegrationSummary` (the secret-free view). Client-safe. |
| `src/lib/integrations/catalog.ts` | Static catalog: logo + credential/config fields per provider. Drives the settings UI. Client-safe. |
| `src/lib/integrations/registry.ts` | Map of **implementations** (`testConnection`). Empty until a provider lands. Server only. |
| `src/lib/integrations/store.ts` | The only code that reads/writes `org_integrations`. Server only. |
| `src/app/dashboard/settings/integrations/` | Settings page, server actions (owner/admin only), connect Sheet. |
| `src/lib/mcp/tools-integrations.ts` | `list_integrations`, plus `requireIntegrationForTool` and `auditIntegrationCall` for provider tools. |

## Lifecycle

```
(no row) --connect: testConnection ok--> connected, enabled=false
connected --toggle--> enabled=true/false
any call gets 401/invalid creds --markNeedsReauth--> needs_reauth (enabled kept)
needs_reauth --reconnect: testConnection ok--> connected (enabled restored as it was)
any --disconnect--> (row deleted)
```

"Usable" means `enabled AND status = 'connected'`. `requireEnabledIntegration`
enforces exactly that and throws `IntegrationUnavailableError` whose message tells
the user what to do (e.g. 「Simpany 電子發票 整合尚未連接／未開啟，請 owner 或 admin 到 設定 › 整合 開啟」).

## Store API (`src/lib/integrations/store.ts`)

```ts
// secret-free reads
getIntegration(orgId, provider): Promise<IntegrationSummary | null>
listIntegrations(orgId): Promise<IntegrationSummary[]>
integrationDisplayName(provider): Promise<string>

// secret reads — server memory only, never return/log them
loadCredentials(orgId, provider): Promise<IntegrationCredentials | null>
loadTokenCache(orgId, provider): Promise<TokenCache | null>          // null if missing/expired (60s skew)
requireEnabledIntegration(orgId, provider): Promise<{ row: IntegrationSummary; credentials: IntegrationCredentials }>

// runtime reporting from provider code
saveTokenCache(orgId, provider, value: string, expiresAt: Date): Promise<void>
clearTokenCache(orgId, provider): Promise<void>
markNeedsReauth(orgId, provider, error: string): Promise<void>       // credentials rejected
recordSyncFailure(orgId, provider, error: string): Promise<void>     // transient failure, status unchanged
recordSyncSuccess(orgId, provider): Promise<void>                    // sets last_synced_at, clears last_error
updateConfig(orgId, provider, patch): Promise<IntegrationConfig | null>  // shallow jsonb merge

// used by the settings actions (they do the role check)
saveConnection({ orgId, provider, userId, credentials, config, tokenCache? }): Promise<void>
setIntegrationEnabled(orgId, provider, enabled): Promise<number>
deleteIntegration(orgId, provider): Promise<number>
```

## Adding a provider

Simpany and Wise are already in the DB `CHECK`, in `INTEGRATION_PROVIDER_IDS`, in
the catalog (Simpany: `account` email + `password`; Wise: `apiToken`) and in i18n.
To bring one to life:

1. **Implementation** — `src/lib/integrations/<id>.ts`:

   ```ts
   import type { IntegrationProvider } from "./types";

   export const wiseProvider: IntegrationProvider = {
     id: "wise",
     async testConnection(creds, config) {
       const res = await fetch("https://api.wise.com/v2/profiles", {
         headers: { Authorization: `Bearer ${creds.apiToken}` },
       });
       if (res.status === 401) return { ok: false, error: "API token 無效或已撤銷" };
       if (!res.ok) return { ok: false, error: `Wise 回應 ${res.status}` };
       const profiles = await res.json();
       return { ok: true, config: { profileId: profiles[0]?.id } };
     },
   };
   ```

   - Return `{ ok: false, error }` for bad credentials; `error` is shown to the user
     and must never contain the credentials. Throwing is reserved for unexpected
     failures (the framework turns it into a message).
   - Return discovered non-secret settings in `config`; return a session token in
     `tokenCache` if the service hands one out (it is encrypted).
   - Use `fetch` only — this runs on Cloudflare Workers.

2. **Register** it: one line in `PROVIDERS` in `registry.ts`
   (`wise: wiseProvider,`). The Connect button on 設定 › 整合 turns on
   automatically.

3. **Business logic** (web actions or MCP tools):

   ```ts
   const { row, credentials } = await requireEnabledIntegration(orgId, "wise");
   try {
     const data = await callWise(credentials, row.config);
     await recordSyncSuccess(orgId, "wise");
   } catch (e) {
     if (isAuthError(e)) await markNeedsReauth(orgId, "wise", "Wise token 已失效");
     else await recordSyncFailure(orgId, "wise", String(e));
     throw e;
   }
   ```

   For session-token providers (Simpany): try `loadTokenCache`, fall back to logging
   in with `credentials`, then `saveTokenCache`; on a rejected token
   `clearTokenCache` and retry once before `markNeedsReauth`.

4. **MCP tools** — a new `src/lib/mcp/tools-<id>.ts`, spread into `tools` in
   `tools.ts`, and bump `SERVER_VERSION` in `handler.ts`:
   - Tools are always listed; in `execute` call
     `requireIntegrationForTool(orgId, "<id>")` first so a disconnected/disabled
     integration fails with the clear zh-TW message (same as `sync_billing_calendar`).
   - Log each external call with `auditIntegrationCall(ctx, orgId, "<id>", action, detail)`
     (`detail` must not contain credentials or full PII).
   - Anything that reaches the third party must get `openWorldHint: true` in
     `OPENWORLD_OVERRIDES` (handler.ts); add title/destructive overrides as needed.
   - Never put credentials, tokens or ciphertext in a tool result.

5. **Extra settings** — declare `configFields` in the catalog entry (same shape as
   `credentialFields`, stored in plain `config`) and add labels under
   `integrations.fields` in `src/i18n/messages/integrations.ts` (zh-TW + en).

### A brand-new provider (not simpany/wise)

Also: a new migration extending `chk_org_integration_provider` (and the matching
`check(...)` in `schema.ts`), the id in `INTEGRATION_PROVIDER_IDS`, a catalog entry
+ `INTEGRATION_ORDER`, and `integrations.providers.<id>.name/description` in i18n.

## Security rules

- Credentials are encrypted with `FIELD_ENCRYPTION_KEY` (see
  [deployment.md](deployment.md)). Losing or rotating the key means every
  integration has to be reconnected.
- Nothing that reaches a client — server-action results, page props, MCP results —
  may contain credentials, tokens or ciphertext. `IntegrationSummary` has no such
  fields by construction; don't bypass it with a raw select.
- Credentials are only entered in the web UI by owners/admins, never over MCP.
