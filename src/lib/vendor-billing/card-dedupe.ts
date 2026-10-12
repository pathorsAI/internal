// Azure 同步到一張卡時，要不要沿用使用者先前手動建立的同一張卡（純函式；sync.ts 用）。
//
//   1. 已經有同一個 Azure id 的付款方式 → 更新它（upsert）。
//   2. 沒有 → 找同組織、未刪除、kind = card、external_ref 是空的、卡別（不分大小寫）/ 末四碼 /
//      到期月 / 到期年都相同的手動卡：
//        - 剛好一張 → 收編（adopt）：改成 source azure、填上 Azure id；名稱、扣款帳戶、備註保留人填的。
//        - 沒有     → 新建（upsert）。
//        - 多張     → 不新建、帳號也不綁任何一張（conflict），頁面提醒「多張卡資料相同，請合併」。

export type CardFacts = {
  brand: string | null;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
};

export type ExistingPaymentMethod = CardFacts & {
  id: number;
  kind: string;
  source: string;
  externalRef: string | null;
};

export type CardSyncPlan =
  | { action: "upsert" }
  | { action: "adopt"; id: number }
  | { action: "conflict"; ids: number[] };

const norm = (v: string | null) => (v ?? "").trim().toLowerCase();

/** 卡的事實完全相同（卡別不分大小寫；末四碼必須有值）。 */
export function sameCard(a: CardFacts, b: CardFacts): boolean {
  return (
    a.last4 !== null &&
    a.last4 === b.last4 &&
    norm(a.brand) === norm(b.brand) &&
    a.expiryMonth === b.expiryMonth &&
    a.expiryYear === b.expiryYear
  );
}

/** existing = 本組織所有未刪除的付款方式。 */
export function planCardSync(
  card: CardFacts & { externalRef: string; kind: string },
  existing: readonly ExistingPaymentMethod[],
): CardSyncPlan {
  if (existing.some((p) => p.source === "azure" && p.externalRef === card.externalRef)) return { action: "upsert" };
  if (card.kind !== "card" || card.last4 === null) return { action: "upsert" };
  const matches = existing.filter((p) => p.kind === "card" && p.externalRef === null && sameCard(p, card));
  if (matches.length === 1) return { action: "adopt", id: matches[0].id };
  if (matches.length > 1) return { action: "conflict", ids: matches.map((p) => p.id) };
  return { action: "upsert" };
}
