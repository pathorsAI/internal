// Shared helpers for the OAuth discovery documents under /.well-known.
//
// Colocated with the routes (not a `route.ts`/`page.ts`, so Next treats it as a
// plain module). Deliberately does NOT import from @/lib/mcp/handler — that
// module pulls in the whole tool graph and the database layer, which has no
// business being in a static metadata response.
import { auth } from "@/lib/auth";
import { publicBaseUrl } from "@/lib/base-url";

/** Same CORS posture better-auth uses for these documents: they are public,
 *  unauthenticated and fetched by clients from arbitrary origins. */
export const DISCOVERY_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

export function discoveryPreflight(): Response {
  return new Response(null, { status: 204, headers: DISCOVERY_CORS });
}

/**
 * RFC 9728 Protected Resource Metadata for `<BASE_URL>/mcp`.
 *
 * better-auth produces the required core (`resource`, `authorization_servers`,
 * `scopes_supported`, `jwks_uri`, `bearer_methods_supported`). We add the
 * optional human-facing fields RFC 9728 defines, which OpenAI's plugin review
 * reads to explain the connector to users and admins.
 *
 * The policy and terms URLs default to the pages this deployment serves itself
 * (/privacy and /terms, public — see src/proxy.ts), so the metadata is
 * complete out of the box; the env vars stay as an override for deployments
 * that host their documents elsewhere. Documentation has no in-app page, so it
 * is still env-only and omitted when unset.
 */
export async function protectedResourceMetadata(request: Request): Promise<Response> {
  const base = await auth.api.getMCPProtectedResource({ request, asResponse: false });

  const origin = publicBaseUrl();
  const documentation = process.env.MCP_RESOURCE_DOCUMENTATION_URL;
  const policy = process.env.MCP_PRIVACY_POLICY_URL ?? `${origin}/privacy`;
  const tos = process.env.MCP_TERMS_URL ?? `${origin}/terms`;

  const body = {
    ...base,
    resource_name: "Pathors Internal — 內部帳務",
    ...(documentation ? { resource_documentation: documentation } : {}),
    resource_policy_uri: policy,
    resource_tos_uri: tos,
  };

  return Response.json(body, { headers: DISCOVERY_CORS });
}
