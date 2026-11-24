/**
 * 站內 AI 助理（/dashboard/ai）的設定。模型名稱只放這裡：要換模型或做 A/B，改這一個字串。
 * 金鑰讀 Worker secret `OPENROUTER_API_KEY`（`wrangler secret put OPENROUTER_API_KEY`），
 * 本機讀 `.env.local`；沒設時 /api/ai/chat 回一則「尚未設定」的錯誤，不會壞掉其他頁。
 */
export const AI_MODEL = "openai/gpt-6-luna";

export const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";

/** 一題最多跟模型來回幾輪（每輪可能呼叫多支工具）。防止模型繞圈子燒錢。 */
export const MAX_MODEL_ROUNDS = 8;

/** 單輪回覆的輸出上限。 */
export const MAX_OUTPUT_TOKENS = 2_000;

/** 送給模型的歷史訊息數上限（從最新往回數）。 */
export const MAX_HISTORY_MESSAGES = 40;

/** 工具結果存進 DB 的長度上限（字元）。 */
export const MAX_STORED_TOOL_CHARS = 60_000;

/** 這一題的工具結果送給模型的長度上限；更早幾題的結果再縮短，省 token。 */
export const MAX_TOOL_CHARS_CURRENT = 16_000;
export const MAX_TOOL_CHARS_HISTORY = 2_000;

/** 使用者單則訊息長度上限。 */
export const MAX_USER_MESSAGE_CHARS = 4_000;

export function openRouterApiKey(): string | null {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? key : null;
}
