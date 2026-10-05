import { describe, expect, mock, test } from "bun:test";
import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { messages } from "@/i18n/messages";

// pathors/pathors#3281 的回歸測試：hydration 前的送出是瀏覽器原生送出。表單必須
// 是 POST，帳密才不會進網址；唯一的 submit 鈕在伺服器 HTML 裡必須是 disabled，
// 原生送出這條路才走不到。

// mock.module 是整個 test process 共用的，所以保留 next/navigation 其餘的 export。
const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({ ...navigation, useSearchParams: () => new URLSearchParams() }));
mock.module("@/lib/auth-client", () => ({
  authClient: { signIn: { sso: async () => ({}) } },
  signIn: { email: async () => ({}), social: async () => ({}) },
}));

const { default: LoginPage } = await import("./page");

type FormMarkup = { method: string | null; fields: string[]; submitButtons: { disabled: boolean }[] };

async function serverRenderedForms(): Promise<FormMarkup[]> {
  const html = renderToString(
    <NextIntlClientProvider locale="zh-TW" messages={messages["zh-TW"]}>
      <LoginPage />
    </NextIntlClientProvider>,
  );
  const forms: FormMarkup[] = [];
  const current = () => forms.at(-1);
  await new HTMLRewriter()
    .on("form", {
      element(el) {
        forms.push({ method: el.getAttribute("method"), fields: [], submitButtons: [] });
      },
    })
    .on("form input[name]", {
      element(el) {
        current()?.fields.push(el.getAttribute("name") ?? "");
      },
    })
    .on("form button", {
      element(el) {
        if ((el.getAttribute("type") ?? "submit") === "submit") {
          current()?.submitButtons.push({ disabled: el.hasAttribute("disabled") });
        }
      },
    })
    .transform(new Response(html))
    .text();
  return forms;
}

describe("login page before hydration", () => {
  test("opens on the email step: one posting form, email only, submit disabled", async () => {
    expect(await serverRenderedForms()).toEqual([
      { method: "post", fields: ["email"], submitButtons: [{ disabled: true }] },
    ]);
  });
});
