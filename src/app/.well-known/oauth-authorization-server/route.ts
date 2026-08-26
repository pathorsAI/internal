// OAuth 2.0 Authorization Server Metadata (RFC 8414). MCP clients fetch this to
// discover the authorize/token/register endpoints. Proxies to the better-auth
// `mcp` plugin's metadata so the URLs always match the live config.
//
// The plugin already advertises what OpenAI requires of an authorization
// server: `code_challenge_methods_supported: ["S256"]` (PKCE — ChatGPT refuses
// servers without it), `registration_endpoint` (RFC 7591 dynamic client
// registration, which is how ChatGPT gets a client_id here since better-auth
// does not implement Client ID Metadata Documents), `token_endpoint_auth_
// methods_supported`, and a `userinfo_endpoint` returning `email` /
// `email_verified` (needed for ChatGPT Enterprise workspace domain rules).
import { oAuthDiscoveryMetadata } from "better-auth/plugins";
import { auth } from "@/lib/auth";
import { discoveryPreflight } from "../metadata";

export const GET = oAuthDiscoveryMetadata(auth);
export const OPTIONS = discoveryPreflight;
