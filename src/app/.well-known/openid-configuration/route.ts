// 平台 OIDC issuer 的 discovery 文件：只宣告 issuer 與 jwks_uri（外部雲端驗本組織 JWT 用，
// 見 src/lib/oidc.ts）。這不是登入用的 OpenID Provider —— 登入與 MCP OAuth 走
// /.well-known/oauth-authorization-server（better-auth）。公開、可快取。
import { oidcIssuer } from "@/lib/oidc";
import { DISCOVERY_CORS, discoveryPreflight } from "../metadata";

export function GET(): Response {
  const issuer = oidcIssuer();
  return Response.json(
    {
      issuer,
      jwks_uri: `${issuer}/.well-known/jwks.json`,
      response_types_supported: ["id_token"],
      subject_types_supported: ["public"],
      id_token_signing_alg_values_supported: ["RS256"],
      claims_supported: ["iss", "sub", "aud", "iat", "exp"],
    },
    { headers: { ...DISCOVERY_CORS, "Cache-Control": "public, max-age=3600" } },
  );
}

export const OPTIONS = discoveryPreflight;
