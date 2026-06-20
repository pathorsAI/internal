// MCP server endpoint. Configure this URL in your MCP client (e.g. Claude):
//   https://<your-app>/mcp
//
// withMcpAuth validates the OAuth bearer token (issued by the better-auth `mcp`
// plugin) and hands us the resolved session. Unauthenticated requests get a 401
// with a WWW-Authenticate header pointing at the OAuth metadata, which kicks off
// the login + consent flow in the client.
import { withMcpAuth } from "better-auth/plugins";
import { auth } from "@/lib/auth";
import { handleMcpRequest } from "@/lib/mcp/handler";

const handler = withMcpAuth(auth, (req, session) =>
  handleMcpRequest(req, { userId: session.userId }),
);

export { handler as POST };
