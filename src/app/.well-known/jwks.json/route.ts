// 平台 OIDC 簽章金鑰的公鑰（JWKS）。GCP Workload Identity Federation 驗本組織 JWT 用
// （目前 GCP 用的是上傳的 JWKS；這裡是給之後輪替金鑰時改成直接抓的）。公開、可快取。
// 私鑰只在 OIDC_SIGNING_KEY（Worker secret）；這裡只輸出 kty / n / e / kid。見 src/lib/oidc.ts。
import { OidcConfigError, publicJwk } from "@/lib/oidc";
import { DISCOVERY_CORS, discoveryPreflight } from "../metadata";

export async function GET(): Promise<Response> {
  try {
    const key = await publicJwk();
    return Response.json(
      { keys: [key] },
      { headers: { ...DISCOVERY_CORS, "Cache-Control": "public, max-age=3600" } },
    );
  } catch (e) {
    // 沒設金鑰：回空的 key set，而不是 500 —— 不洩漏任何設定細節
    if (e instanceof OidcConfigError) {
      return Response.json({ keys: [] }, { headers: { ...DISCOVERY_CORS, "Cache-Control": "no-store" } });
    }
    throw e;
  }
}

export const OPTIONS = discoveryPreflight;
