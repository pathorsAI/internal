// vendor_billing_accounts.meta 的讀寫（純函式；client 與 server 都會用）。
//
//   meta.matchPartyIds: number[]     除了 party_id 之外「也比對這些廠商」—— 同一個帳號在帳本上
//                                    歷來記在不同對象（東蜂的 Azure 有時記「Azure」、有時「Microsoft」）
//   meta.billingAccountId            Azure：profile 所屬的 billing account
//   meta.masterBillingAccount        GCP：經銷商 master account；有值 → meta.reseller = true
//   meta.currency                    GCP：帳號幣別

export function parseMatchPartyIds(meta: Record<string, unknown> | null | undefined): number[] {
  const raw = meta?.matchPartyIds;
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

export function isReseller(meta: Record<string, unknown> | null | undefined): boolean {
  return meta?.reseller === true || (typeof meta?.masterBillingAccount === "string" && meta.masterBillingAccount !== "");
}
