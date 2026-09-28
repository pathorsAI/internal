import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { activityLog } from "./schema";
import { user } from "./auth-schema";
import { getSession } from "@/lib/session";

export type ActivityAction = "create" | "update" | "delete" | "read";

/**
 * web = 登入的成員在網頁操作；mcp = 透過 OAuth MCP；system = 沒有人觸發的排程工作
 * （例如整合每日自動同步）。system 沒有操作人 —— actor 欄位一律 NULL，不冒充任何成員。
 * 'system' 需要 migrations/0028 放寬 chk_activity_channel；還沒跑之前寫入會被 CHECK 擋下，
 * 而 record() 會吞掉錯誤，所以只是少一筆紀錄，不會讓同步失敗。
 */
export type ActivityChannel = "web" | "mcp" | "system";

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

// MCP tool calls (OAuth bearer token -> userId). Look up the user's name/email
// so the log is human-readable without a join.
export async function logMcp(
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
      channel: "mcp",
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
