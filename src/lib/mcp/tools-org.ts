import { and, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { invitation, member, organization, user } from "@/db/auth-schema";
import {
  listResult,
  listSchema,
  optString,
  rowSchema,
  type JsonSchemaObject,
  type ToolDef,
} from "./shared";

// ---- 邀請（organization invitations）----
//
// 邀請是 better-auth organization plugin 的東西，發邀請在 web 端（members 頁）。
// 這裡補的是「受邀者這一側」：一個剛連上 MCP、還不屬於任何組織（或還沒加入被邀
// 的那個組織）的帳號，不必離開對話跑去 /onboarding 才能接受邀請。
//
// 為什麼不直接呼叫 better-auth 的 `auth.api.acceptInvitation`：它掛在
// orgSessionMiddleware 後面，要一個 **session cookie**。MCP 的 OAuth token 只給
// 我們 userId，沒有 session 可以借。所以這裡照 better-auth 自己的
// accept-invitation route（plugins/organization/routes/crud-invites）把檢查
// 一條條重做：pending、未過期、email 相符、成員數上限；然後寫 member 列、把
// invitation 標成 accepted。差別只有「不更新 session 的 activeOrganizationId」——
// MCP 沒有 session；web 端 src/lib/session.ts 本來就會在 active org 為空時
// 回退到第一個 membership，所以下次登入網頁一樣看得到新組織。

/** better-auth organization plugin 的預設 membershipLimit（我們沒覆寫）。 */
const MEMBERSHIP_LIMIT = 100;

const INVITATION_ROW: JsonSchemaObject = rowSchema({
  id: { type: "string", description: "Pass this to accept_invitation as `invitationId`." },
  organizationId: {
    type: "string",
    description: "The organization's slug (or id when it has no slug) — the same value list_organizations returns.",
  },
  organizationName: { type: "string" },
  role: { type: ["string", "null"], description: "Role you would join as (member / admin / owner)." },
  inviterName: { type: ["string", "null"] },
  inviterEmail: { type: ["string", "null"] },
  expired: {
    type: "boolean",
    description:
      "True when the invitation has passed its expiry and can no longer be accepted; ask the inviter to re-send it.",
  },
  expiresAt: { type: "string", description: "ISO 8601 timestamp." },
  createdAt: { type: "string", description: "ISO 8601 timestamp." },
});

type PendingInvitation = {
  id: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string | null;
  role: string | null;
  inviterName: string | null;
  inviterEmail: string | null;
  expiresAt: Date;
  createdAt: Date;
};

async function getUserEmail(userId: string): Promise<string> {
  const [u] = await getDb()
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!u) throw new Error("Signed-in user not found.");
  return u.email;
}

/**
 * 這個 email 名下、status 仍是 pending 的邀請（含已過期的：better-auth 從不把
 * 過期邀請改成 expired，所以「pending 但已過期」是常態，得自己判）。
 * email 比對不分大小寫，與 better-auth 的 accept-invitation 一致。
 */
async function listPendingInvitations(email: string): Promise<PendingInvitation[]> {
  return getDb()
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      organizationName: organization.name,
      organizationSlug: organization.slug,
      role: invitation.role,
      inviterName: user.name,
      inviterEmail: user.email,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    })
    .from(invitation)
    .innerJoin(organization, eq(organization.id, invitation.organizationId))
    .leftJoin(user, eq(user.id, invitation.inviterId))
    .where(
      and(
        eq(sql`lower(${invitation.email})`, email.toLowerCase()),
        eq(invitation.status, "pending"),
      ),
    )
    .orderBy(desc(invitation.createdAt));
}

function isExpired(inv: { expiresAt: Date }, now = new Date()): boolean {
  return inv.expiresAt.getTime() < now.getTime();
}

/** 找出要接受的那一筆：優先用 invitationId，否則用 organizationId（id 或 slug）。 */
function pickInvitation(
  pending: PendingInvitation[],
  invitationId: string | undefined,
  orgKey: string | undefined,
): PendingInvitation {
  if (invitationId) {
    const inv = pending.find((i) => i.id === invitationId);
    if (!inv) {
      throw new Error(
        `Invitation "${invitationId}" was not found among your pending invitations — see list_my_invitations. It may have been accepted, canceled, or addressed to a different email.`,
      );
    }
    return inv;
  }
  if (orgKey) {
    const matches = pending.filter(
      (i) => i.organizationId === orgKey || i.organizationSlug === orgKey,
    );
    const live = matches.filter((i) => !isExpired(i));
    if (live.length === 1) return live[0];
    if (live.length > 1) {
      throw new Error(
        `You have ${live.length} pending invitations to organization "${orgKey}" — call list_my_invitations and pass the exact invitationId.`,
      );
    }
    if (matches.length > 0) {
      throw new Error(
        `Your invitation to organization "${orgKey}" has expired. Ask the inviter to send a new one from the web app.`,
      );
    }
    throw new Error(
      `No pending invitation to organization "${orgKey}" for your account — see list_my_invitations.`,
    );
  }
  throw new Error('Pass "invitationId" (from list_my_invitations) or "organizationId".');
}

/** The user's member row id in `orgId`, or null when they are not a member. */
async function findMemberId(orgId: string, userId: string): Promise<string | null> {
  const [m] = await getDb()
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  return m?.id ?? null;
}

