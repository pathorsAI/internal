import { and, eq, isNull } from "drizzle-orm";
import type { getDb } from "./index";
import { transactions } from "./schema";

/**
 * 這筆代墊是不是已經有撥款（未刪除的 reimbursement，related_to_id 指回它）。
 * web 的記錄撥款與 MCP create_reimbursement 共用，避免同一筆代墊被還兩次。
 */
export async function hasReimbursement(
  db: ReturnType<typeof getDb>,
  orgId: string,
  advanceId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.relatedToId, advanceId),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1);
  return row !== undefined;
}
