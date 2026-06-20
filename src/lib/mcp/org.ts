import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { member } from "@/db/auth-schema";

/**
 * Resolve which organization an MCP request should operate on.
 *
 * The OAuth access token only carries a userId (there is no cookie session and
 * thus no activeOrganizationId), so we scope by the user's membership — matching
 * the session-creation hook in src/lib/auth.ts. If the user belongs to multiple
 * orgs, tools accept an optional `organizationId` arg that is validated here.
 */
export async function resolveOrgId(
  userId: string,
  requestedOrgId?: string,
): Promise<string> {
  const db = getDb();

  if (requestedOrgId) {
    const rows = await db
      .select({ organizationId: member.organizationId })
      .from(member)
      .where(
        and(eq(member.userId, userId), eq(member.organizationId, requestedOrgId)),
      )
      .limit(1);
    if (!rows[0]) {
      throw new Error(
        `You are not a member of organization "${requestedOrgId}".`,
      );
    }
    return requestedOrgId;
  }

  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId))
    .limit(1);
  if (!rows[0]) {
    throw new Error("No organization is associated with your account.");
  }
  return rows[0].organizationId;
}
