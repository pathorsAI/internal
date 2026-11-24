import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { createAiConversation, getAiConversation, listAiMessages } from "@/db/ai";
import { organization } from "@/db/auth-schema";
import { getUserLocale } from "@/i18n/locale";
import { MAX_USER_MESSAGE_CHARS, openRouterApiKey } from "@/lib/ai/config";
import {
  cancelStalePending,
  defaultDeps,
  resolveConfirmation,
  runModelLoop,
  type TurnContext,
} from "@/lib/ai/engine";
import { ModelError } from "@/lib/ai/openrouter";
import { sanitizePage, systemPrompt } from "@/lib/ai/prompt";
import type { ChatEvent, ChatRequest } from "@/lib/ai/types";
import { requestOrigin } from "@/lib/request-origin";
import { getOrgRole, requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 站內 AI 助理（/dashboard/ai）的後端。回應是 NDJSON 串流（一行一個 ChatEvent）。
 *
 * - 問新的一題：{ conversationId?, message, page? }。沒有 conversationId 就開一段新對話。
 * - 確認卡：{ conversationId, confirm: { toolCallId, approve } }。
 *
 * 組織與使用者一律從登入的 session 取（requireOrg），對話只查得到本人在這個組織的。
 */

function json(status: number, body: ChatEvent) {
  return Response.json(body, { status });
}

/** 只收同源的請求：cookie 驗證的 POST 不能讓別的網站代送。 */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") !== "cross-site";
  try {
    return new URL(origin).origin === new URL(requestOrigin(req.headers)).origin;
  } catch {
    return false;
  }
}

function parseBody(raw: unknown): ChatRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const out: ChatRequest = {};
  if (b.conversationId !== undefined) {
    if (typeof b.conversationId !== "string" || b.conversationId.length > 64) return null;
    out.conversationId = b.conversationId;
  }
  if (b.message !== undefined) {
    if (typeof b.message !== "string") return null;
    const m = b.message.trim();
    if (!m || m.length > MAX_USER_MESSAGE_CHARS) return null;
    out.message = m;
  }
  if (b.page !== undefined) out.page = typeof b.page === "string" ? b.page : undefined;
  if (b.confirm !== undefined) {
    const c = b.confirm as Record<string, unknown> | null;
    if (!c || typeof c.toolCallId !== "string" || typeof c.approve !== "boolean") return null;
    out.confirm = { toolCallId: c.toolCallId, approve: c.approve };
  }
  // 一次只做一件事：問新題目，或回覆一張確認卡。
  if (Boolean(out.message) === Boolean(out.confirm)) return null;
  if (out.confirm && !out.conversationId) return null;
  return out;
}

function titleFrom(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  return oneLine.length > 60 ? `${oneLine.slice(0, 59)}…` : oneLine;
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { t: "error", code: "bad_request" });
  const { orgId, userId } = await requireOrg();
  const owner = { orgId, userId };

  let body: ChatRequest | null = null;
  try {
    body = parseBody(await req.json());
  } catch {
    body = null;
  }
  if (!body) return json(400, { t: "error", code: "bad_request" });

  const apiKey = openRouterApiKey();
  if (!apiKey) return json(503, { t: "error", code: "not_configured" });

  const [role, locale, orgRow] = await Promise.all([
    getOrgRole(orgId, userId),
    getUserLocale(),
    getDb()
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1),
  ]);
  // requireOrg 已確認登入，但成員可能剛被移出這個組織。
  if (!role) return json(403, { t: "error", code: "bad_request" });

  let conversation = body.conversationId
    ? await getAiConversation(owner, body.conversationId)
    : null;
  if (body.conversationId && !conversation) return json(404, { t: "error", code: "not_found" });

  const isNew = !conversation;
  if (!conversation) {
    conversation = await createAiConversation(owner, titleFrom(body.message ?? ""));
  }
  const conversationId = conversation.id;
  const toolGroups = conversation.toolGroups;
  const title = conversation.title;
  const page = isNew ? sanitizePage(body.page) : null;
  const deps = defaultDeps(apiKey);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // 使用者關掉頁面之後 enqueue 會丟錯，忽略
        }
      };
      const ctx: TurnContext = {
        owner,
        role,
        conversationId,
        toolGroups,
        systemPrompt: systemPrompt({
          orgName: orgRow[0]?.name ?? "",
          locale,
          role,
          page,
        }),
        emit,
        signal: req.signal,
        deps,
      };
      try {
        if (isNew) emit({ t: "conv", id: conversationId, title });
        if (body.message) {
          const history = await listAiMessages(conversationId);
          await cancelStalePending(deps, conversationId, history);
          await deps.db.insertAiMessage(conversationId, { role: "user", content: body.message });
          await runModelLoop(ctx, body.message);
        } else if (body.confirm) {
          await resolveConfirmation(ctx, body.confirm.toolCallId, body.confirm.approve);
        }
        emit({ t: "done" });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[ai/chat]", err);
          emit({
            t: "error",
            code: err instanceof ModelError ? "model_failed" : "internal",
          });
        }
      } finally {
        try {
          controller.close();
        } catch {
          // 已經關了
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
