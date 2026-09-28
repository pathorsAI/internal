import { addDays, format, parseISO } from "date-fns";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { orgIntegrations } from "@/db/schema";
import { logSystem } from "@/db/activity";
import { runAsSystem } from "@/i18n/server-t";
import { syncSalaryDeclarations } from "@/lib/simpany-salary";
import { syncSimpanyInvoices, taipeiDate } from "@/lib/simpany-sync";
import { parseWiseConfig, syncWiseTransactions } from "@/lib/wise-sync";
import {
  isAutoSyncOn,
  supportsAutoSync,
  type AutoSyncTrigger,
  type LastAutoSync,
} from "./autosync-config";
import { IntegrationUnavailableError, recordSyncFailure, updateConfig } from "./store";
import type { IntegrationConfig, IntegrationProviderId } from "./types";

/**
 * 整合每日自動同步。
 *
 * 觸發：Cloudflare Cron Trigger（wrangler.jsonc `triggers.crons`，每天 22:00 UTC = 台北 06:00）
 * → worker.ts 的 `scheduled()` → 以一次性 token 呼叫本 Worker 的
 * `/api/cron/integrations-autosync` → `runScheduledSync()`。owner / admin 也可以在
 * 設定 › 整合 按「立即執行自動同步」、或用 MCP `run_integration_sync` 只跑自己的組織 ——
 * 三者走同一條程式碼路徑。
 *
 * 範圍：`enabled = true AND status = 'connected' AND config.autoSync !== false` 的每一列。
 *   - simpany → 發票同步（最近 90 天，台北日期）+ 薪資申報同步（今年；一月時連去年也跑）
 *   - wise    → 交易同步（dryRun: false）。去重靠 referenceNumber、永遠不早於切換日、
 *               新列一律標「待確認」，所以每天跑是安全的。
 *
 * 安全：這裡只呼叫「同步」—— 對 Simpany 只有讀（列表 / 明細 / 薪資申報 GET），
 * 永遠不開立、不作廢發票，也不碰任何 Simpany 寫入端點；對 Wise 只有 GET。
 *
 * 逐一、依序執行（不平行）：Simpany 是非官方 API，不要一次打太多。每個 組織 × 整合 各自
 * try/catch，一個失敗不影響其他；結果寫進 config.lastAutoSync，並在操作紀錄記一筆。
 */

/** Simpany 發票同步的回溯天數（與網頁「從 Simpany 同步」的預設一致）。 */
const INVOICE_LOOKBACK_DAYS = 90;

export type AutoSyncItemResult = {
  organizationId: string;
  provider: IntegrationProviderId;
  ok: boolean;
  summary: string;
  error: string | null;
  durationMs: number;
};

export type AutoSyncRunResult = {
  trigger: AutoSyncTrigger;
  startedAt: string;
  finishedAt: string;
  /** 符合條件（已開啟、狀態正常、自動同步沒關）而實際跑了的 組織 × 整合。 */
  results: AutoSyncItemResult[];
  /** 已開啟且正常，但 config.autoSync = false 而跳過的。 */
  skippedAutoSyncOff: { organizationId: string; provider: IntegrationProviderId }[];
};

/** 操作紀錄的寫法。預設是 system（cron）；手動觸發時由呼叫端記成 web / mcp 的那位成員。 */
export type AutoSyncAuditFn = (
  orgId: string,
  provider: IntegrationProviderId,
  ok: boolean,
  summary: string,
) => Promise<void>;

export type RunScheduledSyncOptions = {
  /** 只跑這個組織（手動觸發）。省略 = 全部組織（cron）。 */
  orgId?: string;
  trigger?: AutoSyncTrigger;
  audit?: AutoSyncAuditFn;
};

