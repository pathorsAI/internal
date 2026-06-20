// OAuth 2.0 Protected Resource Metadata (RFC 9728). Tells MCP clients which
// authorization server protects the /mcp resource. The 401 from /mcp
// points here via its WWW-Authenticate header.
import { oAuthProtectedResourceMetadata } from "better-auth/plugins";
import { auth } from "@/lib/auth";

export const GET = oAuthProtectedResourceMetadata(auth);
