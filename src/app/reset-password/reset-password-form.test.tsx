import { describe, expect, mock, test } from "bun:test";
import { serverRenderedForms } from "@/__tests__/server-rendered-forms";

// 跟登入頁同一個回歸測試（pathors/pathors#3281）：hydration 前送出新密碼不能
// 變成 GET，否則密碼會出現在網址與伺服器 log 裡。
mock.module("@/lib/auth-client", () => ({
  authClient: { signIn: { sso: async () => ({}) } },
  signIn: { email: async () => ({}), social: async () => ({}) },
}));

const { ResetPasswordForm } = await import("./reset-password-form");

describe("reset password form before hydration", () => {
  test("with a token: one posting form, password + confirm, submit disabled", async () => {
    expect(await serverRenderedForms(<ResetPasswordForm token="tok_123" />)).toEqual([
      { method: "post", fields: ["password", "confirm"], submitButtons: [{ disabled: true }] },
    ]);
  });

  test("without a token there is no form at all, only the expired-link state", async () => {
    expect(await serverRenderedForms(<ResetPasswordForm token={null} />)).toEqual([]);
  });
});
