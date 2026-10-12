/**
 * 寄信：直接打 Resend 的 HTTP API。
 *
 * 不裝 resend SDK：整個需求就是一個 POST，SDK 帶來的是 Node 專屬的相依與更大的
 * Worker bundle，換不到任何東西。fetch 在 Workers、Node、bun 上都是原生的。
 *
 * 寄件身分預設 noreply@pathors.com；網域必須先在 Resend 驗證過（DNS），否則
 * Resend 回 403。自架的人用 RESEND_FROM 換成自己的網域。
 */

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const DEFAULT_FROM = "Pathors Internal <noreply@pathors.com>";

export async function sendEmail({ to, subject, html, text }: EmailMessage): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    // 本機開發沒有 key 時把信印在 console（含連結），註冊／重設密碼的流程照樣能
    // 從頭點到尾。正式環境沒有 key 一定是部署漏設 secret，要大聲失敗，不能默默
    // 假裝寄出——呼叫端會把錯誤寫進 log。
    if (process.env.NODE_ENV !== "production") {
      console.info(`[email] RESEND_API_KEY 未設定，沒有實際寄出。\nTo: ${to}\nSubject: ${subject}\n\n${text}`);
      return;
    }
    throw new Error("RESEND_API_KEY is not set; cannot send email");
  }

  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: process.env.RESEND_FROM ?? DEFAULT_FROM,
      to: [to],
      subject,
      html,
      text,
    }),
  });
  if (!response.ok) {
    throw new Error(`Resend responded ${response.status}: ${await response.text()}`);
  }
}
