import { adapterFor } from "@/lib/channels/runtime";
import { handleWebhook } from "@/lib/channels/webhook";

export const dynamic = "force-dynamic";

/**
 * LINE Messaging API webhook（LINE Developers 後台填 https://internal.pathors.com/api/channels/line/webhook）。
 * 驗 X-Line-Signature → 去重 → 進佇列 → 回 200。沒設 LINE secret 時回 404。
 * 後台的「Verify」按鈕送的是空的 events，一樣回 200。
 */
export async function POST(req: Request): Promise<Response> {
  return handleWebhook(req, adapterFor("line"));
}
