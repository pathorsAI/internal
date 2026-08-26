/**
 * 「交易幣別必須等於它所屬銀行帳戶的幣別」這條規則的唯一實作。
 *
 * 為什麼要有這條規則：美金帳戶裡如果混進一筆台幣交易，餘額、對帳、報表全部會
 * 算錯——系統刻意不做匯率換算（見 src/lib/currency.ts），不同幣別是分開加總的，
 * 所以一筆記錯幣別的交易不會被任何地方察覺，只會讓數字默默失真。
 *
 * 這裡只負責「查帳戶幣別 + 比對」，不負責錯誤訊息的呈現：
 *   - server action（src/db/mutations.ts）要 i18n 過的字串塞回 ActionState.error；
 *   - MCP 工具（src/lib/mcp/*）走 `throw new Error(...)`，英文即可。
 * 兩邊各自包裝 `findAccountCurrencyMismatches` 的結果，格式各自照自己的慣例。
 *
 * 為什麼不放在 src/lib/currency.ts：那支是純 data/util，被 client component
 * （CurrencySelect 等）直接 import，不能把 drizzle 與 DB 連線拖進 client bundle。
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import type { getDb } from "@/db";
import { bankAccounts } from "@/db/schema";

type Db = ReturnType<typeof getDb>;

/** 一筆「帳戶幣別 ≠ 交易幣別」的違規。 */
export type AccountCurrencyMismatch = {
  accountId: number;
  accountName: string;
  /** 帳戶登記的幣別（大寫 ISO 代碼）。 */
  accountCurrency: string;
  /** 這筆交易想記的幣別（大寫 ISO 代碼）。 */
  txnCurrency: string;
};

function norm(code: string | null | undefined): string {
  return (code ?? "").trim().toUpperCase();
}

/** 去掉 null/undefined 與重複，回傳要查的帳戶 id。 */
function accountIdsOf(ids: readonly (number | null | undefined)[]): number[] {
  return [...new Set(ids.filter((id): id is number => typeof id === "number"))];
}

/**
 * 查出這些帳戶（**限定 orgId**，比照本 repo 其他查詢的慣例）的幣別，
 * 回傳與 `currency` 不符的清單；全部相符時回傳空陣列。
 *
 * 找不到的帳戶（不屬於這個 org、或已刪除）不在這裡報錯：帳戶歸屬的驗證是
 * 各呼叫端既有的職責（server action 的 resolveTxnFields／MCP 的 assertInOrg），
 * 這支只做幣別這一件事，不去搶那個錯誤訊息。
 */
export async function findAccountCurrencyMismatches(
  db: Db,
  orgId: string,
  currency: string,
  accountIds: readonly (number | null | undefined)[],
): Promise<AccountCurrencyMismatch[]> {
  const ids = accountIdsOf(accountIds);
  if (ids.length === 0) return [];
  const txnCurrency = norm(currency);
  if (!txnCurrency) return [];

  const rows = await db
    .select({ id: bankAccounts.id, name: bankAccounts.name, currency: bankAccounts.currency })
    .from(bankAccounts)
    .where(
      and(
        eq(bankAccounts.organizationId, orgId),
        inArray(bankAccounts.id, ids),
        isNull(bankAccounts.deletedAt),
      ),
    );

  return rows
    .filter((r) => norm(r.currency) !== txnCurrency)
    .map((r) => ({
      accountId: r.id,
      accountName: r.name,
      accountCurrency: norm(r.currency),
      txnCurrency,
    }));
}

/** 給 MCP 工具用的英文訊息（handler 會把 throw 包成 isError 回給模型）。 */
export function accountCurrencyErrorMessage(m: AccountCurrencyMismatch): string {
  return (
    `Account "${m.accountName}" (#${m.accountId}) is a ${m.accountCurrency} account, so it cannot ` +
    `hold a ${m.txnCurrency} transaction — a transaction's currency must match the currency of the ` +
    `bank account it is booked against. Use a ${m.accountCurrency} account, or set currency to ` +
    `${m.accountCurrency}.`
  );
}

/**
 * MCP 工具用：任一帳戶幣別不符就 throw。
 * `prefix` 讓批次工具能標出是第幾筆（例如 "items[3]: "）。
 */
export async function assertAccountCurrency(
  db: Db,
  orgId: string,
  currency: string,
  accountIds: readonly (number | null | undefined)[],
  prefix = "",
): Promise<void> {
  const [bad] = await findAccountCurrencyMismatches(db, orgId, currency, accountIds);
  if (!bad) return;
  throw new Error(`${prefix}${accountCurrencyErrorMessage(bad)}`);
}

/** 批次驗證用：預先載入的帳戶（id → 名稱＋幣別）。 */
export type AccountCurrencyRef = { id: number; name: string; currency: string };

/**
 * 同步版：拿已經載好的帳戶表比對，避免每一列各發一次 query。
 * 給 bulk_create_transactions 這種一次寫上千列的路徑用。
 */
export function findMismatchInMap(
  byId: ReadonlyMap<number, AccountCurrencyRef>,
  currency: string,
  accountIds: readonly (number | null | undefined)[],
): AccountCurrencyMismatch | null {
  const txnCurrency = norm(currency);
  if (!txnCurrency) return null;
  for (const id of accountIdsOf(accountIds)) {
    const acct = byId.get(id);
    if (!acct) continue; // 帳戶歸屬由呼叫端既有的檢查負責
    const accountCurrency = norm(acct.currency);
    if (accountCurrency !== txnCurrency) {
      return { accountId: acct.id, accountName: acct.name, accountCurrency, txnCurrency };
    }
  }
  return null;
}
