import { type ToolContext, tools } from "./tools";
import { type ToolAnnotations, type ToolDef, resolveOrg } from "./shared";
import { logMcp, type ActivityAction } from "@/db/activity";

// Derive an audit-log entry from a tool name + its result. Returns null for
// most read-only tools (list_/get_/...) so only writes get logged — except
// employee reads, which carry PII (email/phone + masked national id/account)
// and are logged as "read". Entity types match the web side.
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
  if (name === "list_employees" || name === "get_employee")
    return { action: "read", entityType: "employee", entityId };
  return null;
}

// Minimal MCP server over JSON-RPC 2.0 (Streamable HTTP, stateless). No SDK
// dependency — Workers-friendly. Handles initialize / tools.list / tools.call /
// ping and ignores notifications. Auth (bearer token -> userId) is done by
// withMcpAuth in the route; this module trusts ctx.userId.

// ---------------------------------------------------------------------------
// Server identity
// ---------------------------------------------------------------------------

/** Bump on every published change to tools, schemas or instructions. Clients
 *  (and OpenAI's plugin "Scan Tools") key their cached snapshot off this. */
export const SERVER_VERSION = "1.1.0";

/** Public base URL of this deployment; doubles as the OAuth issuer.
 *  Keep in sync with the `resource` passed to `mcp()` in src/lib/auth.ts. */
export const PUBLIC_BASE_URL = (
  process.env.BETTER_AUTH_URL ?? "https://internal.pathors.com"
).replace(/\/+$/, "");

/** Canonical resource identifier of this MCP server (RFC 8707 / RFC 9728).
 *  ChatGPT echoes this exact string as the `resource` OAuth parameter. */
export const MCP_RESOURCE = `${PUBLIC_BASE_URL}/mcp`;

/** RFC 9728 metadata URL, using the path-insertion form the MCP authorization
 *  spec requires for a resource that lives under a path (`/mcp`). */
export const MCP_RESOURCE_METADATA_URL = `${PUBLIC_BASE_URL}/.well-known/oauth-protected-resource/mcp`;

/** Scopes better-auth's `mcp` plugin advertises and issues. Mirrored per tool
 *  as `securitySchemes` so ChatGPT can render an accurate consent screen. */
export const MCP_SCOPES = ["openid", "profile", "email", "offline_access"];

const SERVER_INFO = {
  name: "pathors-internal",
  // Human-readable display name (MCP `BaseMetadata.title`); this is what a
  // client shows in its UI instead of the machine name.
  title: "Pathors Internal — 內部帳務",
  version: SERVER_VERSION,
  websiteUrl: PUBLIC_BASE_URL,
};

/** Protocol revisions this server speaks, newest first. */
const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0];

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

// ---------------------------------------------------------------------------
// HTTP / CORS helpers (shared with src/app/mcp/route.ts)
// ---------------------------------------------------------------------------

const CORS_ALLOW_HEADERS =
  "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID";
// WWW-Authenticate must be readable by browser-side clients or they can never
// discover the OAuth metadata URL from a 401.
const CORS_EXPOSE_HEADERS = "WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version";

// Browser origins allowed to talk to /mcp. The MCP spec requires servers to
// validate `Origin` (DNS-rebinding defence). Requests with no Origin header —
// which is how ChatGPT, Codex and Claude actually connect, server-to-server —
// are unaffected. Add a host here if a new browser-based client shows up.
const ALLOWED_ORIGINS = new Set(
  [
    PUBLIC_BASE_URL,
    "https://internal.pathors.com",
    "https://pathors-internal.pathors.workers.dev",
    "https://chatgpt.com",
    "https://chat.openai.com",
    "https://platform.openai.com",
    "https://codex.openai.com",
    "https://claude.ai",
    "https://claude.com",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ].map((u) => {
    try {
      return new URL(u).origin;
    } catch {
      return u;
    }
  }),
);