const systemAudit: AutoSyncAuditFn = async (orgId, provider, ok, summary) => {
  await logSystem(
    orgId,
    "update",
    "integration",
    null,
    `${provider}: 自動同步${ok ? "" : "失敗"}：${summary}`,
  );
};

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 這次要同步的日期與年份（全部以台北日曆為準）。 */
export function autoSyncWindow(now: Date): {
  startDate: string;
  endDate: string;
  salaryYears: number[];
} {
  const endDate = taipeiDate(now);
  const startDate = format(addDays(parseISO(endDate), -INVOICE_LOOKBACK_DAYS), "yyyy-MM-dd");
  const year = Number(endDate.slice(0, 4));
  const month = Number(endDate.slice(5, 7));
  // 一月時去年 12 月的薪資（次月 5 日發）可能才剛申報，去年也要再跑一次。
  const salaryYears = month === 1 ? [year - 1, year] : [year];
  return { startDate, endDate, salaryYears };
}

type StepOutcome = {
  ok: boolean;
  text: string;
  error: string | null;
  /** 失敗原因是「整合不可用」（剛被關掉、需要重新連接）—— 狀態本身已經說明，不再記 last_error。 */
  unavailable?: boolean;
};

async function step(label: string, fn: () => Promise<string>): Promise<StepOutcome> {
  try {
    return { ok: true, text: `${label}：${await fn()}`, error: null };
  } catch (e) {
    const msg = errorMessage(e);
    return {
      ok: false,
      text: `${label}：失敗（${msg}）`,
      error: msg,
      unavailable: e instanceof IntegrationUnavailableError,
    };
  }
}

async function syncSimpany(orgId: string, now: Date): Promise<StepOutcome[]> {
  const { startDate, endDate, salaryYears } = autoSyncWindow(now);
  const out: StepOutcome[] = [];
  out.push(
    await step(`發票 ${startDate}～${endDate}`, async () => {
      const r = await syncSimpanyInvoices(orgId, { startDate, endDate });
      const parts = [
        `讀到 ${r.seen} 張`,
        `新增 ${r.created}`,
        `更新 ${r.updated}`,
        `作廢 ${r.voided}`,
        `自動綁定 ${r.autoLinked.length}`,
        `待確認 ${r.needsReview.length}`,
      ];
      if (r.incomplete) parts.push("未抓完，明天會接著做");
      return parts.join("、");
    }),
  );
  // 發票那一步若是憑證被拒（整合已轉 needs_reauth），薪資一定也會失敗；照跑一次也只是
  // 再得到同一個「請重新連接」的錯誤，不會多打 Simpany（requireEnabledIntegration 先擋）。
  for (const year of salaryYears) {
    out.push(
      await step(`薪資申報 ${year}`, async () => {
        const r = await syncSalaryDeclarations(orgId, year);
        const parts = [`寫入 ${r.declarationsUpserted} 筆`];
        if (r.declarationsRemoved > 0) parts.push(`移除 ${r.declarationsRemoved} 筆`);
        if (r.unmatchedNames.length > 0) parts.push(`${r.unmatchedNames.length} 位對不到員工`);
        return parts.join("、");
      }),
    );
  }
  return out;
}

async function syncWise(orgId: string, config: IntegrationConfig): Promise<StepOutcome[]> {
  // 還沒設帳戶對應時 syncWiseTransactions 會丟「請先設定對應」—— 那不是失敗，是還沒設定；
  // 直接略過，也不打 Wise。
  const cfg = parseWiseConfig(config);
  if (!cfg.accountMappings.some((m) => m.bankAccountId !== null)) {
    return [{ ok: true, text: "交易：尚未設定 Wise 帳戶對應，略過", error: null }];
  }
  return [
    await step("交易", async () => {
      const r = await syncWiseTransactions(orgId, { dryRun: false });
      const parts = [
        `新增 ${r.totals.created} 筆（待確認）`,
        `已存在 ${r.totals.alreadySynced}`,
        `切換日前 ${r.totals.beforeCutover}`,
      ];
      if (r.skippedBalances.length > 0) {
        const reasons = r.skippedBalances.map((s) => `${s.currency} ${s.reason}`).join(", ");
        parts.push(`略過餘額 ${r.skippedBalances.length}（${reasons}）`);
      }
      return parts.join("、");
    }),
  ];
}

