import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@/db";
import { transactions } from "@/db/schema";

/**
 * 收款分配（src/db/allocations.ts）寫入之後呼叫：這筆入帳已經被人拆分到應收上，歸屬定了，
 * 清掉連結層的待連結旗標（link_*）。party_similar 是對象的事，不動。
 *
 * 獨立一支檔、只依賴 schema：allocations.ts 被 mcp/shared.ts 用，而 write.ts 又經由 hints.ts
 * 用到 mcp/shared.ts，放在 write.ts 會變成循環 import。
 */
export async function clearLinkReviewForAllocated(db: Db, orgId: string, txnId: number): Promise<void> {
  await db
    .update(transactions)
    .set({ reviewReason: null, linkCandidates: null })
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.id, txnId),
        inArray(transactions.reviewReason, ["link_suggested", "link_ambiguous", "link_amount_mismatch"]),
      ),
    );
}
