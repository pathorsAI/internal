import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { activityLog } from "./schema";
import { user } from "./auth-schema";
import { captureChangeGroup } from "./undo";
import { getSession } from "@/lib/session";
import { ENTITY_TABLES, maskSnapshot } from "@/lib/undo-rules";

export type ActivityAction = "create" | "update" | "delete" | "read";

/**
 * web = 登入的成員在網頁操作；mcp = 透過 OAuth MCP；ai = 站內 AI 助理（/dashboard/ai）代成員呼叫工具，
 * actor 是發問並按下確認的那位成員（'ai' 需要 migrations/0036）；system = 沒有人觸發的排程工作
 * （例如整合每日自動同步）。system 沒有操作人 —— actor 欄位一律 NULL，不冒充任何成員。
 * api = 用組織 API key 呼叫 REST（/api/v1）或 MCP，actor 是金鑰的建立者，summary 開頭帶金鑰名稱
 * （'api' 需要 migrations/0038）。
 * 'system' 需要 migrations/0028 放寬 chk_activity_channel；還沒跑之前寫入會被 CHECK 擋下，
 * 而 record() 會吞掉錯誤，所以只是少一筆紀錄，不會讓同步失敗。
 */
export type ActivityChannel = "web" | "mcp" | "ai" | "system" | "api" | "line" | "whatsapp";

/**
 * 工具呼叫的來源：mcp = 外部 agent；ai = 站內網頁 AI；line／whatsapp = 聊天 bot 代成員呼叫
 * （actor 是綁定那個聊天帳號的成員，'line'／'whatsapp' 需要 migrations/0042）。
 */
export type ToolCallChannel = "mcp" | "ai" | "line" | "whatsapp";

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
} & ActivityExtra;

/** 復原（migrations/0045）用的附加欄位。 */
export type ActivityExtra = {
  /** MCP／站內 AI／聊天呼叫的工具名稱（批次、合併這類不能復原的工具靠它說明理由）。 */
  toolName?: string | null;
  /** 這筆是復原哪一筆操作紀錄。 */
  undoOf?: number | null;
};

/**
 * 這筆操作動到的資料列變動（entity_changes，trigger 寫的）：對得到就帶上 change_id 與
 * 遮罩過的前後快照，之後才能復原。對不到（舊的 entity type、表還沒掛 trigger、
 * migration 0045 還沒跑）就是 null —— 只是這筆不能復原，絕不影響寫入。
 */
async function snapshotFor(args: RecordArgs) {
  const table = ENTITY_TABLES[args.entityType];
  if (!table || args.entityId == null || args.action === "read") return null;
  try {
    const group = await captureChangeGroup(args.orgId, table, args.entityId, args.action);
    if (!group) return null;
    return {
      changeId: group.last.id,
      firstChangeId: group.first.id,
      before: maskSnapshot(group.first.before),
      after: maskSnapshot(group.last.after),
    };
  } catch {
    return null;
  }
}

// Low-level insert. Logging must NEVER break the underlying operation, so every
// path here swallows its own errors. Returns the new activity_log id (null when
// logging failed).
async function record(args: RecordArgs): Promise<number | null> {
  const base = {
    organizationId: args.orgId,
    actorUserId: args.actorUserId,
    actorEmail: args.actorEmail,
    actorName: args.actorName,
    channel: args.channel,
    action: args.action,
    entityType: args.entityType,
    entityId: args.entityId ?? null,
    summary: args.summary ?? null,
  };
  try {
    const snapshot = await snapshotFor(args);
    const [row] = await getDb()
      .insert(activityLog)
      .values({
        ...base,
        ...snapshot,
        toolName: args.toolName ?? null,
        undoOf: args.undoOf ?? null,
      })
      .returning({ id: activityLog.id });
    return row?.id ?? null;
  } catch {
    // migration 0045 還沒跑（新欄位不存在）時退回舊的寫法，紀錄照樣留下。
  }
  try {
    const [row] = await getDb().insert(activityLog).values(base).returning({ id: activityLog.id });
    return row?.id ?? null;
  } catch {
    // ignore — never let auditing fail a write
    return null;
  }
}

// Web server actions: actor comes from the logged-in session (cached per request).
export async function logWeb(
  orgId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
  extra: ActivityExtra = {},
): Promise<number | null> {
  try {
    const session = await getSession();
    return await record({
      orgId,
      channel: "web",
      actorUserId: session?.user?.id ?? null,
      actorEmail: session?.user?.email ?? null,
      actorName: session?.user?.name ?? null,
      action,
      entityType,
      entityId,
      summary,
      ...extra,
    });
  } catch {
    // ignore
    return null;
  }
}

// MCP tool calls (OAuth bearer token -> userId) and the in-app AI assistant,
// which runs the same tools in-process on behalf of the signed-in member. Look
// up the user's name/email so the log is human-readable without a join.
async function logToolCall(
  channel: ToolCallChannel | "api",
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
  extra: ActivityExtra = {},
): Promise<number | null> {
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
    return await record({
      orgId,
      channel,
      actorUserId: userId,
      actorEmail: email,
      actorName: name,
      action,
      entityType,
      entityId,
      summary,
      ...extra,
    });
  } catch {
    // ignore
    return null;
  }
}

/**
 * 工具呼叫的操作紀錄（任何入口）：channel = mcp／ai／line／whatsapp，或 api（帶金鑰名稱）。
 * 給自己寫操作紀錄的工具用（例如 undo_activity），回傳新紀錄的 id。
 */
export function logToolActivity(
  channel: ToolCallChannel | { apiKeyName: string },
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
  extra: ActivityExtra = {},
): Promise<number | null> {
  if (typeof channel === "object") {
    return logToolCall("api", orgId, userId, action, entityType, entityId, apiKeySummary(channel.apiKeyName, summary), extra);
  }
  return logToolCall(channel, orgId, userId, action, entityType, entityId, summary, extra);
}

export function logMcp(
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
  extra: ActivityExtra = {},
) {
  return logToolCall("mcp", orgId, userId, action, entityType, entityId, summary, extra);
}

/** 站內 AI 助理呼叫的工具（src/lib/ai/run-tool.ts）：channel = 'ai'。 */
export function logAi(
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
  extra: ActivityExtra = {},
) {
  return logToolCall("ai", orgId, userId, action, entityType, entityId, summary, extra);
}

/** 金鑰名稱標在 summary 開頭，操作紀錄一眼就看得出是哪一把。 */
export function apiKeySummary(keyName: string, summary?: string | null): string {
  return summary ? `API key「${keyName}」：${summary}` : `API key「${keyName}」`;
}

/** 用組織 API key 呼叫的工具（REST /api/v1 或 MCP Bearer）：channel = 'api'，actor = 金鑰建立者。 */
export function logApi(
  orgId: string,
  userId: string,
  keyName: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
  extra: ActivityExtra = {},
) {
  return logToolCall("api", orgId, userId, action, entityType, entityId, apiKeySummary(keyName, summary), extra);
}

/** LINE／WhatsApp bot 代成員呼叫的工具：channel = 'line' | 'whatsapp'。 */
export function logChat(
  channel: "line" | "whatsapp",
  orgId: string,
  userId: string,
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary?: string,
  extra: ActivityExtra = {},
) {
  return logToolCall(channel, orgId, userId, action, entityType, entityId, summary, extra);
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
  return record({
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
