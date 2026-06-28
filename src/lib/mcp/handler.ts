import { type ToolContext, tools } from "./tools";
import { type ToolAnnotations, resolveOrg } from "./shared";
import { logMcp, type ActivityAction } from "@/db/activity";

// Derive an audit-log entry from a tool name + its result. Returns null for
// read-only tools (list_/get_/...) so only writes get logged. Entity types match
// the web side (transaction, party, bank_account, contract, ...).
function deriveMcpAudit(
  name: string,
  out: unknown,
): { action: ActivityAction; entityType: string; entityId: number | null } | null {
  let entityId: number | null = null;
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    if (typeof o.id === "number") entityId = o.id;
    else if (Array.isArray(o.ids) && typeof o.ids[0] === "number") entityId = o.ids[0];
  }
  if (name.startsWith("create_")) return { action: "create", entityType: name.slice(7), entityId };
  if (name.startsWith("update_")) return { action: "update", entityType: name.slice(7), entityId };
  if (name.startsWith("delete_")) return { action: "delete", entityType: name.slice(7), entityId };
  if (name === "bulk_create_transactions") return { action: "create", entityType: "transaction", entityId };
  if (name === "pay_employee_salary") return { action: "create", entityType: "payslip", entityId };
  if (name === "mark_accountant_notified" || name === "unmark_accountant_notified")
    return { action: "update", entityType: "transaction", entityId };
  return null;
}

// Minimal MCP server over JSON-RPC 2.0 (Streamable HTTP, stateless). No SDK
// dependency — Workers-friendly. Handles initialize / tools.list / tools.call /
// ping and ignores notifications. Auth (bearer token -> userId) is done by
// withMcpAuth in the route; this module trusts ctx.userId.

const SERVER_INFO = { name: "pathors-internal", version: "1.0.0" };
const PROTOCOL_VERSION = "2025-06-18";

// Returned to the client at initialize. Steers the model to confirm the org
// before doing org-scoped work — important because the signed-in account may
// belong to multiple organizations and we never guess.
const INSTRUCTIONS = [
  "This server is the operational surface for one organization's bookkeeping: ledger transactions (內外帳), parties, categories, bank accounts, invoices, projects, subscriptions, contracts, employees, payroll (read-only), and reconciliations.",
  "The signed-in account may belong to multiple organizations.",
  "At the START of each session, before calling any org-scoped tool, call list_organizations and ask the user which organization to work in.",
  "Then pass that value as organizationId on every subsequent tool call. Never guess the organization.",
  "If a tool reports that the organization is ambiguous, stop and ask the user, then retry with organizationId.",
  "Before creating or editing a record that references another entity (categoryId, accountId, partyName/Id, projectId, contractId, subscriptionId), look the id up first with the relevant list_* tool (list_categories, list_bank_accounts, list_parties, list_projects, …) — never invent ids. Valid values for fixed fields are listed as enums in each tool's input schema.",
].join(" ");

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

// Categorize a tool from its verb (standard MCP annotations) so clients can
// group read vs write and gate destructive ops. Explicit per-tool annotations win.
function toolAnnotations(name: string, explicit?: ToolAnnotations): ToolAnnotations {
  const read = name.startsWith("list_") || name.startsWith("get_");
  const del = name.startsWith("delete_");
  const update = name.startsWith("update_");
  return {
    readOnlyHint: read,
    destructiveHint: del,
    idempotentHint: read || update || del,
    ...explicit,
  };
}

function categoryTag(a: ToolAnnotations): string {
  if (a.readOnlyHint) return "[read]";
  if (a.destructiveHint) return "[delete]";
  return "[write]";
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
        instructions: INSTRUCTIONS,
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: Object.entries(tools).map(([name, t]) => {
          const annotations = toolAnnotations(name, t.annotations);
          return {
            name,
            description: `${categoryTag(annotations)} ${t.description}`,
            inputSchema: t.inputSchema,
            annotations,
          };
        }),
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
        // Best-effort audit log for MCP writes (never affects the response).
        const audit = name ? deriveMcpAudit(name, out) : null;
        if (audit) {
          try {
            const orgId = await resolveOrg(args, ctx);
            await logMcp(orgId, ctx.userId, audit.action, audit.entityType, audit.entityId, name);
          } catch {
            // ignore audit failures
          }
        }
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

  // Optional per-connection org pin: /mcp?org=<id-or-slug>. Lets a
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
