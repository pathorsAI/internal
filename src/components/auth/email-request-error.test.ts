import { describe, expect, test } from "bun:test";
import { emailRequestError } from "./email-request-error";

describe("emailRequestError", () => {
  test("no error", () => {
    expect(emailRequestError(null)).toBeNull();
  });

  test("rate limited", () => {
    expect(emailRequestError({ status: 429 })).toBe("rateLimited");
  });

  test("SSO domain", () => {
    expect(emailRequestError({ status: 403, code: "SSO_REQUIRED" })).toBe("ssoRequired");
  });

  test("any other failure looks like success, so it can't reveal whether the account exists", () => {
    expect(emailRequestError({ status: 403, code: "INVALID_CALLBACK_URL" })).toBeNull();
    expect(emailRequestError({ status: 500 })).toBeNull();
  });
});
