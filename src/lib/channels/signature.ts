/**
 * 兩個平台的 webhook 驗簽，獨立成一支只依賴 ./crypto 的小檔：主站的 adapter（line.ts、whatsapp.ts）
 * 與前哨 Worker（workers/webhook-ack）共用同一份，前哨打包時不會帶進 Next 或 i18n。
 */
import { base64ToBytes, hexToBytes, hmacSha256, timingSafeEqual } from "./crypto";

/** LINE：X-Line-Signature = base64(HMAC-SHA256(channel secret, 原始 body))。 */
export async function verifyLineSignature(
  channelSecret: string,
  rawBody: Uint8Array,
  signature: string | null,
): Promise<boolean> {
  if (!signature) return false;
  const given = base64ToBytes(signature);
  if (!given) return false;
  const expected = await hmacSha256(channelSecret, rawBody);
  return timingSafeEqual(expected, given);
}

/** WhatsApp：X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(app secret, 原始 body))。 */
export async function verifyWhatsAppSignature(
  appSecret: string,
  rawBody: Uint8Array,
  header: string | null,
): Promise<boolean> {
  if (!header?.startsWith("sha256=")) return false;
  const given = hexToBytes(header.slice("sha256=".length));
  if (!given) return false;
  const expected = await hmacSha256(appSecret, rawBody);
  return timingSafeEqual(expected, given);
}

/** 驗簽要看的 header（小寫）。前哨把它跟原始 body 一起放進佇列，主站重驗。 */
export const SIGNATURE_HEADER = { line: "x-line-signature", whatsapp: "x-hub-signature-256" } as const;
