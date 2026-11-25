/**
 * 待處理清單每一筆的「內容」欄：引擎的 params 只放代號與數字，這裡補上人看得懂的來源描述
 * （交易對象＋摘要、發票號碼＋客戶、帳戶名稱）。純函式。
 */
import type { LedgerInputs, ReviewItem } from "@/lib/ledger/types";

function transactionParts(inputs: LedgerInputs, id: number): string[] {
  const txn = inputs.transactions.find((x) => x.id === id);
  if (!txn) return [];
  const parts: string[] = [];
  if (txn.partyId !== null && inputs.partyNames[txn.partyId]) parts.push(inputs.partyNames[txn.partyId]);
  if (txn.description) parts.push(txn.description);
  if (txn.currency !== inputs.settings.functionalCurrency) parts.push(`${txn.currency} ${txn.amount.toLocaleString("en-US")}`);
  return parts;
}

function invoiceParts(inputs: LedgerInputs, id: number): string[] {
  const inv = inputs.invoices.find((x) => x.id === id);
  const parts: string[] = [];
  if (inv?.invoiceNumber) parts.push(inv.invoiceNumber);
  if (inv?.partyId != null && inputs.partyNames[inv.partyId]) parts.push(inputs.partyNames[inv.partyId]);
  return parts;
}

function sourceParts(inputs: LedgerInputs, item: ReviewItem): string[] {
  if (item.sourceId === null) return [];
  if (item.sourceType === "transaction") return transactionParts(inputs, item.sourceId);
  if (item.sourceType === "invoice") return invoiceParts(inputs, item.sourceId);
  return [];
}

/** 來源查不到東西時，退回 params 裡的帳戶／發票號碼／幣別。 */
function paramParts(params: ReviewItem["params"]): string[] {
  return ["account", "invoiceNumber", "currency"]
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .map((k) => String(params[k]));
}

export function reviewDetail(inputs: LedgerInputs, item: ReviewItem): string {
  const parts = sourceParts(inputs, item);
  return (parts.length === 0 ? paramParts(item.params) : parts).join(" · ");
}
