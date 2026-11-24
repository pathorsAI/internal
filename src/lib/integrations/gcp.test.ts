import { describe, expect, test } from "bun:test";
import {
  assertGcpReadOnly,
  buildServiceAccountJwt,
  fetchGcpToken,
  GcpBindingMissingError,
  buildCostQuery,
  monthlyInvoicesFromCosts,
  parseCostRows,
  parseGcpBillingAccount,
  parseServiceAccountJson,
  parseWifAudience,
  promotionMonthsFromCosts,
  workloadIdentityBindingCommand,
} from "./gcp";

async function testKeyPair() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer);
  let bin = "";
  for (const b of der) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64.match(/.{1,64}/g)?.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return { pair, pem, b64 };
}

function decode(part: string) {
  const b64 = part.replaceAll("-", "+").replaceAll("_", "/");
  return JSON.parse(atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4)));
}

function b64urlToBytes(part: string): ArrayBuffer {
  const b64 = part.replaceAll("-", "+").replaceAll("_", "/");
  const bin = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
}

describe("service account JWT (WebCrypto, no SDK)", () => {
  test("builds a verifiable RS256 JWT with the expected claims", async () => {
    const { pair, pem } = await testKeyPair();
    const json = JSON.stringify({
      type: "service_account",
      client_email: "reader@internal-498514.iam.gserviceaccount.com",
      private_key: pem,
      private_key_id: "kid-1",
    });
    const key = parseServiceAccountJson(json);
    if ("error" in key) throw new Error(key.error);
    const jwt = await buildServiceAccountJwt(key, { nowSec: 1_760_000_000 });
    const [h, c, sig] = jwt.split(".");
    expect(decode(h)).toEqual({ alg: "RS256", typ: "JWT", kid: "kid-1" });
    const claims = decode(c);
    expect(claims).toMatchObject({
      iss: "reader@internal-498514.iam.gserviceaccount.com",
      aud: "https://oauth2.googleapis.com/token",
      iat: 1_760_000_000,
      exp: 1_760_003_600,
    });
    expect(claims.scope).toContain("cloud-billing.readonly");
    expect(claims.scope).toContain("bigquery.readonly");
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      pair.publicKey,
      b64urlToBytes(sig),
      new TextEncoder().encode(`${h}.${c}`),
    );
    expect(ok).toBe(true);
  });

  test("bad key JSON gives a clear error without echoing the key", () => {
    expect(parseServiceAccountJson("{not json")).toEqual({ error: expect.stringContaining("JSON") });
    expect(parseServiceAccountJson(JSON.stringify({ type: "authorized_user" }))).toEqual({
      error: expect.stringContaining("service_account"),
    });
  });
});

