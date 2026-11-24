import { extractApiKey, verifyApiKey } from "@/lib/api-keys";
import { hitApiRateLimit } from "@/lib/api-rate-limit";
import { publicBaseUrl } from "@/lib/base-url";
import { describeTool, isReadOnlyTool, SERVER_VERSION, toolNamesFor } from "@/lib/mcp/handler";
import type { ToolContext } from "@/lib/mcp/shared";
import { tools } from "@/lib/mcp/tools";

/**
 * REST API（/api/v1）。沒有自己的 handler：端點直接由 MCP 工具註冊表（src/lib/mcp/tools.ts）
 * 產生，呼叫走同一支 runToolWithAudit（權限、組織、操作紀錄都跟 MCP 一樣）。
 *
 *   GET  /api/v1/tools              這把金鑰能用的工具與 JSON schema
 *   POST /api/v1/tools/<name>       body = 工具的 input JSON；200 → { result }，失敗 → { error }
 *   GET  /api/v1/openapi.json       OpenAPI 3.1（公開，不需金鑰）
 *
 * 驗證只認組織 API key（Authorization: Bearer pik_… 或 X-API-Key）。速率限制以金鑰為單位
 * （src/lib/api-rate-limit.ts）。
 */

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "rate_limited"
  | "tool_error";

const STATUS: Record<ApiErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  bad_request: 400,
  rate_limited: 429,
  tool_error: 400,
};

export function apiError(code: ApiErrorCode, message: string, headers: Record<string, string> = {}): Response {
  return Response.json(
    { error: { code, message } },
    {
      status: STATUS[code],
      headers: {
        ...headers,
        "Cache-Control": "no-store",
        ...(code === "unauthorized" ? { "WWW-Authenticate": 'Bearer realm="api", error="invalid_token"' } : {}),
      },
    },
  );
}

export function apiJson(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

/**
 * 驗 API key + 速率限制。成功回 ToolContext（userId = 金鑰建立者、apiKey = 金鑰本身），
 * 失敗回現成的錯誤 Response。MCP route 也用這支（Bearer 是 API key 時）。
 */
export async function authenticateApiKey(
  req: Request,
): Promise<{ ok: true; ctx: ToolContext & { apiKey: NonNullable<ToolContext["apiKey"]> }; headers: Record<string, string> } | { ok: false; status: 401 | 429; message: string; headers: Record<string, string> }> {
  const raw = extractApiKey(req);
  if (!raw) {
    return {
      ok: false,
      status: 401,
      message: "Missing API key. Send `Authorization: Bearer pik_…` (create one under 設定 › API).",
      headers: {},
    };
  }
  const key = await verifyApiKey(raw);
  if (!key) return { ok: false, status: 401, message: "Invalid, expired or revoked API key.", headers: {} };
  const limit = await hitApiRateLimit(key.id);
  if (!limit.ok) {
    return {
      ok: false,
      status: 429,
      message: `Rate limit exceeded for this API key. Retry in ${limit.retryAfterSeconds}s.`,
      headers: { "Retry-After": String(limit.retryAfterSeconds) },
    };
  }
  return {
    ok: true,
    ctx: {
      userId: key.userId,
      apiKey: { id: key.id, name: key.name, organizationId: key.organizationId, scope: key.scope },
    },
    headers: { "X-RateLimit-Remaining": String(limit.remaining) },
  };
}

/** GET /api/v1/tools 的一筆。 */
export function restToolEntry(name: string) {
  const d = describeTool(name, tools[name]);
  return {
    name,
    title: d.title,
    description: d.description,
    readOnly: isReadOnlyTool(name),
    destructive: Boolean(d.annotations.destructiveHint),
    method: "POST",
    path: `/api/v1/tools/${name}`,
    inputSchema: d.inputSchema,
    outputSchema: d.outputSchema ?? null,
  };
}

/** 給這個 context 看的工具清單（唯讀金鑰只看得到 [read] 工具）。 */
export function restToolList(ctx: ToolContext) {
  return toolNamesFor(ctx).map(restToolEntry);
}

const ERROR_SCHEMA = {
  type: "object",
  properties: {
    error: {
      type: "object",
      properties: {
        code: { type: "string", enum: ["unauthorized", "forbidden", "not_found", "bad_request", "rate_limited", "tool_error"] },
        message: { type: "string" },
      },
      required: ["code", "message"],
    },
  },
  required: ["error"],
};

/** OpenAPI 3.1：每支工具一個 POST 端點，schema 直接取自工具註冊表。 */
export function buildOpenApi(baseUrl = publicBaseUrl()) {
  const paths: Record<string, unknown> = {
    "/api/v1/tools": {
      get: {
        operationId: "listTools",
        summary: "List the tools this API key may call, with their JSON schemas.",
        responses: {
          "200": {
            description: "Tools available to this key (a read-only key only sees [read] tools).",
            content: { "application/json": { schema: { type: "object", properties: { tools: { type: "array" } } } } },
          },
          "401": { $ref: "#/components/responses/Unauthorized" },
        },
      },
    },
  };
  for (const name of Object.keys(tools)) {
    const d = describeTool(name, tools[name]);
    paths[`/api/v1/tools/${name}`] = {
      post: {
        operationId: name,
        summary: d.title,
        description: `${d.description}${isReadOnlyTool(name) ? "" : "\n\nRequires a read-write API key."}`,
        tags: [isReadOnlyTool(name) ? "read" : d.annotations.destructiveHint ? "delete" : "write"],
        requestBody: {
          required: false,
          content: { "application/json": { schema: d.inputSchema } },
        },
        responses: {
          "200": {
            description: "Tool result.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { result: d.outputSchema ?? {} },
                  required: ["result"],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/ToolError" },
          "401": { $ref: "#/components/responses/Unauthorized" },
          "403": { $ref: "#/components/responses/Forbidden" },
          "429": { $ref: "#/components/responses/RateLimited" },
        },
      },
    };
  }
  const errorResponse = (description: string) => ({
    description,
    content: { "application/json": { schema: ERROR_SCHEMA } },
  });
  return {
    openapi: "3.1.0",
    info: {
      title: "Pathors Internal API",
      version: SERVER_VERSION,
      description:
        "Every endpoint is one MCP tool of this server (same registry, same permissions, same audit log). Authenticate with an organization API key: `Authorization: Bearer pik_…`. A read-only key can call [read] tools only. Credentials (passwords, tokens, keys) are never accepted or returned — connecting an integration that needs one is web-only.",
    },
    servers: [{ url: baseUrl }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: {
        apiKey: { type: "http", scheme: "bearer", bearerFormat: "pik_…", description: "Organization API key from 設定 › API." },
      },
      responses: {
        Unauthorized: errorResponse("Missing, invalid, expired or revoked API key."),
        Forbidden: errorResponse("The key may not call this tool (read-only key, or an account-level tool)."),
        RateLimited: errorResponse("Too many requests for this key; see Retry-After."),
        ToolError: errorResponse("The tool rejected the input or failed (message explains why)."),
      },
    },
    paths,
  };
}
