// GET /api/v1/tools — the tools this organization API key may call, with their
// JSON schemas. Generated from the MCP tool registry (src/lib/api/rest.ts); a
// read-only key only sees [read] tools. See docs/api.md.
import { apiError, apiJson, authenticateApiKey, restToolList } from "@/lib/api/rest";

export async function GET(req: Request): Promise<Response> {
  const auth = await authenticateApiKey(req);
  if (!auth.ok) {
    return apiError(auth.status === 429 ? "rate_limited" : "unauthorized", auth.message, auth.headers);
  }
  return apiJson(
    {
      organizationId: auth.ctx.apiKey.organizationId,
      apiKey: { id: auth.ctx.apiKey.id, name: auth.ctx.apiKey.name, scope: auth.ctx.apiKey.scope },
      tools: restToolList(auth.ctx),
    },
    { headers: auth.headers },
  );
}
