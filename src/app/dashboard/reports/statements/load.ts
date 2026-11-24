/**
 * 頁面、列印、Excel 匯出共用的載入：讀總帳輸入、解析網址參數。
 * 組織一律由呼叫端從 session 取（requireOrg）後傳進來。
 */
import { loadLedgerInputs, todayInTaipei } from "@/db/ledger";
import { periodPresets } from "@/lib/ledger";
import type { LedgerInputs } from "@/lib/ledger/types";
import { parseStatementParams, type Preset, type StatementParams } from "./params";

export type StatementsContext = {
  inputs: LedgerInputs;
  today: string;
  presets: Preset[];
  params: StatementParams;
  /** 有沒有任何可入帳的資料（交易或手動分錄） */
  hasData: boolean;
  /** 營業稅年度選單 */
  years: number[];
};

export async function loadStatementsContext(
  orgId: string,
  raw: Record<string, string | string[] | undefined>,
): Promise<StatementsContext> {
  const inputs = await loadLedgerInputs(orgId);
  const today = todayInTaipei();
  const presets = periodPresets(today, inputs.settings.fiscalYearStartMonth) as Preset[];
  const params = parseStatementParams(raw, presets, today);

  const thisYear = Number(today.slice(0, 4));
  const firstYear = inputs.transactions.reduce(
    (min, t) => Math.min(min, Number(t.txnDate.slice(0, 4)) || thisYear),
    thisYear,
  );
  const years: number[] = [];
  for (let y = thisYear; y >= Math.max(firstYear, thisYear - 15); y -= 1) years.push(y);
  if (!years.includes(params.year)) years.push(params.year);

  return {
    inputs,
    today,
    presets,
    params,
    hasData: inputs.transactions.length > 0 || inputs.entries.length > 0,
    years: years.sort((a, b) => b - a),
  };
}