export function isAllowedOrigin(origin: string | null): boolean {
  if (!origin) return true; // non-browser client
  return ALLOWED_ORIGINS.has(origin);
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  return {
    "Access-Control-Allow-Origin": origin && isAllowedOrigin(origin) ? origin : "*",
    "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Expose-Headers": CORS_EXPOSE_HEADERS,
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

/** Copy CORS headers onto a response we didn't build ourselves (e.g. the 401
 *  that better-auth's `withMcpAuth` returns). */
export function withCors(res: Response, req: Request): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(req))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * RFC 9728 §5.1 challenge. `resource_metadata` points at the path-inserted
 * metadata document so a client that has never seen this server can bootstrap
 * the whole OAuth flow from a single 401.
 */
export function mcpWwwAuthenticate(error?: string, errorDescription?: string): string {
  const parts = [
    `Bearer resource_metadata="${MCP_RESOURCE_METADATA_URL}"`,
    `scope="${MCP_SCOPES.join(" ")}"`,
  ];
  if (error) parts.push(`error="${error}"`);
  if (errorDescription) parts.push(`error_description="${errorDescription}"`);
  return parts.join(", ");
}

/** 401 with a spec-shaped challenge plus a JSON-RPC error body. */
export function unauthorizedResponse(
  req: Request,
  errorDescription = "Authentication required. Complete the OAuth flow and retry with a bearer token.",
): Response {
  const challenge = mcpWwwAuthenticate("invalid_token", errorDescription);
  return Response.json(
    {
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: `Unauthorized: ${errorDescription}` },
    },
    {
      status: 401,
      headers: { ...corsHeaders(req), "WWW-Authenticate": challenge },
    },
  );
}

// ---------------------------------------------------------------------------
// JSON-RPC plumbing
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tool metadata
// ---------------------------------------------------------------------------

// Categorize a tool from its verb (standard MCP annotations) so clients can
// group read vs write and gate destructive ops. Explicit per-tool annotations win.
function toolAnnotations(name: string, explicit?: ToolAnnotations): ToolAnnotations {
  const read = name.startsWith("list_") || name.startsWith("get_");
  const del = name.startsWith("delete_");
  const update = name.startsWith("update_");
  return {
    title: humanTitle(name),
    readOnlyHint: read,
    destructiveHint: del,
    idempotentHint: read || update || del,
    // Everything here writes to this organization's own private books. The one
    // tool that reaches a third-party system (Google Calendar) overrides this.
    openWorldHint: false,
    ...OPENWORLD_OVERRIDES[name],
    ...DESTRUCTIVE_OVERRIDES[name],
    ...explicit,
  };
}

// Reaches outside our own database, so it cannot claim a closed world.
const OPENWORLD_OVERRIDES: Record<string, Partial<ToolAnnotations>> = {
  sync_billing_calendar: { openWorldHint: true },
};

// Writes that are irreversible from MCP even though the verb isn't "delete".
const DESTRUCTIVE_OVERRIDES: Record<string, Partial<ToolAnnotations>> = {
  // Records the payslip AND posts the salary expense; the month can't be re-paid
  // and there is no "unpay" tool.
  pay_employee_salary: { destructiveHint: true },
};

// Human-readable tool titles (MCP `BaseMetadata.title`; required for the OpenAI
// plugin directory). Derived from the tool name so new tools get one for free —
// the table only covers names that don't read well when de-snake-cased.
//
// NOTE: titles are derived here on purpose. Do not push them down into
// src/lib/mcp/tools-*.ts.
const TITLE_OVERRIDES: Record<string, string> = {
  bulk_create_transactions: "Create transactions in bulk",
  create_reimbursement: "Reimburse an advance",
  get_financial_overview: "Financial overview",
  get_subscription_schedule: "Subscription schedule",
  list_accountant_notices: "Notices for the accountant",
  list_billing_status: "Billing board",
  list_org_members: "List organization members",
  list_outstanding_advances: "Outstanding advances",
  list_payroll_runs: "Payroll runs",
  list_salary_status: "Salary status by month",
  list_upcoming_billing: "Upcoming billing",
  mark_accountant_notified: "Mark as sent to the accountant",
  pay_employee_salary: "Pay an employee's salary",
  sync_billing_calendar: "Sync the billing calendar",
  unmark_accountant_notified: "Unmark as sent to the accountant",
};