describe("workload identity", () => {
  const AUD = "//iam.googleapis.com/projects/36598995522/locations/global/workloadIdentityPools/internal-app/providers/internal-app-oidc";
  const SA = "internal-billing-reader@internal-498514.iam.gserviceaccount.com";

  test("audience parsing", () => {
    expect(parseWifAudience(AUD)).toEqual({ projectNumber: "36598995522", pool: "internal-app", provider: "internal-app-oidc" });
    expect(parseWifAudience("https://iam.googleapis.com/projects/1")).toBeNull();
  });

  test("binding command uses this org's subject", () => {
    expect(workloadIdentityBindingCommand(SA, AUD, "org_pathors")).toBe(
      `gcloud iam service-accounts add-iam-policy-binding ${SA} --role=roles/iam.workloadIdentityUser --member="principal://iam.googleapis.com/projects/36598995522/locations/global/workloadIdentityPools/internal-app/subject/org_pathors"`,
    );
    expect(workloadIdentityBindingCommand("not-an-sa", AUD, "org_pathors")).toBeNull();
  });

  test("token flow: JWT sub = org id, STS exchange, then impersonation; 403 → binding missing", async () => {
    const { b64 } = await testKeyPair();
    const prev = process.env.OIDC_SIGNING_KEY;
    process.env.OIDC_SIGNING_KEY = b64;
    const requests: { url: string; body: string }[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: String(init?.body ?? "") });
      if (url.startsWith("https://sts.googleapis.com/")) return Response.json({ access_token: "federated" });
      return new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED" } }), { status: 403 });
    }) as typeof fetch;
    try {
      await expect(
        fetchGcpToken({}, { authMode: "workload_identity", wifAudience: AUD, serviceAccountEmail: SA }, "org_other", fakeFetch),
      ).rejects.toBeInstanceOf(GcpBindingMissingError);
    } finally {
      process.env.OIDC_SIGNING_KEY = prev;
    }
    const sts = new URLSearchParams(requests[0].body);
    expect(sts.get("audience")).toBe(AUD);
    expect(sts.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
    expect(decode(sts.get("subject_token")!.split(".")[1]).sub).toBe("org_other");
    expect(requests[1].url).toBe(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${SA}:generateAccessToken`);
    expect(JSON.parse(requests[1].body)).toMatchObject({ lifetime: "3600s" });
  });
});

describe("billing parsing", () => {
  test("reseller sub-account", () => {
    expect(
      parseGcpBillingAccount({
        name: "billingAccounts/01CBC3-343D16-C6AE22",
        displayName: "Pathors - TWGCP(USD) - MCTW(TW)",
        masterBillingAccount: "billingAccounts/0148E6-B09FE5-9F5CAE",
        currencyCode: "USD",
        open: true,
      }),
    ).toEqual({
      id: "01CBC3-343D16-C6AE22",
      displayName: "Pathors - TWGCP(USD) - MCTW(TW)",
      masterBillingAccount: "0148E6-B09FE5-9F5CAE",
      currencyCode: "USD",
      open: true,
    });
  });

  test("monthly invoices only for closed months", () => {
    const rows = parseCostRows([
      { invoice_month: "202608", project_id: "buzz-445414", project_name: "pathors", service: "Compute Engine", currency: "TWD", gross_amount: "1000.5", promotion_credit: "0" },
      { invoice_month: "202608", project_id: "", project_name: null, service: "Support", currency: "TWD", gross_amount: "-0.5", promotion_credit: "0" },
      { invoice_month: "202610", project_id: "buzz-445414", project_name: "pathors", service: "Compute Engine", currency: "TWD", gross_amount: "80", promotion_credit: "0" },
    ]);
    expect(monthlyInvoicesFromCosts("01CBC3-343D16-C6AE22", rows, "2026-10-01")).toEqual([
      {
        externalRef: "01CBC3-343D16-C6AE22:202608",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        invoiceDate: "2026-08-31",
        amount: 1000,
        currency: "TWD",
      },
    ]);
  });
});

describe("promotion credits", () => {
  test("query splits PROMOTION credits from discounts", () => {
    const sql = buildCostQuery("buzz-445414", "billing_export", "gcp_billing_export_resource_v1_01CBC3_343D16_C6AE22");
    expect(sql).toContain("SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c WHERE IFNULL(c.type, '') <> 'PROMOTION'), 0)) AS gross_amount");
    expect(sql).toContain("SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c WHERE c.type = 'PROMOTION'), 0)) AS promotion_credit");
    expect(sql).toContain("`buzz-445414.billing_export.gcp_billing_export_resource_v1_01CBC3_343D16_C6AE22`");
  });

  test("parseCostRows keeps net = gross + promotion", () => {
    const [r] = parseCostRows([
      { invoice_month: "202610", project_id: "buzz-445414", project_name: "buzz", service: "Vertex AI", currency: "usd", gross_amount: "5682.42", promotion_credit: "-5670.32" },
    ]);
    expect(r).toEqual({
      month: "2026-10-01",
      projectId: "buzz-445414",
      projectName: "buzz",
      service: "Vertex AI",
      amount: 12.1,
      grossAmount: 5682.42,
      promotionCredit: -5670.32,
      currency: "USD",
    });
  });

  test("promotion months: closed months only, skip zero and mixed currencies", () => {
    const rows = parseCostRows([
      { invoice_month: "202608", project_id: "a", project_name: null, service: "Compute", currency: "USD", gross_amount: "700", promotion_credit: "-700.25" },
      { invoice_month: "202608", project_id: "b", project_name: null, service: "BigQuery", currency: "USD", gross_amount: "46.88", promotion_credit: "-35.3" },
      { invoice_month: "202609", project_id: "a", project_name: null, service: "Compute", currency: "USD", gross_amount: "10", promotion_credit: "0" },
      { invoice_month: "202610", project_id: "a", project_name: null, service: "Compute", currency: "USD", gross_amount: "5", promotion_credit: "-1" },
      { invoice_month: "202610", project_id: "b", project_name: null, service: "Compute", currency: "TWD", gross_amount: "5", promotion_credit: "-1" },
      { invoice_month: "202611", project_id: "a", project_name: null, service: "Compute", currency: "USD", gross_amount: "3647.64", promotion_credit: "-3639.53" },
    ]);
    expect(promotionMonthsFromCosts("01CBC3-343D16-C6AE22", rows, "2026-11-01")).toEqual([
      { billingAccountId: "01CBC3-343D16-C6AE22", month: "2026-08-01", periodEnd: "2026-08-31", amount: 735.55, currency: "USD" },
    ]);
    // 月帳單仍是淨額
    expect(monthlyInvoicesFromCosts("01CBC3-343D16-C6AE22", rows, "2026-11-01").map((i) => [i.periodStart, i.amount])).toEqual([
      ["2026-08-01", 11.33],
      ["2026-09-01", 10],
    ]);
  });
});

describe("read-only allowlist", () => {
  test("allowed", () => {
    for (const [m, u] of [
      ["GET", "https://cloudbilling.googleapis.com/v1/billingAccounts?pageSize=100"],
      ["GET", "https://cloudbilling.googleapis.com/v1/billingAccounts/01CBC3-343D16-C6AE22/projects"],
      ["GET", "https://cloudresourcemanager.googleapis.com/v1/projects/buzz-445414"],
      ["GET", "https://bigquery.googleapis.com/bigquery/v2/projects/internal-498514/datasets/billing_export/tables"],
      ["POST", "https://bigquery.googleapis.com/bigquery/v2/projects/internal-498514/queries"],
      ["POST", "https://oauth2.googleapis.com/token"],
      ["POST", "https://sts.googleapis.com/v1/token"],
      ["POST", "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/a@b.iam.gserviceaccount.com:generateAccessToken"],
    ] as const) {
      expect(() => assertGcpReadOnly(m, u)).not.toThrow();
    }
  });

  test("refused", () => {
    expect(() => assertGcpReadOnly("PUT", "https://cloudbilling.googleapis.com/v1/projects/buzz-445414/billingInfo")).toThrow();
    expect(() => assertGcpReadOnly("POST", "https://cloudbilling.googleapis.com/v1/billingAccounts")).toThrow();
    expect(() => assertGcpReadOnly("POST", "https://bigquery.googleapis.com/bigquery/v2/projects/p/jobs")).toThrow();
    expect(() => assertGcpReadOnly("POST", "https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/a@b.iam.gserviceaccount.com:signJwt")).toThrow();
  });
});
