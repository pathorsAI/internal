import { describe, expect, test } from "bun:test";
import { resolveSender } from "./email";

describe("resolveSender", () => {
  test("uses RESEND_FROM when set", () => {
    expect(resolveSender({ NODE_ENV: "production", RESEND_FROM: " Acme <noreply@acme.test> " })).toBe(
      "Acme <noreply@acme.test>",
    );
  });

  test("production without RESEND_FROM refuses instead of falling back to a hardcoded domain", () => {
    expect(() => resolveSender({ NODE_ENV: "production", NEXT_PUBLIC_APP_NAME: "Acme" })).toThrow("RESEND_FROM");
  });

  test("dev default uses the app name and a non-routable address", () => {
    expect(resolveSender({ NODE_ENV: "development", NEXT_PUBLIC_APP_NAME: "Acme Books" })).toBe(
      "Acme Books <noreply@localhost>",
    );
    expect(resolveSender({})).toBe("Internal <noreply@localhost>");
  });
});
