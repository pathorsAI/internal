import { type ToolContext, tools } from "./tools";

// Minimal MCP server over JSON-RPC 2.0 (Streamable HTTP, stateless). No SDK
// dependency — Workers-friendly. Handles initialize / tools.list / tools.call /
// ping and ignores notifications. Auth (bearer token -> userId) is done by
// withMcpAuth in the route; this module trusts ctx.userId.

const SERVER_INFO = { name: "pathors-internal", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-06-18";

type JsonRpcId = string | number | null;
type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

function ok(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function fail(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function handleMessage(
  msg: JsonRpcMessage,
  ctx: ToolContext,
): Promise<object | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize":
      return ok(id, {
        protocolVersion:
          (msg.params?.protocolVersion as string) ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: Object.entries(tools).map(([name, t]) => ({
          name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });

    case "tools/call": {
      const name = msg.params?.name as string | undefined;
      const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
      const tool = name ? tools[name] : undefined;
      if (!tool) {
        return ok(id, {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        });
      }
      try {
        const out = await tool.execute(args, ctx);
        return ok(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
        });
      } catch (err) {
        return ok(id, {
          content: [
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          isError: true,
        });
      }
    }

    default:
      if (isNotification) return null;
      return fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

export async function handleMcpRequest(
  req: Request,
  session: { userId: string },
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400 });
  }

  // Optional per-connection org pin: /api/mcp?org=<id-or-slug>. Lets a
  // multi-org user run one connection per org. Validated in resolveOrgId.
  const orgHint = new URL(req.url).searchParams.get("org") ?? undefined;
  const ctx: ToolContext = { userId: session.userId, orgHint };

  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(body.map((m) => handleMessage(m as JsonRpcMessage, ctx)))
    ).filter((r): r is object => r !== null);
    if (responses.length === 0) return new Response(null, { status: 202 });
    return Response.json(responses);
  }

  const res = await handleMessage(body as JsonRpcMessage, ctx);
  if (!res) return new Response(null, { status: 202 });
  return Response.json(res);
}
