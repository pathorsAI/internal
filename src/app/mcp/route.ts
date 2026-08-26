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
import { withMcpAuth } from "better-auth/plugins";
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
