import { describe, expect, test } from "bun:test";
import { loginNotice } from "./login-notice";

describe("loginNotice", () => {
  test("SSO block from the Google callback", () => {
    expect(loginNotice(new URLSearchParams("error=SSO_REQUIRED"))).toBe("ssoRequired");
  });

  test("expired or used magic link", () => {
    expect(loginNotice(new URLSearchParams("error=INVALID_TOKEN"))).toBe("linkInvalid");
  });

  test("any other error code gets the generic message", () => {
    expect(loginNotice(new URLSearchParams("error=access_denied"))).toBe("failed");
  });

  test("password reset success", () => {
    expect(loginNotice(new URLSearchParams("notice=password-updated"))).toBe("passwordUpdated");
  });

  test("nothing on a plain visit", () => {
    expect(loginNotice(new URLSearchParams("redirect=%2Fdashboard"))).toBeNull();
  });
});
