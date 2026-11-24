// GET /api/v1/openapi.json — OpenAPI 3.1 for the REST API, generated from the
// MCP tool registry. Public: it only describes the schemas (no org data).
import { buildOpenApi } from "@/lib/api/rest";

export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json(buildOpenApi(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
