"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { logWeb } from "@/db/activity";
import { runScheduledSync } from "@/lib/integrations/autosync";
import {
  connectIntegrationForOrg,
  disconnectIntegrationForOrg,
  IntegrationSettingsError,
  setIntegrationAutoSyncForOrg,
  setIntegrationEnabledForOrg,
  type SettingsActor,
} from "@/lib/integrations/settings-service";

/**
 * 設定 › 整合 的 server actions。全部限 owner / admin ——
 * 隱藏按鈕擋得住誤按，擋不住直接呼叫 action，所以每一支都在這裡再檢查一次角色。
 *
 * 業務邏輯在 src/lib/integrations/settings-service.ts，MCP／REST 工具共用同一份；
 * 這裡只負責驗 session、角色，並把操作紀錄記成 channel = web。
 *
 * 回傳值永遠不含憑證：失敗只回錯誤訊息，成功只回 ok。畫面上的狀態靠 revalidatePath
 * 重新渲染 server component 取得（那邊讀的是 IntegrationSummary，型別上就沒有密文）。
 */

export type IntegrationActionState = {
  ok: boolean;
  error?: string;
};

const PAGE = "/dashboard/settings/integrations";

type Manager = { orgId: string; userId: string };

async function requireManager(): Promise<Manager | { error: string }> {
  const t = await getTranslations("integrations");
  const { orgId, userId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId, userId };
}

function webActor(me: Manager): SettingsActor {
  return {
    ...me,
    log: (action, entityType, entityId, summary) => logWeb(me.orgId, action, entityType, entityId, summary),
  };
}

/** 跑一支 service 函式：成功 revalidate 並回 ok，失敗收斂成錯誤字串。 */
async function run(fn: (actor: SettingsActor) => Promise<unknown>): Promise<IntegrationActionState> {
  const t = await getTranslations("integrations");
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    await fn(webActor(me));
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    if (e instanceof IntegrationSettingsError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}

/**
 * 連接：驗必填 → provider.testConnection 實測 → 加密存入，enabled = false。
 * 若這個組織其實已經連接過（兩個分頁同時操作），行為等同重新連接：保留開關狀態。
 */
export async function connectIntegration(
  provider: string,
  values: Record<string, string>,
): Promise<IntegrationActionState> {
  return run((actor) => connectIntegrationForOrg(actor, provider, values, { mode: "connect" }));
}

/** 重新連接：同連接，但保留原本的 enabled，並把狀態恢復為 connected。 */
export async function reconnectIntegration(
  provider: string,
  values: Record<string, string>,
): Promise<IntegrationActionState> {
  return run((actor) => connectIntegrationForOrg(actor, provider, values, { mode: "reconnect" }));
}

/** 開 / 關。開啟只允許在 status = connected 時；關閉永遠允許。 */
export async function setIntegrationEnabledAction(
  provider: string,
  enabled: boolean,
): Promise<IntegrationActionState> {
  return run((actor) => setIntegrationEnabledForOrg(actor, provider, enabled));
}

/** 中斷連接 = 刪列（連同加密憑證與 token）。 */
export async function disconnectIntegration(provider: string): Promise<IntegrationActionState> {
  return run((actor) => disconnectIntegrationForOrg(actor, provider));
}

/** 每日自動同步的開關（config.autoSync）。沒存 = 開；關掉存 false。 */
export async function setIntegrationAutoSyncAction(
  provider: string,
  autoSync: boolean,
): Promise<IntegrationActionState> {
  return run((actor) => setIntegrationAutoSyncForOrg(actor, provider, autoSync));
}

export type RunAutoSyncState = IntegrationActionState & {
  /** 實際跑了幾個 / 失敗幾個（跑了 0 個 = 沒有符合條件的整合）。 */
  ran?: number;
  failed?: number;
};

/**
 * 「立即執行自動同步」：只跑目前組織，走跟每日 cron 完全相同的 runScheduledSync。
 * 給 owner / admin 測試用；操作紀錄記成按下按鈕的這位成員（channel = web），不是 system。
 */
export async function runAutoSyncNowAction(): Promise<RunAutoSyncState> {
  const t = await getTranslations("integrations");
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const run = await runScheduledSync(new Date(), {
      orgId: me.orgId,
      trigger: "manual",
      audit: async (orgId, provider, ok, summary) => {
        await logWeb(
          orgId,
          "update",
          "integration",
          null,
          t("activity.autoSyncRun", {
            name: t(`providers.${provider}.name`),
            result: ok ? t("activity.autoSyncOk") : t("activity.autoSyncFailed"),
            summary,
          }),
        );
      },
    });
    revalidatePath(PAGE);
    return {
      ok: true,
      ran: run.results.length,
      failed: run.results.filter((r) => !r.ok).length,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}
