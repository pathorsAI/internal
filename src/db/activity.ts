import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { activityLog } from "./schema";
import { user } from "./auth-schema";
import { getSession } from "@/lib/session";

export type ActivityAction = "create" | "update" | "delete" | "read";

type RecordArgs = {
  orgId: string;
  channel: "web" | "mcp";
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
