// MCP server endpoint. Configure this URL in your MCP client (Claude, ChatGPT,
// Codex, …):
//   https://<your-app>/mcp
//
// Transport: MCP Streamable HTTP, stateless. POST carries every JSON-RPC
// message; we never open an SSE stream and never issue an `Mcp-Session-Id`, so
// GET (SSE) and DELETE (session teardown) answer 405, which the spec allows and
// clients are required to handle.
//
// withMcpAuth validates the OAuth bearer token (issued by the better-auth `mcp`
// plugin) and hands us the resolved session. Unauthenticated requests get a 401
// with a WWW-Authenticate header pointing at the OAuth protected-resource
// metadata, which kicks off the login + consent flow in the client.
//
// Headless agents without OAuth can instead send an organization API key
// (`Authorization: Bearer pik_…`, created under 設定 › API). It runs as the key's
// creator, is pinned to the key's organization, a read-only key only sees and
// calls [read] tools, every call is logged under channel 'api', and it shares
// the REST API's per-key rate limit. See docs/api.md.
import { withMcpAuth } from "better-auth/plugins";
import { extractApiKey } from "@/lib/api-keys";
import { authenticateApiKey } from "@/lib/api/rest";
import { auth } from "@/lib/auth";
import {
  corsHeaders,
  handleMcpRequest,
  unauthorizedResponse,
  withCors,
} from "@/lib/mcp/handler";

const authed = withMcpAuth(auth, (req, session) =>
  handleMcpRequest(req, { userId: session.userId }),
);

export async function POST(req: Request): Promise<Response> {
  if (extractApiKey(req)) {
    const key = await authenticateApiKey(req);
    if (!key.ok) {
      if (key.status === 401) return unauthorizedResponse(req, key.message);
      return withCors(
        Response.json(
          { jsonrpc: "2.0", id: null, error: { code: -32029, message: key.message } },
          { status: 429, headers: key.headers },
        ),
        req,
      );
    }
    return handleMcpRequest(req, { userId: key.ctx.userId, apiKey: key.ctx.apiKey });
  }
  const res = await authed(req);
  // better-auth's own 401 points at `<baseURL>/api/auth/.well-known/...` and
  // carries no `scope`/`error`. Replace it with the canonical RFC 9728
  // challenge so ChatGPT can discover the metadata document from the 401 alone.
  if (res.status === 401) return unauthorizedResponse(req);
  return withCors(res, req);
}

/** No server-initiated stream on this endpoint (stateless server). */
export function GET(req: Request): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "This MCP endpoint is stateless and does not offer an SSE stream. Use POST.",
      },
    },
    { status: 405, headers: { ...corsHeaders(req), Allow: "POST, OPTIONS" } },
  );
}

/** No sessions to terminate — the server issues no `Mcp-Session-Id`. */
export function DELETE(req: Request): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: {
        code: -32000,
        message: "This MCP endpoint is stateless; there is no session to terminate.",
      },
    },
    { status: 405, headers: { ...corsHeaders(req), Allow: "POST, OPTIONS" } },
  );
}

/** CORS preflight for browser-side MCP clients. */
export function OPTIONS(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}
