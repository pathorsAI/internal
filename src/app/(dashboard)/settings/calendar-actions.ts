"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { requireOrg } from "@/lib/session";
import { logWeb } from "@/db/activity";
import {
  CalendarNotConnectedError,
  disconnectCalendar,
  setCalendarOwner,
  setReminderDays,
  syncBillingCalendar,
  type CalendarSyncResult,
} from "@/lib/google-calendar";

export type CalendarActionState = {
  ok: boolean;
  error?: string;
  result?: CalendarSyncResult;
};

/** 目前組織的名稱，拿來當日曆標題。 */
async function activeOrgName(orgId: string): Promise<string> {
  const orgs = await auth.api.listOrganizations({ headers: await headers() });
  return orgs?.find((o) => o.id === orgId)?.name ?? "組織";
}

/**
 * 把這位使用者設為「用他的授權推事件」，並立刻做一次全量同步。
 * 授權本身是在瀏覽器端用 authClient.oauth2.link() 完成的，這裡只負責記錄與同步。
 */
export async function connectCalendar(): Promise<CalendarActionState> {
  try {
    const { orgId, userId } = await requireOrg();
    await setCalendarOwner(orgId, userId);
    const result = await syncBillingCalendar(orgId, await activeOrgName(orgId));
    await logWeb(orgId, "update", "calendar", null, "連結 Google 日曆");
    revalidatePath("/settings");
    revalidatePath("/billing");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "連結失敗" };
  }
}

/** 手動全量對帳（看板與設定頁的「同步到 Google 日曆」按鈕）。 */
export async function syncCalendar(): Promise<CalendarActionState> {
  try {
    const { orgId } = await requireOrg();
    const result = await syncBillingCalendar(orgId, await activeOrgName(orgId));
    await logWeb(orgId, "update", "calendar", null, "同步 Google 日曆");
    revalidatePath("/billing");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "同步失敗" };
  }
}

export async function disconnectCalendarAction(): Promise<CalendarActionState> {
  try {
    const { orgId } = await requireOrg();
    await disconnectCalendar(orgId);
    await logWeb(orgId, "update", "calendar", null, "中斷 Google 日曆連結");
    revalidatePath("/settings");
    revalidatePath("/billing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "中斷連結失敗" };
  }
}

export async function updateReminderDays(days: number): Promise<CalendarActionState> {
  if (!Number.isInteger(days) || days < 0 || days > 60) {
    return { ok: false, error: "提前天數需介於 0 到 60" };
  }
  try {
    const { orgId } = await requireOrg();
    await setReminderDays(orgId, days);
    // 提醒時間變了，既有事件要重推一次才會生效。
    const result = await syncBillingCalendar(orgId, await activeOrgName(orgId));
    revalidatePath("/settings");
    return { ok: true, result };
  } catch (e) {
    if (e instanceof CalendarNotConnectedError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "更新失敗" };
  }
}
