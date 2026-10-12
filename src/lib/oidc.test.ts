import { describe, expect, test } from "bun:test";
import { ASSERTION_TTL_SECONDS, buildOrgAssertionClaims, parsePkcs8, publicJwk, signOrgAssertion } from "./oidc";

async function keyMaterial() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return { pair, der, b64, pem: `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----` };
}

const decode = (p: string) => JSON.parse(atob(p.replaceAll("-", "+").replaceAll("_", "/") + "==".slice(0, (4 - (p.length % 4)) % 4)));

describe("signing key parsing", () => {
  test("bare one-line base64 and full PEM give the same DER", async () => {
    const { der, b64, pem } = await keyMaterial();
    expect(new Uint8Array(parsePkcs8(b64))).toEqual(der);
    expect(new Uint8Array(parsePkcs8(pem))).toEqual(der);
    expect(new Uint8Array(parsePkcs8(pem.replaceAll("\n", "\\n")))).toEqual(der);
  });

  test("missing / PKCS#1 / garbage keys fail clearly", () => {
    expect(() => parsePkcs8(undefined)).toThrow(/OIDC_SIGNING_KEY/);
    expect(() => parsePkcs8("-----BEGIN RSA PRIVATE KEY-----\nAAA\n-----END RSA PRIVATE KEY-----")).toThrow(/PKCS#8/);
    expect(() => parsePkcs8("not base64 !!")).toThrow();
  });
});

describe("org assertion", () => {
  test("claims: sub is the org id passed in, short-lived", () => {
    expect(buildOrgAssertionClaims("org_pathors", { issuer: "https://internal.pathors.com", audience: "internal-billing", nowSec: 100 })).toEqual({
      iss: "https://internal.pathors.com",
      sub: "org_pathors",
      aud: "internal-billing",
      iat: 100,
      exp: 100 + ASSERTION_TTL_SECONDS,
    });
    expect(() => buildOrgAssertionClaims("", { issuer: "i", audience: "a", nowSec: 1 })).toThrow();
  });

  test("signed JWT verifies with the published JWK and carries kid / defaults", async () => {
    const { b64 } = await keyMaterial();
    const env = { OIDC_SIGNING_KEY: b64 };
    const jwt = await signOrgAssertion("org_pathors", { env, nowSec: 1_760_000_000 });
    const [h, c, s] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT", kid: "internal-2026-10b" });
    expect(decode(c)).toMatchObject({ iss: "https://internal.pathors.com", sub: "org_pathors", aud: "internal-billing" });
    const jwk = await publicJwk(env);
    expect(Object.keys(jwk).sort()).toEqual(["alg", "e", "kid", "kty", "n", "use"]);
    const pub = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const sig = Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/") + "==".slice(0, (4 - (s.length % 4)) % 4)), (x) => x.charCodeAt(0)).buffer as ArrayBuffer;
    expect(await crypto.subtle.verify("RSASSA-PKCS1-v1_5", pub, sig, new TextEncoder().encode(`${h}.${c}`))).toBe(true);
  });

  test("custom kid / issuer from env", async () => {
    const { b64 } = await keyMaterial();
    const jwt = await signOrgAssertion("org_x", { env: { OIDC_SIGNING_KEY: b64, OIDC_SIGNING_KID: "k2", OIDC_ISSUER: "https://x.test/" } });
    const [h, c] = jwt.split(".");
    expect(decode(h).kid).toBe("k2");
    expect(decode(c).iss).toBe("https://x.test");
  });
});
