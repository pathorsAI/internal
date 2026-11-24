// vendor_billing_accounts.meta / vendor_invoices.meta 的讀寫（純函式；client 與 server 都會用）。
//
//   meta.matchPartyIds: number[]     除了 party_id 之外「也比對這些廠商」—— 同一個帳號在帳本上
//                                    歷來記在不同對象（東蜂的 Azure 有時記「Azure」、有時「Microsoft」）
//   meta.billingAccountId            Azure：profile 所屬的 billing account
//   meta.masterBillingAccount        GCP：經銷商 master account；有值 → meta.reseller = true
//   meta.currency                    GCP：帳號幣別
//   meta.bookPromotionCredits        GCP：抵用點數記進管理帳（沒設 = 開；false = 停止新建，不刪既有的）
//   （帳單）meta.rejectedTransactionIds 人工解除過的交易，不再自動配給這張帳單

function positiveIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const v of raw) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}

/** 對帳用的廠商集合 = party_id ∪ matchPartyIds（沒有 party_id 也可以只靠 matchPartyIds）。 */
export function matchPartiesOf(account: { partyId: number | null; meta: Record<string, unknown> | null }): number[] {
  const ids = parseMatchPartyIds(account.meta);
  if (account.partyId !== null && !ids.includes(account.partyId)) ids.unshift(account.partyId);
  return ids;
}

export function parseMatchPartyIds(meta: Record<string, unknown> | null | undefined): number[] {
  return positiveIds(meta?.matchPartyIds);
}

/** vendor_invoices.meta.rejectedTransactionIds：人工解除過、不再自動配給這張帳單的交易。 */
export function parseRejectedTransactionIds(meta: Record<string, unknown> | null | undefined): number[] {
  return positiveIds(meta?.rejectedTransactionIds);
}

/** 解除綁定時加入拒絕清單；人工綁定時從清單拿掉。 */
export function withRejected(current: readonly number[], add: readonly (number | null)[], remove: number | null = null): number[] {
  const out = current.filter((id) => id !== remove);
  for (const id of add) if (id !== null && id !== remove && !out.includes(id)) out.push(id);
  return out;
}

export function isReseller(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.reseller === true || (typeof meta?.masterBillingAccount === "string" && meta.masterBillingAccount !== "");
}

/** 這個計費帳號的抵用點數要不要記進管理帳：只有 GCP 有點數；沒設過就是開。 */
export function booksPromotionCredits(provider: string, meta: Record<string, unknown> | null | undefined): boolean {
  return provider === "gcp" && meta?.bookPromotionCredits !== false;
}
