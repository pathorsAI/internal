import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { getAiConversation } from "@/db/ai";
import { organization } from "@/db/auth-schema";
import { getUserLocale } from "@/i18n/locale";
import { MAX_USER_MESSAGE_CHARS, openRouterApiKey } from "@/lib/ai/config";
import { ModelError } from "@/lib/ai/openrouter";
import { defaultTurnDeps, runTurn, TurnNotFoundError } from "@/lib/ai/turn";
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
 * 使用者從登入的 session 取；目前的組織是 requireOrg 的組織（使用者的 current_org_id）。
 * 對話列的是本人在所有組織的對話（仍要是該組織的成員），工具呼叫可以跨到本人的其他組織，
 * 寫入用目標組織的角色檢查（src/lib/ai/engine.ts）。
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

/** 欄位不合法時丟出的記號，parseBody 收到就回 null。 */
const INVALID = Symbol("invalid");

function parseConversationId(v: unknown): string | undefined | typeof INVALID {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.length > 64) return INVALID;
  return v;
}

function parseMessage(v: unknown): string | undefined | typeof INVALID {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return INVALID;
  const m = v.trim();
  if (!m || m.length > MAX_USER_MESSAGE_CHARS) return INVALID;
  return m;
}

function parseConfirm(v: unknown): ChatRequest["confirm"] | typeof INVALID {
  if (v === undefined) return undefined;
  const c = v as Record<string, unknown> | null;
  if (!c || typeof c.toolCallId !== "string" || typeof c.approve !== "boolean") return INVALID;
  // 確認卡上「換到 …」：只收短字串，是不是本人的組織、角色夠不夠由引擎檢查。
  if (c.organizationId !== undefined && (typeof c.organizationId !== "string" || c.organizationId.length > 64)) {
    return INVALID;
  }
  return {
    toolCallId: c.toolCallId,
    approve: c.approve,
    ...(typeof c.organizationId === "string" && c.organizationId ? { organizationId: c.organizationId } : {}),
  };
}

function parseBody(raw: unknown): ChatRequest | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const conversationId = parseConversationId(b.conversationId);
  const message = parseMessage(b.message);
  const confirm = parseConfirm(b.confirm);
  if (conversationId === INVALID || message === INVALID || confirm === INVALID) return null;
  const out: ChatRequest = {};
  if (conversationId !== undefined) out.conversationId = conversationId;
  if (message !== undefined) out.message = message;
  if (b.page !== undefined) out.page = typeof b.page === "string" ? b.page : undefined;
  if (confirm !== undefined) out.confirm = confirm;
  // 一次只做一件事：問新題目，或回覆一張確認卡。
  if (Boolean(out.message) === Boolean(out.confirm)) return null;
  if (out.confirm && !out.conversationId) return null;
  return out;
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json(403, { t: "error", code: "bad_request" });
  const { orgId, userId, session } = await requireOrg();
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

  // 指定的對話不存在（或不是本人的）就在開串流之前回 404；runTurn 之後會再查一次。
  if (body.conversationId && !(await getAiConversation(owner, body.conversationId))) {
    return json(404, { t: "error", code: "not_found" });
  }
  const deps = defaultTurnDeps(apiKey);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (e: ChatEvent) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(e)}\n`));
        } catch {
          // 使用者關掉頁面之後 enqueue 會丟錯，忽略
        }
      };
      // 模型幾乎是一個 token 一段：文字先攢 50ms 再一起送，其他事件來時先把文字送出去保持順序。
      let textBuf = "";
      let textTimer: ReturnType<typeof setTimeout> | null = null;
      const flushText = () => {
        if (textTimer) clearTimeout(textTimer);
        textTimer = null;
        if (textBuf) write({ t: "text", d: textBuf });
        textBuf = "";
      };
      const emit = (e: ChatEvent) => {
        if (e.t === "text") {
          textBuf += e.d;
          textTimer ??= setTimeout(flushText, 50);
          return;
        }
        flushText();
        write(e);
      };
      try {
        await runTurn({
          owner,
          role,
          channel: "web",
          quickReplies: true,
          conversationId: body.conversationId ?? null,
          message: body.message,
          confirm: body.confirm,
          page: body.page ?? null,
          locale,
          orgName: orgRow[0]?.name ?? "",
          userName: session.user.name ?? "",
          emit,
          signal: req.signal,
          deps,
        });
        emit({ t: "done" });
      } catch (err) {
        if (!req.signal.aborted) {
          console.error("[ai/chat]", err);
          if (err instanceof TurnNotFoundError) {
            emit({ t: "error", code: "not_found" });
          } else {
            emit({
              t: "error",
              code: err instanceof ModelError ? "model_failed" : "internal",
            });
          }
        }
      } finally {
        flushText();
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