async function runOne(
  orgId: string,
  provider: IntegrationProviderId,
  config: IntegrationConfig,
  now: Date,
  trigger: AutoSyncTrigger,
  audit: AutoSyncAuditFn,
): Promise<AutoSyncItemResult> {
  const started = Date.now();
  let steps: StepOutcome[];
  try {
    steps = provider === "simpany" ? await syncSimpany(orgId, now) : await syncWise(orgId, config);
  } catch (e) {
    // step() 已經各自收斂錯誤，這裡只會接到真正意外的例外（例如 config 解析炸掉）。
    const msg = errorMessage(e);
    steps = [{ ok: false, text: `失敗（${msg}）`, error: msg }];
  }

  const ok = steps.every((s) => s.ok);
  const summary = steps.map((s) => s.text).join("；");
  const failed = steps.find((s) => !s.ok);
  const error = failed?.error ?? null;

  // provider 程式碼本身在 401 / 5xx 時已經 markNeedsReauth / recordSyncFailure；
  // 這裡補記的是「本地」失敗（寫 DB、解析…），那些不會經過 provider 的標記。
  // 整合不可用（剛被關掉、需要重新連接）時狀態已經說明一切，不再覆寫 last_error。
  if (failed && !failed.unavailable) {
    try {
      await recordSyncFailure(orgId, provider, `自動同步失敗：${error}`);
    } catch {
      // 記錄失敗不影響其他整合
    }
  }

  const last: LastAutoSync = {
    at: new Date().toISOString(),
    ok,
    summary,
    error,
    trigger,
  };
  try {
    await updateConfig(orgId, provider, { lastAutoSync: last });
  } catch (e) {
    console.error(`[autosync] ${orgId}/${provider}: failed to save lastAutoSync: ${errorMessage(e)}`);
  }
  try {
    await audit(orgId, provider, ok, summary);
  } catch {
    // 操作紀錄失敗不影響同步
  }

  return {
    organizationId: orgId,
    provider,
    ok,
    summary,
    error,
    durationMs: Date.now() - started,
  };
}

/**
 * 跑一輪自動同步。依 organization_id、provider 排序，逐一執行。
 * 永遠不丟錯（除了連列出整合都失敗 —— 那代表 DB 不通，讓呼叫端知道）。
 */
export async function runScheduledSync(
  now: Date = new Date(),
  opts: RunScheduledSyncOptions = {},
): Promise<AutoSyncRunResult> {
  const trigger = opts.trigger ?? "cron";
  const audit = opts.audit ?? systemAudit;
  return runAsSystem(async () => {
    const startedAt = new Date().toISOString();
    const where = opts.orgId
      ? and(
          eq(orgIntegrations.enabled, true),
          eq(orgIntegrations.status, "connected"),
          eq(orgIntegrations.organizationId, opts.orgId),
        )
      : and(eq(orgIntegrations.enabled, true), eq(orgIntegrations.status, "connected"));
    const rows = await getDb()
      .select({
        organizationId: orgIntegrations.organizationId,
        provider: orgIntegrations.provider,
        config: orgIntegrations.config,
      })
      .from(orgIntegrations)
      .where(where)
      .orderBy(asc(orgIntegrations.organizationId), asc(orgIntegrations.provider));

    const results: AutoSyncItemResult[] = [];
    const skippedAutoSyncOff: AutoSyncRunResult["skippedAutoSyncOff"] = [];
    for (const row of rows) {
      const provider = row.provider as IntegrationProviderId;
      if (!supportsAutoSync(provider)) continue;
      const config = (row.config ?? {}) as IntegrationConfig;
      if (!isAutoSyncOn(config)) {
        skippedAutoSyncOff.push({ organizationId: row.organizationId, provider });
        continue;
      }
      const r = await runOne(row.organizationId, provider, config, now, trigger, audit);
      console.log(
        `[autosync] ${r.organizationId}/${r.provider} ${r.ok ? "ok" : "FAILED"} ${r.durationMs}ms: ${r.summary}`,
      );
      results.push(r);
    }
    return { trigger, startedAt, finishedAt: new Date().toISOString(), results, skippedAutoSyncOff };
  });
}
