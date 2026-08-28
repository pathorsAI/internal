# Single sign-on (SSO)

Besides Google, the app can sign people in through **any OIDC identity provider** —
Cloudflare Access, Okta, Entra ID, Auth0, Keycloak, whatever speaks OpenID Connect.

The login page does **home realm discovery**: the user picks *Continue with SSO* and
types their email. The email's domain is matched against the registered providers and
the browser is handed to whichever IdP owns that domain. No domain is hardcoded
anywhere in the UI — which domains work is entirely a function of what has been
registered in the database.

First sign-in through a provider creates the user automatically (implicit signup).
It does **not** put them in an organization; they land on `/onboarding` and join via
the normal invitation flow, exactly like a first-time Google user.

Implemented with better-auth's [`@better-auth/sso`](https://www.better-auth.com/docs/plugins/sso)
plugin (see `src/lib/auth.ts`). SAML is supported by the plugin but not used here.

## Endpoints

| Purpose | URL |
| --- | --- |
| Start SSO sign-in (called by the login page) | `POST <BASE_URL>/api/auth/sign-in/sso` |
| OIDC callback — **this is the IdP's redirect URL** | `<BASE_URL>/api/auth/sso/callback/<providerId>` |
| Provider registration | *disabled over HTTP — see below* |

`<BASE_URL>` is `BETTER_AUTH_URL`, the public URL of the deployment.

## Registration is server-side only

The plugin ships a `POST /sso/register` endpoint that is guarded by nothing more than
"you are signed in". That is not enough for this app: registering a provider means
declaring *who is allowed to mint identities here*, so any ordinary member could point
a domain at an IdP they control and issue themselves accounts.

`src/lib/auth.ts` therefore closes that route two independent ways:

- `disabledPaths: ["/sso/register"]` — the router answers `404` before the handler runs.
- `sso({ providersLimit: 0 })` — the handler itself returns `403` even if the route
  were ever reachable.

`disabledPaths` is enforced in the HTTP router only, so a direct server-side write still
works. Registration goes through `scripts/register-sso-provider.ts`, which needs
`DATABASE_URL` — i.e. an operator, not a user.

`/sso/update-provider` and `/sso/delete-provider` stay enabled: they check ownership
against `sso_provider.user_id`, and that column is only ever filled by the script.

## Setting up Cloudflare Access for SaaS

Cloudflare Access can act as the IdP in front of whatever identity source your team
already uses (Google Workspace, Entra ID, one-time PIN, …). Zero Trust → **Access** →
**Applications** → **Add an application** → **SaaS**.

1. **Application** — give it a name. Under *Application type* pick **OIDC**.
2. **Scopes** — tick `openid`, `email`, `profile`. These are what the app asks for.
3. **Redirect URLs** — enter the callback for the provider id you are about to use:

   ```
   https://<your-app-host>/api/auth/sso/callback/<providerId>
   ```

   `<providerId>` is a short slug you choose (e.g. `acme`). It must match the
   `--provider-id` you pass to the script, because it is part of the URL.
4. Save. Cloudflare then shows three values you will need — copy them now, the client
   secret is only shown once:

   | Cloudflare field | Script argument |
   | --- | --- |
   | Client ID | `--client-id` |
   | Client secret | `--client-secret` |
   | Issuer (a.k.a. *OIDC issuer*) | `--issuer` |

   The issuer looks like this, where `<client-id>` is the same Client ID as above:

   ```
   https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>
   ```

   Discovery lives at `<issuer>/.well-known/openid-configuration`. You can `curl` it to
   confirm the values before running the script.
5. Add an **Access policy** deciding who may use the application. Cloudflare enforces
   this *before* the user ever reaches this app.

Other IdPs work the same way — only the wording of the fields differs.

## Registering the provider

```bash
SSO_CLIENT_SECRET='…' bun scripts/register-sso-provider.ts \
  --provider-id acme \
  --domain acme.com \
  --issuer 'https://<team>.cloudflareaccess.com/cdn-cgi/access/sso/oidc/<client-id>' \
  --client-id '<client-id>'
```

| Argument | Env var | Meaning |
| --- | --- | --- |
| `--provider-id` | `SSO_PROVIDER_ID` | Slug; appears in the callback URL. Must match the IdP's redirect URL. |
| `--domain` | `SSO_DOMAIN` | Email domain routed to this IdP. This is the home-realm-discovery key. |
| `--issuer` | `SSO_ISSUER` | OIDC issuer URL. |
| `--client-id` | `SSO_CLIENT_ID` | OAuth client id from the IdP. |
| `--client-secret` | `SSO_CLIENT_SECRET` | OAuth client secret. Prefer the env var so it stays out of shell history. |
| `--owner-email` | — | Optional. An existing user who may edit/delete this provider over HTTP. Omit to keep it script-managed only. |
| `--org` | — | Optional organization slug to associate. Does **not** auto-add users to it. |
| `--scopes` | — | Comma-separated. Default `openid,email,profile`. |

The script fetches the discovery document at registration time and stores the resolved
endpoints. That is deliberate: the plugin only re-runs discovery at sign-in when the
stored config is missing endpoints, and that path validates IdP URLs against the app's
`trustedOrigins` — so pre-resolving means you never have to touch `trustedOrigins` to
add an IdP. During discovery the script trusts only the issuer's own origin, so a
malicious discovery document cannot redirect the token or JWKS endpoint elsewhere.

`bun` reads `.env.local` automatically, so `DATABASE_URL` does not need to be passed.
Use `bun --env-file=… ` to target a different environment.

It prints the callback URL when it finishes — check that it matches what you entered in
the IdP.

## Verifying

1. Open `/login`, click **Continue with SSO**, enter an address at the registered domain.
2. You should be sent to the IdP, and back to `/dashboard` (or straight back into an MCP
   OAuth flow, if that is what started the login).
3. An email domain with no provider gets a friendly "SSO is not configured for this email
   domain" toast rather than a raw error.

## Removing a provider

There is no UI. Delete the row:

```sql
DELETE FROM sso_provider WHERE provider_id = 'acme';
```

Existing sessions survive — sign-in method is not re-checked per request. Revoke access
at the IdP (or delete the sessions) if you need the users out immediately.

## See also

- `migrations/0020_sso_provider.sql` — the table and why each column exists.
- `src/lib/auth.ts` — plugin configuration and the registration lockdown.
- Password sign-in, the other non-Google method, is documented in the README; accounts
  are provisioned with `scripts/create-user.ts`.
