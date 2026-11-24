import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { member, organization } from "@/db/auth-schema";
import { resolveCurrentOrgId } from "@/db/current-org";

/**
 * Resolve which organization an MCP request should operate on.
 *
 * Auth binds to the USER (the OAuth token carries a userId). The org is then
 * derived from that user's membership. A connection can pin one via
 * `?org=<id-or-slug>` on the MCP URL (passed through here as `orgHint`), or a
 * tool call can pass `organizationId`. Either way the value is validated
 * against the user's memberships.
 *
 * 沒有指定時用這個人「目前的組織」（"user".current_org_id，網頁切換器、站內 AI、聊天 bot 共用；
 * 順序見 src/db/current-org.ts 的 pickCurrentOrg）：目前的組織（仍是成員）→ 只有一個組織就是它
 * → 否則最早加入的。不再因為「屬於好幾個組織」就丟 ambiguous 要模型去問。
 */
export async function resolveOrgId(
  userId: string,
  orgHint?: string,
): Promise<string> {
  if (orgHint) {
    // Accept an org id OR slug, but only among orgs the user belongs to.
    const rows = await getDb()
      .select({ organizationId: member.organizationId })
      .from(member)
      .innerJoin(organization, eq(organization.id, member.organizationId))
      .where(
        and(
          eq(member.userId, userId),
          or(eq(organization.id, orgHint), eq(organization.slug, orgHint)),
        ),
      )
      .limit(1);
    if (!rows[0]) {
      throw new Error(
        `You are not a member of organization "${orgHint}" (or it does not exist).`,
      );
    }
    return rows[0].organizationId;
  }

  const orgId = await resolveCurrentOrgId(userId);
  if (!orgId) {
    throw new Error(
      "No organization is associated with your account. Call list_my_invitations — if an organization has invited you, accept it with accept_invitation; otherwise ask an organization admin to invite you from the web app.",
    );
  }
  return orgId;
}

/** tools/call 結果的 _meta 要帶的組織（id、名稱、slug）。查不到回 null。 */
export type OrgSummary = { id: string; name: string; slug: string | null };

export async function getOrgSummary(orgId: string): Promise<OrgSummary | null> {
  const [row] = await getDb()
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return row ?? null;
}
