/**
 * 綁定連結：設定頁產生綁定碼後，給使用者一顆「開啟 LINE／WhatsApp」的連結，
 * 打開就是跟 bot 的對話、輸入框預填「綁定 123456」，按送出即可。
 */
import { lineConfig, whatsappConfig, type ChatProvider } from "./config";

/** bot 認得的綁定訊息（dispatcher 也接受全形空白、沒有空白）。 */
export function bindMessage(code: string): string {
  return `綁定 ${code}`;
}

/** 平台沒啟用回 null。沒帶 code 就只開啟對話（LINE 為加好友頁）。 */
export function chatOpenUrl(p: ChatProvider, code?: string): string | null {
  if (p === "line") {
    const cfg = lineConfig();
    if (!cfg) return null;
    if (!code) return `https://line.me/R/ti/p/${encodeURIComponent(cfg.basicId)}`;
    return `https://line.me/R/oaMessage/${encodeURIComponent(cfg.basicId)}/?${encodeURIComponent(bindMessage(code))}`;
  }
  const cfg = whatsappConfig();
  if (!cfg) return null;
  const number = cfg.displayNumber.replace(/\D/g, "");
  if (!number) return null;
  const base = `https://wa.me/${number}`;
  return code ? `${base}?text=${encodeURIComponent(bindMessage(code))}` : base;
}
