/**
 * 聊天 bot 的設定（全部從 Worker secret / process.env 讀）。
 *
 * 任一平台的必要 secret 沒設齊，那個平台就整個停用：webhook 回 404、設定頁顯示「尚未啟用」，
 * 不會炸。每次呼叫都重讀 process.env（OpenNext 在每個請求前填好），不做模組層級快取，
 * 測試也能直接改 process.env。
 */
import type { ChatProvider } from "@/db/chat";

export type { ChatProvider } from "@/db/chat";

export type LineConfig = {
  channelSecret: string;
  accessToken: string;
  /** 官方帳號的 basic ID（`@123abcde`，含 @）。 */
  basicId: string;
};

export type WhatsAppConfig = {
  accessToken: string;
  phoneNumberId: string;
  appSecret: string;
  verifyToken: string;
  /** 對外顯示的號碼（例如 `+886 912 345 678`），wa.me 連結用。 */
  displayNumber: string;
};

function env(name: string): string {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : "";
}

export function lineConfig(): LineConfig | null {
  const channelSecret = env("LINE_CHANNEL_SECRET");
  const accessToken = env("LINE_CHANNEL_ACCESS_TOKEN");
  const basicId = env("LINE_BOT_BASIC_ID");
  if (!channelSecret || !accessToken || !basicId) return null;
  return { channelSecret, accessToken, basicId };
}

export function whatsappConfig(): WhatsAppConfig | null {
  const accessToken = env("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = env("WHATSAPP_PHONE_NUMBER_ID");
  const appSecret = env("WHATSAPP_APP_SECRET");
  const verifyToken = env("WHATSAPP_VERIFY_TOKEN");
  const displayNumber = env("WHATSAPP_DISPLAY_NUMBER");
  if (!accessToken || !phoneNumberId || !appSecret || !verifyToken || !displayNumber) return null;
  return { accessToken, phoneNumberId, appSecret, verifyToken, displayNumber };
}

export function isChannelEnabled(p: ChatProvider): boolean {
  return p === "line" ? lineConfig() !== null : whatsappConfig() !== null;
}

/** internal 的對外網址（bot 回覆裡的連結用）。 */
export function appBaseUrl(): string {
  const configured = env("BETTER_AUTH_URL");
  try {
    return new URL(configured || "https://internal.pathors.com").origin;
  } catch {
    return "https://internal.pathors.com";
  }
}
