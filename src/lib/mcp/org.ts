import { and, asc, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { member, organization } from "@/db/auth-schema";

/**
 * Resolve which organization an MCP request should operate on.
 *
 * Auth binds to the USER (the OAuth token carries a userId). The org is then
 * derived from that user's membership. Because a user can belong to multiple
 * orgs, a connection can pin one via `?org=<id-or-slug>` on the MCP URL (passed
 * through here as `orgHint`), or a tool call can pass `organizationId`. Either
 * way the value is validated against the user's memberships. With no hint we
 * fall back to the user's earliest-joined org (deterministic).
 */
export async function resolveOrgId(
  userId: string,
  orgHint?: string,
): Promise<string> {
  const db = getDb();

  if (orgHint) {
    // Accept an org id OR slug, but only among orgs the user belongs to.
    const rows = await db
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

  // No hint: if the user is in exactly one org, use it. If in several, refuse to
  // guess — tell the model to ask the user and retry with organizationId.
  const rows = await db
    .select({
      organizationId: member.organizationId,
      name: organization.name,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
  if (rows.length === 0) {
    throw new Error("No organization is associated with your account.");
  }
  if (rows.length === 1) {
    return rows[0].organizationId;
  }
  const choices = rows
    .map((r) => `"${r.name}" (organizationId: ${r.slug ?? r.organizationId})`)
    .join(", ");
  throw new Error(
    `Ambiguous organization — your account belongs to multiple: ${choices}. Ask the user which one to use, then call this tool again with organizationId set to that value.`,
  );
}
