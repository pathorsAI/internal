// OAuth 2.0 Protected Resource Metadata (RFC 9728) — root form.
//
// The canonical location for a resource that lives under a path is the
// path-inserted URL (`/.well-known/oauth-protected-resource/mcp`, see the
// sibling `mcp/route.ts`). This root document is kept for clients that skip
// path insertion and probe the origin directly; both serve the same JSON.
import { discoveryPreflight, protectedResourceMetadata } from "../metadata";

export const GET = protectedResourceMetadata;
export const OPTIONS = discoveryPreflight;
