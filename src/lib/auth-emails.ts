import type { EmailMessage } from "@/lib/email";

/**
 * 註冊／登入連結／重設密碼這三封信的內容。
 *
 * 每封都是**同一封信裡繁中在上、英文在下**，而不是依語系挑一份：寄信的當下
 * 我們只有一個 email 地址，沒有可靠的語系可用（瀏覽器語系在 magic link 的
 * sendMagicLink 裡拿不到，而且收信的人可能根本不是按下按鈕的那個人）。
 *
 * HTML 刻意只用 inline style、單欄、沒有圖片：郵件客戶端（尤其 Outlook 與 Gmail
 * app）會剝掉 <style> 與外部資源，inline 是唯一到處都長一樣的寫法。每封都附
 * 純文字版，給只讀 text/plain 的客戶端與垃圾信過濾器。
 */

type Copy = {
  heading: string;
  body: string;
  button: string;
  expiry: string;
  fallback: string;
};

type Template = {
  subject: string;
  zh: Copy;
  en: Copy;
};

const IGNORE_LINE = {
  zh: "如果不是你本人申請，請忽略這封信。",
  en: "If you didn't request this, ignore this email.",
};

/** URL 會進 href 屬性與內文；`&` 不轉義的話，嚴格的客戶端會把 query 切壞。 */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function htmlSection(copy: Copy, url: string, ignore: string): string {
  const href = escapeHtml(url);
  return `
    <h1 style="margin:0 0 12px;font-size:20px;line-height:28px;color:#111827;">${escapeHtml(copy.heading)}</h1>
    <p style="margin:0 0 20px;font-size:15px;line-height:24px;color:#374151;">${escapeHtml(copy.body)}</p>
    <p style="margin:0 0 20px;">
      <a href="${href}" style="display:inline-block;padding:10px 20px;border-radius:6px;background:#111827;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;">${escapeHtml(copy.button)}</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#6b7280;">${escapeHtml(copy.expiry)}</p>
    <p style="margin:0 0 8px;font-size:13px;line-height:20px;color:#6b7280;">${escapeHtml(copy.fallback)}<br><a href="${href}" style="color:#2563eb;word-break:break-all;">${href}</a></p>
    <p style="margin:0;font-size:13px;line-height:20px;color:#6b7280;">${escapeHtml(ignore)}</p>`;
}

function textSection(copy: Copy, url: string, ignore: string): string {
  return [copy.heading, "", copy.body, "", `${copy.fallback}`, url, "", copy.expiry, ignore].join("\n");
}

function render(template: Template, url: string): Omit<EmailMessage, "to"> {
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang TC','Microsoft JhengHei',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:480px;margin:0 auto;padding:32px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;">
      ${htmlSection(template.zh, url, IGNORE_LINE.zh)}
      <hr style="margin:28px 0;border:none;border-top:1px solid #e5e7eb;">
      ${htmlSection(template.en, url, IGNORE_LINE.en)}
    </div>
  </body>
</html>`;
  const text = [
    textSection(template.zh, url, IGNORE_LINE.zh),
    "",
    "----",
    "",
    textSection(template.en, url, IGNORE_LINE.en),
  ].join("\n");
  return { subject: template.subject, html, text };
}

const FALLBACK = {
  zh: "如果按鈕沒有反應，把這個網址貼到瀏覽器：",
  en: "If the button doesn't work, paste this link into your browser:",
};

/** (a) 這個 email 還沒有帳號：點連結完成註冊（接著會被帶去設定密碼）。 */
export function completeSignupEmail(url: string): Omit<EmailMessage, "to"> {
  return render(
    {
      subject: "完成註冊 Pathors Internal / Complete your sign-up",
      zh: {
        heading: "完成註冊",
        body: "點下面的按鈕確認這是你的 email，接著設定一組密碼，就能開始使用 Pathors Internal。",
        button: "完成註冊",
        expiry: "這個連結 15 分鐘內有效，而且只能用一次。",
        fallback: FALLBACK.zh,
      },
      en: {
        heading: "Complete your sign-up",
        body: "Click the button below to confirm this is your email, then set a password to start using Pathors Internal.",
        button: "Complete sign-up",
        expiry: "This link is valid for 15 minutes and can be used once.",
        fallback: FALLBACK.en,
      },
    },
    url,
  );
}

/**
 * (b) 這個 email **已經有帳號**，卻有人在註冊頁填了它。
 *
 * 註冊頁對「有沒有帳號」一律回同一個畫面（不然就成了帳號探測），所以差別只能
 * 出現在信裡：告訴收件人他本來就有帳號，這個連結會直接幫他登入。
 */
export function signInLinkEmail(url: string): Omit<EmailMessage, "to"> {
  return render(
    {
      subject: "你的 Pathors Internal 登入連結 / Your sign-in link",
      zh: {
        heading: "你已經有帳號了",
        body: "有人（應該就是你）用這個 email 申請註冊，但這個 email 早就有 Pathors Internal 帳號了。不需要再註冊，點下面的按鈕就會直接登入。",
        button: "登入",
        expiry: "這個連結 15 分鐘內有效，而且只能用一次。",
        fallback: FALLBACK.zh,
      },
      en: {
        heading: "You already have an account",
        body: "Someone (probably you) tried to sign up with this email, but it already has a Pathors Internal account. There's no need to sign up again — click the button below to sign in.",
        button: "Sign in",
        expiry: "This link is valid for 15 minutes and can be used once.",
        fallback: FALLBACK.en,
      },
    },
    url,
  );
}

/** (c) 重設密碼。 */
export function resetPasswordEmail(url: string): Omit<EmailMessage, "to"> {
  return render(
    {
      subject: "重設 Pathors Internal 密碼 / Reset your password",
      zh: {
        heading: "重設密碼",
        body: "我們收到重設 Pathors Internal 密碼的申請。點下面的按鈕設定新密碼；設定完成後，所有裝置上的登入都會被登出。",
        button: "重設密碼",
        expiry: "這個連結 1 小時內有效。",
        fallback: FALLBACK.zh,
      },
      en: {
        heading: "Reset your password",
        body: "We received a request to reset your Pathors Internal password. Click the button below to choose a new one; once it's set, every signed-in device will be signed out.",
        button: "Reset password",
        expiry: "This link is valid for 1 hour.",
        fallback: FALLBACK.en,
      },
    },
    url,
  );
}
