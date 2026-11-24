import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { activityLog } from "./schema";
import { user } from "./auth-schema";
import { getSession } from "@/lib/session";

export type ActivityAction = "create" | "update" | "delete" | "read";

/**
 * web = 登入的成員在網頁操作；mcp = 透過 OAuth MCP；ai = 站內 AI 助理（/dashboard/ai）代成員呼叫工具，
 * actor 是發問並按下確認的那位成員（'ai' 需要 migrations/0036）；system = 沒有人觸發的排程工作
 * （例如整合每日自動同步）。system 沒有操作人 —— actor 欄位一律 NULL，不冒充任何成員。
 * 'system' 需要 migrations/0028 放寬 chk_activity_channel；還沒跑之前寫入會被 CHECK 擋下，
 * 而 record() 會吞掉錯誤，所以只是少一筆紀錄，不會讓同步失敗。
 */
export type ActivityChannel = "web" | "mcp" | "ai" | "system";

type RecordArgs = {
  orgId: string;
  channel: ActivityChannel;
  actorUserId: string | null;
  actorEmail: string | null;
  actorName: string | null;
  action: ActivityAction;
  entityType: string;
  entityId: number | null;
  summary?: string | null;
};

// Low-level insert. Logging must NEVER break the underlying operation, so every
// path here swallows its own errors.
async function record(args: RecordArgs) {
  try {
    await getDb()
      .insert(activityLog)
      .values({
        organizationId: args.orgId,
        actorUserId: args.actorUserId,
        actorEmail: args.actorEmail,
        actorName: args.actorName,
        channel: args.channel,
        action: args.action,
        entityType: args.entityType,
        entityId: args.entityId ?? null,
        summary: args.summary ?? null,
      });
  } catch {
    // ignore — never let auditing fail a write
  }
}

// Web server actions: actor comes from the logged-in session (cached per request).
export async function logWeb(
  orgId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
) {
  try {
    const session = await getSession();
    await record({
      orgId,
      channel: "web",
      actorUserId: session?.user?.id ?? null,
      actorEmail: session?.user?.email ?? null,
      actorName: session?.user?.name ?? null,
      action,
      entityType,
      entityId,
      summary,
    });
  } catch {
    // ignore
  }
}

// MCP tool calls (OAuth bearer token -> userId) and the in-app AI assistant,
// which runs the same tools in-process on behalf of the signed-in member. Look
// up the user's name/email so the log is human-readable without a join.
async function logToolCall(
  channel: "mcp" | "ai",
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
) {
  try {
    let email: string | null = null;
    let name: string | null = null;
    const [u] = await getDb()
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, userId))
      .limit(1);
    if (u) {
      email = u.email;
      name = u.name;
    }
    await record({
      orgId,
      channel,
      actorUserId: userId,
      actorEmail: email,
      actorName: name,
      action,
      entityType,
      entityId,
      summary,
    });
  } catch {
    // ignore
  }
}

export function logMcp(
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
) {
  return logToolCall("mcp", orgId, userId, action, entityType, entityId, summary);
}

/** 站內 AI 助理呼叫的工具（src/lib/ai/run-tool.ts）：channel = 'ai'。 */
export function logAi(
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
) {
  return logToolCall("ai", orgId, userId, action, entityType, entityId, summary);
}

// Scheduled / background work with no human actor (e.g. the daily integration
// auto-sync). Deliberately NOT attributed to any member: actor fields stay NULL
// and channel = 'system'.
export async function logSystem(
  orgId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
) {
  await record({
    orgId,
    channel: "system",
    actorUserId: null,
    actorEmail: null,
    actorName: null,
    action,
    entityType,
    entityId,
    summary,
  });
}
