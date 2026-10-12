import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { member } from "@/db/auth-schema";
import {
  bankAccounts,
  parties,
  paymentMethods,
  transactions,
  vendorBillingAccounts,
  vendorInvoices,
} from "@/db/schema";

// 廠商計費的跨表參照驗證 —— web server action 與 MCP 工具共用這一個入口。
//
// 這個 repo 是多租戶的：資料只靠 organization_id 隔離。寫入時帶進來的每一個 id（party、
// 付款方式、帳本帳戶、計費帳號、交易、負責人）都是呼叫端可控的，DB 的 FK 擋不住「別的
// 組織的合法 id」。所以寫入前一律先確認全部屬於同一個組織（且沒被軟刪除），否則整筆拒絕。
//
// 錯誤訊息刻意只說「找不到」，不說「屬於別的組織」—— 那等於幫人確認某個 id 存在。

export type OrgRefKind =
  | "party"
  | "paymentMethod"
  | "bankAccount"
  | "billingAccount"
  | "invoice"
  | "transaction"
  | "member";

export type OrgRefs = Partial<Record<OrgRefKind, readonly (number | string | null | undefined)[]>>;

/** 給一種參照、一批 id，回傳「確實屬於這個組織」的那些 id。 */
export type OrgRefLookup = (kind: OrgRefKind, ids: (number | string)[], orgId: string) => Promise<Set<number | string>>;

const LABELS: Record<OrgRefKind, string> = {
  party: "交易對象",
  paymentMethod: "付款方式",
  bankAccount: "帳本帳戶",
  billingAccount: "計費帳號",
  invoice: "帳單",
  transaction: "交易",
  member: "負責人",
};

export class OrgRefError extends Error {
  constructor(
    readonly kind: OrgRefKind,
    readonly id: number | string,
  ) {
    super(`找不到${LABELS[kind]} ${id}（不在這個組織裡或已刪除）`);
    this.name = "OrgRefError";
  }
}

function cleanIds(kind: OrgRefKind, ids: readonly (number | string | null | undefined)[]): (number | string)[] {
  const out: (number | string)[] = [];
  for (const id of ids) {
    if (id === null || id === undefined || id === "") continue;
    if (kind === "member") {
      if (typeof id !== "string") throw new OrgRefError(kind, String(id));
    } else if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
      // 非正整數一律當成找不到，不要拿去查 DB
      throw new OrgRefError(kind, String(id));
    }
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 驗證一組參照全部屬於 orgId。null / undefined（欄位留空）放行；任何一個不屬於就丟
 * OrgRefError。lookup 可注入（單元測試用假的），正式環境用 dbOrgRefLookup。
 */
export async function checkOrgRefs(lookup: OrgRefLookup, orgId: string, refs: OrgRefs): Promise<void> {
  if (!orgId) throw new Error("organization is required");
  const pending = (Object.entries(refs) as [OrgRefKind, OrgRefs[OrgRefKind]][])
    .map(([kind, ids]) => [kind, cleanIds(kind, ids ?? [])] as const)
    .filter(([, ids]) => ids.length > 0);
  const results = await Promise.all(pending.map(([kind, ids]) => lookup(kind, ids, orgId)));
  pending.forEach(([kind, ids], i) => {
    const owned = results[i];
    const missing = ids.find((id) => !owned.has(id));
    if (missing !== undefined) throw new OrgRefError(kind, missing);
  });
}

function nums(ids: (number | string)[]): number[] {
  return ids.filter((x): x is number => typeof x === "number");
}

/** 正式環境的 lookup：一種參照一個 `in (...)` 查詢。 */
export const dbOrgRefLookup: OrgRefLookup = async (kind, ids, orgId) => {
  const db = getDb();
  let rows: { id: number | string }[] = [];
  switch (kind) {
    case "party":
      rows = await db
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), inArray(parties.id, nums(ids)), isNull(parties.deletedAt)));
      break;
    case "paymentMethod":
      rows = await db
        .select({ id: paymentMethods.id })
        .from(paymentMethods)
        .where(
          and(
            eq(paymentMethods.organizationId, orgId),
            inArray(paymentMethods.id, nums(ids)),
            isNull(paymentMethods.deletedAt),
          ),
        );
      break;
    case "bankAccount":
      rows = await db
        .select({ id: bankAccounts.id })
        .from(bankAccounts)
        .where(
          and(eq(bankAccounts.organizationId, orgId), inArray(bankAccounts.id, nums(ids)), isNull(bankAccounts.deletedAt)),
        );
      break;
    case "billingAccount":
      rows = await db
        .select({ id: vendorBillingAccounts.id })
        .from(vendorBillingAccounts)
        .where(
          and(
            eq(vendorBillingAccounts.organizationId, orgId),
            inArray(vendorBillingAccounts.id, nums(ids)),
            isNull(vendorBillingAccounts.deletedAt),
          ),
        );
      break;
    case "invoice":
      rows = await db
        .select({ id: vendorInvoices.id })
        .from(vendorInvoices)
        .where(and(eq(vendorInvoices.organizationId, orgId), inArray(vendorInvoices.id, nums(ids))));
      break;
    case "transaction":
      rows = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(
          and(eq(transactions.organizationId, orgId), inArray(transactions.id, nums(ids)), isNull(transactions.deletedAt)),
        );
      break;
    case "member":
      rows = await db
        .select({ id: member.userId })
        .from(member)
        .where(
          and(
            eq(member.organizationId, orgId),
            inArray(
              member.userId,
              ids.filter((x): x is string => typeof x === "string"),
            ),
          ),
        );
      break;
  }
  return new Set(rows.map((r) => r.id));
};

/** 正式環境的入口：驗證失敗丟 OrgRefError。 */
export function assertOrgRefs(orgId: string, refs: OrgRefs): Promise<void> {
  return checkOrgRefs(dbOrgRefLookup, orgId, refs);
}

// ---------------------------------------------------------------------------
// 每種寫入會帶哪些參照（純函式，讓「有沒有漏驗」可以單元測試）
// ---------------------------------------------------------------------------

export function paymentMethodRefs(input: { id?: number | null; settlesFromAccountId?: number | null }): OrgRefs {
  return {
    paymentMethod: input.id ? [input.id] : [],
    bankAccount: [input.settlesFromAccountId],
  };
}

export function billingAccountRefs(input: {
  id?: number | null;
  partyId?: number | null;
  paymentMethodId?: number | null;
  ownerUserId?: string | null;
}): OrgRefs {
  return {
    billingAccount: input.id ? [input.id] : [],
    party: [input.partyId],
    paymentMethod: [input.paymentMethodId],
    member: [input.ownerUserId],
  };
}

export function invoiceResolutionRefs(input: { invoiceId: number; transactionId?: number | null }): OrgRefs {
  return {
    invoice: [input.invoiceId],
    transaction: [input.transactionId],
  };
}
