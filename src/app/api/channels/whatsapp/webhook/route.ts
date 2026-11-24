import { whatsappConfig } from "@/lib/channels/config";
import { adapterFor } from "@/lib/channels/runtime";
import { handleWebhook } from "@/lib/channels/webhook";
import { whatsappChallenge } from "@/lib/channels/whatsapp";

export const dynamic = "force-dynamic";

/**
 * WhatsApp Cloud API webhook（Meta 後台填 https://internal.pathors.com/api/channels/whatsapp/webhook）。
 * GET：訂閱驗證（hub.verify_token 對上就回 hub.challenge）。
 * POST：驗 X-Hub-Signature-256 → 去重 → 進佇列 → 回 200。沒設 WhatsApp secret 時回 404。
 */
export async function GET(req: Request): Promise<Response> {
  const cfg = whatsappConfig();
  if (!cfg) return new Response("Not Found", { status: 404 });
  const challenge = whatsappChallenge(new URL(req.url).searchParams, cfg.verifyToken);
  if (challenge === null) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(req: Request): Promise<Response> {
  return handleWebhook(req, adapterFor("whatsapp"));
}
