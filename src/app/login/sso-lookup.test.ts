import { describe, expect, test } from "bun:test";
import { afterSsoLookup } from "./sso-lookup";

describe("afterSsoLookup", () => {
  test("a successful lookup stays put while the plugin navigates to the IdP", () => {
    expect(afterSsoLookup(null)).toEqual({ step: "redirecting" });
  });

  test("404 (no provider for the domain) goes to the password step without a note", () => {
    expect(afterSsoLookup({ status: 404 })).toEqual({ step: "password", note: null });
  });

  test("a server error still reaches the password step, with a note", () => {
    expect(afterSsoLookup({ status: 500 })).toEqual({ step: "password", note: "ssoUnavailable" });
  });

  test("rate limiting still reaches the password step, with a note", () => {
    expect(afterSsoLookup({ status: 429 })).toEqual({ step: "password", note: "ssoUnavailable" });
  });

  test("a network error (no status) still reaches the password step, with a note", () => {
    expect(afterSsoLookup({})).toEqual({ step: "password", note: "ssoUnavailable" });
  });
});
