// OAuth 2.0 Authorization Server Metadata (RFC 8414). MCP clients fetch this to
// discover the authorize/token/register endpoints. Proxies to the better-auth
// `mcp` plugin's metadata so the URLs always match the live config.
import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "@/lib/auth";

export const GET = oAuthDiscoveryMetadata(auth);
