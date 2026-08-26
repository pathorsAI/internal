// OAuth 2.0 Protected Resource Metadata (RFC 9728) — path-inserted form for the
// resource `<BASE_URL>/mcp`.
//
// The MCP authorization spec requires clients to build the metadata URL by
// inserting the resource's path *after* `/.well-known/oauth-protected-resource`,
// so this — not the root document — is the URL our 401 `WWW-Authenticate`
// challenge advertises, and the one ChatGPT will fetch.
import { discoveryPreflight, protectedResourceMetadata } from "../../metadata";

export const GET = protectedResourceMetadata;
export const OPTIONS = discoveryPreflight;
