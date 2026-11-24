"use server";

import { loadLedgerInputs } from "@/db/ledger";
import { accountLedger } from "@/lib/ledger";
import type { LedgerKind, LedgerLine } from "@/lib/ledger/types";
import { requireOrg } from "@/lib/session";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export type AccountLedgerResult =
  | {
      ok: true;
      account: { id: number; code: string; name: string };
      period: { from: string; to: string };
      lines: LedgerLine[];
    }
  | { ok: false; error: "not_found" | "bad_request" };

/**
 * 下鑽：某科目某期間的分錄明細。組織一律從 session 取（requireOrg），科目也必須在這個組織的
 * 科目表裡 —— 不信任 client 傳來的 id。
 */
export async function fetchAccountLedger(input: {
  glAccountId: number;
  ledger: LedgerKind;
  from: string;
  to: string;
}): Promise<AccountLedgerResult> {
  const { orgId } = await requireOrg();
  const ledger: LedgerKind = input.ledger === "management" ? "management" : "government";
  if (!Number.isInteger(input.glAccountId) || !DATE_RE.test(input.from) || !DATE_RE.test(input.to)) {
    return { ok: false, error: "bad_request" };
  }
  const inputs = await loadLedgerInputs(orgId);
  const account = inputs.accounts.find((a) => a.id === input.glAccountId);
  if (!account) return { ok: false, error: "not_found" };

  const period = input.from <= input.to ? { from: input.from, to: input.to } : { from: input.to, to: input.from };
  return {
    ok: true,
    account: { id: account.id, code: account.code, name: account.name },
    period,
    lines: accountLedger(inputs, ledger, account.id, period),
  };
}