async function countMembers(orgId: string): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)::int` })
    .from(member)
    .where(eq(member.organizationId, orgId));
  return row?.n ?? 0;
}

export const orgTools: Record<string, ToolDef> = {
  list_my_invitations: {
    description:
      "List the organization invitations addressed to the signed-in user's email that are still pending. Use this when the account belongs to no organization yet (list_organizations is empty or a tool reports no organization), or when the user says they were invited somewhere. Each row carries the invitationId to pass to accept_invitation; rows with `expired: true` cannot be accepted and need a fresh invitation from the inviter. Invitations are sent from the web app, not over MCP.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    outputSchema: listSchema(INVITATION_ROW),
    execute: async (_args, ctx) => {
      const email = await getUserEmail(ctx.userId);
      const rows = await listPendingInvitations(email);
      const now = new Date();
      return listResult(
        rows.map((r) => ({
          id: r.id,
          organizationId: r.organizationSlug ?? r.organizationId,
          organizationName: r.organizationName,
          role: r.role,
          inviterName: r.inviterName,
          inviterEmail: r.inviterEmail,
          expired: isExpired(r, now),
          expiresAt: r.expiresAt.toISOString(),
          createdAt: r.createdAt.toISOString(),
        })),
      );
    },
  },

  accept_invitation: {
    description:
      "Accept a pending organization invitation on behalf of the signed-in user, making them a member of that organization with the invited role. Identify the invitation by `invitationId` (from list_my_invitations) or by `organizationId` (id or slug) when there is exactly one live invitation to that organization. Confirm with the user which organization they want to join before calling this — joining cannot be undone from MCP. Only the invited email can accept; expired, canceled or already-used invitations are rejected. After success, pass the returned organizationId to the other tools.",
    inputSchema: {
      type: "object",
      properties: {
        invitationId: {
          type: "string",
          description: "The invitation to accept — the `id` from list_my_invitations.",
        },
        organizationId: {
          type: "string",
          description:
            "Alternative to invitationId: the organization (id or slug) whose single live invitation should be accepted.",
        },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        invitationId: { type: "string" },
        organizationId: {
          type: "string",
          description: "Pass this as `organizationId` on the other tools from now on.",
        },
        organizationName: { type: "string" },
        role: { type: "string", description: "Role the user now holds in the organization." },
        memberId: { type: "string" },
        alreadyMember: {
          type: "boolean",
          description:
            "True when the user was already a member (e.g. a retry after a partial failure); the invitation was simply closed out.",
        },
        hint: { type: "string" },
      },
      required: [
        "invitationId",
        "organizationId",
        "organizationName",
        "role",
        "memberId",
        "alreadyMember",
        "hint",
      ],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const invitationId = optString(args, "invitationId");
      const orgKey = optString(args, "organizationId");
      if (!invitationId && !orgKey) {
        throw new Error('Pass "invitationId" (from list_my_invitations) or "organizationId".');
      }
      const db = getDb();

      const email = await getUserEmail(ctx.userId);
      const pending = await listPendingInvitations(email);
      const inv = pickInvitation(pending, invitationId, orgKey);
      if (isExpired(inv)) {
        throw new Error(
          `Invitation to "${inv.organizationName}" expired on ${inv.expiresAt.toISOString()}. Ask the inviter to send a new one from the web app.`,
        );
      }

      const role = inv.role ?? "member";
      // neon-http 沒有 transaction，所以順序刻意是「先 member、後 invitation」：
      // 萬一中間斷掉，留下的是「已是成員 + 邀請仍 pending」，重跑一次會走到下面
      // 這條 alreadyMember 修復路徑把邀請收掉；反過來的話會變成「邀請已 accepted
      // 但人不在組織裡」，無法從 MCP 自救。
      const existingMemberId = await findMemberId(inv.organizationId, ctx.userId);
      const alreadyMember = existingMemberId !== null;
      let memberId = existingMemberId ?? "";
      if (!alreadyMember) {
        const n = await countMembers(inv.organizationId);
        if (n >= MEMBERSHIP_LIMIT) {
          throw new Error(
            `Organization "${inv.organizationName}" has reached its membership limit (${MEMBERSHIP_LIMIT}).`,
          );
        }
        memberId = crypto.randomUUID();
        await db.insert(member).values({
          id: memberId,
          organizationId: inv.organizationId,
          userId: ctx.userId,
          role,
          createdAt: new Date(),
        });
      }

      // 只收 status 仍是 pending 的那筆：兩個 client 同時接受時，第二個會拿到 0 列。
      const closed = await db
        .update(invitation)
        .set({ status: "accepted" })
        .where(and(eq(invitation.id, inv.id), eq(invitation.status, "pending")))
        .returning({ id: invitation.id });
      if (!closed[0] && !alreadyMember) {
        throw new Error(
          `Invitation "${inv.id}" was closed by someone else while accepting; you are now a member of "${inv.organizationName}" — call list_organizations to continue.`,
        );
      }

      const organizationId = inv.organizationSlug ?? inv.organizationId;
      return {
        invitationId: inv.id,
        organizationId,
        organizationName: inv.organizationName,
        role,
        memberId,
        alreadyMember,
        hint: alreadyMember
          ? `You were already a member of "${inv.organizationName}"; the invitation has been marked accepted. Use organizationId "${organizationId}" with the other tools.`
          : `Joined "${inv.organizationName}" as ${role}. Use organizationId "${organizationId}" with the other tools from now on.`,
      };
    },
  },
};
