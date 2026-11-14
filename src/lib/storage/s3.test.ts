import { describe, expect, test } from "bun:test";
import { s3Driver, s3ObjectUrl, type S3Config } from "./s3";

const BASE: S3Config = {
  endpoint: "http://minio:9000",
  region: "us-east-1",
  bucket: "documents",
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "secret",
  forcePathStyle: true,
};

/** 假的 fetch：記下簽好的 request，回傳指定的 response。 */
function mockFetch(respond: (req: Request) => Response) {
  const calls: Request[] = [];
  const fn = (async (input: RequestInfo | URL) => {
    const req = input as Request;
    calls.push(req);
    return respond(req);
  }) as typeof fetch;
  return { fn, calls };
}

describe("s3ObjectUrl", () => {
  test("path style keeps the bucket in the path", () => {
    expect(s3ObjectUrl(BASE, "transactions/1/a b.pdf")).toBe("http://minio:9000/documents/transactions/1/a%20b.pdf");
  });

  test("virtual-host style moves the bucket into the hostname", () => {
    expect(
      s3ObjectUrl({ ...BASE, endpoint: "https://s3.eu-west-1.amazonaws.com", forcePathStyle: false }, "orgs/o/p.webp"),
    ).toBe("https://documents.s3.eu-west-1.amazonaws.com/orgs/o/p.webp");
  });

  test("endpoint with a base path and trailing slash", () => {
    expect(s3ObjectUrl({ ...BASE, endpoint: "https://gw.example.com/s3/" }, "k")).toBe("https://gw.example.com/s3/documents/k");
  });
});

describe("s3Driver signed requests", () => {
  test("PUT is SigV4-signed with content type and unsigned payload", async () => {
    const { fn, calls } = mockFetch(() => new Response(null, { status: 200, headers: { ETag: '"abc"' } }));
    const ok = await s3Driver(BASE, fn).put("transactions/1/x.pdf", new Uint8Array([1, 2, 3]), { contentType: "application/pdf" });
    expect(ok).toBe(true);
    const req = calls[0];
    expect(req.method).toBe("PUT");
    expect(req.url).toBe("http://minio:9000/documents/transactions/1/x.pdf");
    expect(req.headers.get("content-type")).toBe("application/pdf");
    expect(req.headers.get("x-amz-content-sha256")).toBe("UNSIGNED-PAYLOAD");
    expect(req.headers.get("x-amz-date")).toMatch(/^\d{8}T\d{6}Z$/);
    const auth = req.headers.get("authorization") ?? "";
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/us-east-1\/s3\/aws4_request, /);
    expect(auth).toContain("SignedHeaders=");
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/);
    expect(req.headers.has("if-match")).toBe(false);
  });

  test("virtual-host style request goes to bucket.host", async () => {
    const { fn, calls } = mockFetch(() => new Response(null, { status: 204 }));
    await s3Driver({ ...BASE, endpoint: "https://s3.ap-southeast-1.amazonaws.com", region: "ap-southeast-1", forcePathStyle: false }, fn).delete(
      "a/b",
    );
    expect(calls[0].method).toBe("DELETE");
    expect(calls[0].url).toBe("https://documents.s3.ap-southeast-1.amazonaws.com/a/b");
    expect(calls[0].headers.get("authorization")).toContain("/ap-southeast-1/s3/aws4_request");
  });

  test("conditional PUT sends If-Match and maps 412 to false", async () => {
    const { fn, calls } = mockFetch(() => new Response("<Error><Code>PreconditionFailed</Code></Error>", { status: 412 }));
    const ok = await s3Driver(BASE, fn).put("simpany-tax/s.json", new Uint8Array([1]), {
      contentType: "application/json",
      onlyIfEtag: '"etag-1"',
    });
    expect(ok).toBe(false);
    expect(calls[0].headers.get("if-match")).toBe('"etag-1"');
  });

  test("GET returns body, content type and the raw ETag; 404 → null", async () => {
    const { fn } = mockFetch((req) =>
      req.url.endsWith("/missing")
        ? new Response("<Error/>", { status: 404 })
        : new Response("hello", { status: 200, headers: { "Content-Type": "text/plain", ETag: '"e1"' } }),
    );
    const d = s3Driver(BASE, fn);
    const obj = await d.get("present");
    expect(obj?.contentType).toBe("text/plain");
    expect(obj?.etag).toBe('"e1"');
    expect(await new Response(obj!.body).text()).toBe("hello");
    expect(await d.get("missing")).toBeNull();
  });

  test("DELETE of a missing key is ok; other errors throw with status", async () => {
    expect(await s3Driver(BASE, mockFetch(() => new Response(null, { status: 404 })).fn).delete("gone")).toBeUndefined();
    await expect(
      s3Driver(BASE, mockFetch(() => new Response("<Code>AccessDenied</Code>", { status: 403 })).fn).put("k", new Uint8Array(), {
        contentType: "text/plain",
      }),
    ).rejects.toThrow(/HTTP 403 .*AccessDenied/);
  });
});
