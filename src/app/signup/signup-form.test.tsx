import { describe, expect, mock, test } from "bun:test";
import { serverRenderedForms, serverRenderedHtml } from "@/__tests__/server-rendered-forms";

// 跟登入頁同一個回歸測試（pathors/pathors#3281）：註冊表單一樣有 email，
// hydration 前按下送出不能變成 GET、把欄位送進網址。
//
// auth-client 的 mock 跟 login/page.test.tsx 同形狀：mock.module 是整個 test
// process 共用的，render 時也不會呼叫到它。
mock.module("@/lib/auth-client", () => ({
  authClient: { signIn: { sso: async () => ({}) } },
  signIn: { email: async () => ({}), social: async () => ({}) },
}));

const { SignupForm } = await import("./signup-form");

describe("signup form before hydration", () => {
  test("one posting form with email and name, submit disabled", async () => {
    expect(await serverRenderedForms(<SignupForm query="" />)).toEqual([
      { method: "post", fields: ["email", "name"], submitButtons: [{ disabled: true }] },
    ]);
  });

  test("prefills the email carried over from the login page", async () => {
    const html = serverRenderedHtml(
      <SignupForm query="email=amy%40example.com&redirect=%2Fdashboard%2Freports" />,
    );
    expect(html).toContain('value="amy@example.com"');
    // 「已經有帳號？」連回登入頁時保留 redirect，但不帶 email（登入頁用不到）。
    expect(html).toContain('href="/login?redirect=%2Fdashboard%2Freports"');
  });
});
