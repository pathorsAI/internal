import { eq } from "drizzle-orm";
import { getDb } from "./index";
import { organization } from "./auth-schema";
import { resolveTaxSetting, type TaxSetting } from "@/lib/tax-treatment";

/**
 * 組織的營業稅別預設（organization.tax_treatment / amount_basis，migrations/0040）。
 * 讀不到組織或欄位不合法就退回 DEFAULT_TAX_SETTING（應稅＋未稅）。
 *
 * 獨立成一支檔：queries.ts 與 mcp/shared.ts 都要用，放進 queries.ts 會造成 shared ↔ queries 循環 import。
 */
export async function getOrgTaxSetting(orgId: string): Promise<TaxSetting> {
  const [row] = await getDb()
    .select({ treatment: organization.taxTreatment, basis: organization.amountBasis })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return resolveTaxSetting({ org: row ?? null });
}
