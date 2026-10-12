import { NextIntlClientProvider } from "next-intl";
import { renderToString } from "react-dom/server";
import { messages } from "@/i18n/messages";

/**
 * 伺服器 render 出來的 HTML 裡，每個 <form> 的 method、有 name 的 input、以及
 * submit 鈕是否 disabled。
 *
 * 用來守 pathors/pathors#3281：hydration 前的送出是瀏覽器原生送出。表單必須是
 * POST，帳密才不會進網址；submit 鈕在伺服器 HTML 裡必須是 disabled，原生送出這條
 * 路才走不到。登入、註冊、重設密碼的測試共用這一份。
 */
export type FormMarkup = { method: string | null; fields: string[]; submitButtons: { disabled: boolean }[] };

/**
 * 在 zh-TW 語系下做伺服器 render。timeZone 明給只是為了安靜：沒給的話 next-intl
 * 第一次在伺服器端格式化訊息時會往 console 丟一個 ENVIRONMENT_FALLBACK 錯誤物件，
 * 看起來像測試壞了。這幾個表單的字串都沒有日期，給哪個時區結果都一樣。
 */
export function serverRenderedHtml(element: React.ReactElement): string {
  return renderToString(
    <NextIntlClientProvider locale="zh-TW" messages={messages["zh-TW"]} timeZone="Asia/Taipei">
      {element}
    </NextIntlClientProvider>,
  );
}

export async function serverRenderedForms(element: React.ReactElement): Promise<FormMarkup[]> {
  const html = serverRenderedHtml(element);
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
