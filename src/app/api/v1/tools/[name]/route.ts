// POST /api/v1/tools/<name> — call one MCP tool over REST. Body = the tool's
// input JSON (same as MCP `arguments`); 200 → { result }, failure → { error }.
// Same registry, permission checks and audit log as /mcp (runToolWithAudit);
// there is no separate REST handler. See docs/api.md.
import { apiError, apiJson, authenticateApiKey } from "@/lib/api/rest";
import { runToolWithAudit } from "@/lib/mcp/handler";
import { tools } from "@/lib/mcp/tools";

export async function POST(req: Request, { params }: { params: Promise<{ name: string }> }): Promise<Response> {
  const auth = await authenticateApiKey(req);
  if (!auth.ok) {
    return apiError(auth.status === 429 ? "rate_limited" : "unauthorized", auth.message, auth.headers);
  }
  const { name } = await params;
  if (!Object.hasOwn(tools, name)) return apiError("not_found", `Unknown tool: ${name}`, auth.headers);

  let args: Record<string, unknown> = {};
  const text = await req.text();
  if (text.trim() !== "") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return apiError("bad_request", "Body must be a JSON object (the tool's input).", auth.headers);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return apiError("bad_request", "Body must be a JSON object (the tool's input).", auth.headers);
    }
    args = parsed as Record<string, unknown>;
  }

  const res = await runToolWithAudit(name, args, auth.ctx);
  if (!res.ok) {
    const code = res.code === "forbidden" ? "forbidden" : res.code === "unknown_tool" ? "not_found" : "tool_error";
    return apiError(code, res.error, auth.headers);
  }
  return apiJson({ result: res.out ?? null }, { headers: auth.headers });
}

export function GET(): Response {
  return apiError("bad_request", "Call tools with POST; GET /api/v1/tools lists them.", { Allow: "POST" });
}
