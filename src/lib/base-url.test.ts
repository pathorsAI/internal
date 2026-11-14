import { describe, expect, test } from "bun:test";
import { trustedOrigins } from "./base-url";

describe("trustedOrigins", () => {
  test("BETTER_AUTH_URL origin + TRUSTED_ORIGINS, no localhost in production", () => {
    expect(
      trustedOrigins({
        NODE_ENV: "production",
        BETTER_AUTH_URL: "https://app.example.com/",
        TRUSTED_ORIGINS: " https://app.example.com , https://my-app.acct.workers.dev/path ,,",
      }),
    ).toEqual(["https://app.example.com", "https://my-app.acct.workers.dev"]);
  });

  test("localhost:3000 is added outside production", () => {
    expect(trustedOrigins({ NODE_ENV: "development", BETTER_AUTH_URL: "http://localhost:3000" })).toEqual([
      "http://localhost:3000",
    ]);
    expect(trustedOrigins({})).toEqual(["http://localhost:3000"]);
  });

  test("unparseable entries are dropped, not trusted verbatim", () => {
    expect(trustedOrigins({ NODE_ENV: "production", TRUSTED_ORIGINS: "not a url,*" })).toEqual([]);
  });
});