function humanTitle(name: string): string {
  const override = TITLE_OVERRIDES[name];
  if (override) return override;
  const words = name.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function categoryTag(a: ToolAnnotations): string {
  if (a.readOnlyHint) return "[read]";
  if (a.destructiveHint) return "[delete]";
  return "[write]";
}

/** Some tool descriptions already start with their own `[write]` / `[delete]`
 *  tag. Strip it so we never emit `[write] [write] …`. */
function stripCategoryTag(description: string): string {
  return description.replace(/^\s*\[(read|write|delete)\]\s*/i, "");
}

function clamp64(s: string): string {
  return s.length <= 64 ? s : `${s.slice(0, 63)}…`;
}

// Every tool touches org-private data, so every tool requires an OAuth token.
// ChatGPT only shows its account-linking UI when a tool declares this.
const SECURITY_SCHEMES = [{ type: "oauth2", scopes: MCP_SCOPES }];

function describeTool(name: string, t: ToolDef) {
  const annotations = toolAnnotations(name, t.annotations);
  const title = annotations.title ?? humanTitle(name);
  return {
    name,
    title,
    description: `${categoryTag(annotations)} ${stripCategoryTag(t.description)}`,
    inputSchema: t.inputSchema,
    ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
    annotations,
    securitySchemes: SECURITY_SCHEMES,
    _meta: {
      // Back-compat mirror for clients that only read `_meta`.
      securitySchemes: SECURITY_SCHEMES,
      // Status line ChatGPT shows while the call is in flight (≤ 64 chars).
      "openai/toolInvocation/invoking": clamp64(`${title}…`),
      "openai/toolInvocation/invoked": clamp64(`${title} — done`),
    },
  };
}

// ---------------------------------------------------------------------------
// Method handlers
// ---------------------------------------------------------------------------

async function handleToolCall(
  id: JsonRpcId,
  params: Record<string, unknown> | undefined,
  ctx: ToolContext,
): Promise<object> {
  const name = params?.name as string | undefined;
  const args = (params?.arguments as Record<string, unknown>) ?? {};
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
    // A declared outputSchema is a promise that `structuredContent` matches it,
    // so only emit it for tools that opted in with an object-shaped schema. The
    // JSON text block stays either way (MCP's recommended back-compat shape).
    const structured =
      tool.outputSchema && out && typeof out === "object" && !Array.isArray(out)
        ? { structuredContent: out as Record<string, unknown> }
        : {};
    return ok(id, {
      ...structured,
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

async function handleMessage(
  msg: JsonRpcMessage,
  ctx: ToolContext,
): Promise<object | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined || msg.id === null;

  switch (msg.method) {
    case "initialize": {
      // Version negotiation: echo the client's revision when we speak it,
      // otherwise answer with our newest and let the client decide.
      const requested = msg.params?.protocolVersion;
      const protocolVersion =
        typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION;
      return ok(id, {
        protocolVersion,
        // Stateless server: the tool list never changes mid-session, and we
        // expose no resources, prompts, logging or completions.
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "notifications/initialized":
    case "notifications/cancelled":
      return null;

    case "ping":
      return ok(id, {});

    case "tools/list":
      return ok(id, {
        tools: Object.entries(tools).map(([name, t]) => describeTool(name, t)),
      });

    case "tools/call":
      return handleToolCall(id, msg.params, ctx);

    default:
      if (isNotification) return null;
      return fail(id, -32601, `Method not found: ${msg.method}`);
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function handleMcpRequest(
  req: Request,
  session: { userId: string },
): Promise<Response> {
  const cors = corsHeaders(req);

  // MCP spec (Streamable HTTP): validate Origin to block DNS-rebinding.
  if (!isAllowedOrigin(req.headers.get("origin"))) {
    return Response.json(fail(null, -32600, "Origin not allowed"), {
      status: 403,
      headers: cors,
    });
  }

  // MCP spec: an unsupported MCP-Protocol-Version MUST be rejected with 400.
  const declaredVersion = req.headers.get("mcp-protocol-version");
  if (declaredVersion && !SUPPORTED_PROTOCOL_VERSIONS.includes(declaredVersion)) {
    return Response.json(
      fail(
        null,
        -32600,
        `Unsupported MCP-Protocol-Version: ${declaredVersion}. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(", ")}.`,
      ),
      { status: 400, headers: cors },
    );
  }

  // Defence in depth: the route already 401s unauthenticated requests, but if a
  // caller ever reaches here without an identity, answer with the tool-level
  // challenge shape OpenAI uses to trigger its account-linking UI.
  if (!session?.userId) {
    return Response.json(
      ok(null, {
        content: [
          { type: "text", text: "Authentication required: no access token provided." },
        ],
        _meta: { "mcp/www_authenticate": [mcpWwwAuthenticate("invalid_token", "Sign in to continue.")] },
        isError: true,
      }),
      { status: 401, headers: { ...cors, "WWW-Authenticate": mcpWwwAuthenticate() } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json(fail(null, -32700, "Parse error"), { status: 400, headers: cors });
  }

  // Optional per-connection org pin: /mcp?org=<id-or-slug>. Lets a
  // multi-org user run one connection per org. Validated in resolveOrgId.
  const orgHint = new URL(req.url).searchParams.get("org") ?? undefined;
  const ctx: ToolContext = { userId: session.userId, orgHint };

  if (Array.isArray(body)) {
    const responses = (
      await Promise.all(body.map((m) => handleMessage(m as JsonRpcMessage, ctx)))
    ).filter((r): r is object => r !== null);
    if (responses.length === 0) return new Response(null, { status: 202, headers: cors });
    return Response.json(responses, { headers: cors });
  }

  const res = await handleMessage(body as JsonRpcMessage, ctx);
  if (!res) return new Response(null, { status: 202, headers: cors });
  return Response.json(res, { headers: cors });
}
