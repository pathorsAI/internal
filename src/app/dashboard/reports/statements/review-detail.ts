/**
 * 待處理清單每一筆的「內容」欄：引擎的 params 只放代號與數字，這裡補上人看得懂的來源描述
 * （交易對象＋摘要、發票號碼＋客戶、帳戶名稱）。純函式。
 */
import type { LedgerInputs, ReviewItem } from "@/lib/ledger/types";

export function reviewDetail(inputs: LedgerInputs, item: ReviewItem): string {
  const parts: string[] = [];
  const p = item.params;
  if (item.sourceType === "transaction" && item.sourceId !== null) {
    const txn = inputs.transactions.find((x) => x.id === item.sourceId);
    if (txn) {
      if (txn.partyId !== null && inputs.partyNames[txn.partyId]) parts.push(inputs.partyNames[txn.partyId]);
      if (txn.description) parts.push(txn.description);
      if (txn.currency !== inputs.settings.functionalCurrency) parts.push(`${txn.currency} ${txn.amount.toLocaleString("en-US")}`);
    }
  } else if (item.sourceType === "invoice" && item.sourceId !== null) {
    const inv = inputs.invoices.find((x) => x.id === item.sourceId);
    if (inv?.invoiceNumber) parts.push(inv.invoiceNumber);
    if (inv?.partyId != null && inputs.partyNames[inv.partyId]) parts.push(inputs.partyNames[inv.partyId]);
  }
  if (parts.length === 0) {
    for (const k of ["account", "invoiceNumber", "currency"]) {
      if (p[k] !== undefined && p[k] !== "") parts.push(String(p[k]));
    }
  }
  return parts.join(" · ");
}
