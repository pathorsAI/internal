"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { canManageOrg, requireOrg, requireOrgWithRole } from "@/lib/session";
import { logWeb } from "@/db/activity";
import {
  CalendarNotConnectedError,
  disconnectCalendar,
  getCalendarOwnerLabel,
  getCalendarSettings,
  setCalendarOwner,
  setReminderDays,
  syncBillingCalendar,
  type CalendarSyncResult,
} from "@/lib/google-calendar";

export type CalendarActionState = {
  ok: boolean;
  error?: string;
  /** 成功但有話要說（例如日曆刪不掉，要人工去 Google 端處理）。 */
  notice?: string;
  result?: CalendarSyncResult;
};

const NOT_ALLOWED = "只有組織的擁有者或管理員可以設定 Google 日曆";

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
    const { orgId, userId, role } = await requireOrgWithRole();
    if (!canManageOrg(role)) return { ok: false, error: NOT_ALLOWED };

    // 一個組織同時只允許一個連結。不擋的話，第二個人按下去會靜默把 owner 換成自己，
    // 而舊 owner 帳號裡那本日曆會變成沒人維護的孤兒（見 disconnectCalendar 的說明）。
    //
    // 只有「日曆真的建起來了」才擋。若上一次連結在建立日曆前就失敗（token 當場失效
    // 之類），Google 那邊沒有東西會變成孤兒，此時該讓別人直接接手 —— 否則設定頁會
    // 顯示成未連結、沒有「中斷連結」按鈕，卻又連不下去，變成死結。
    const existing = await getCalendarSettings(orgId);
    if (existing?.ownerUserId && existing.googleCalendarId && existing.ownerUserId !== userId) {
      const who = (await getCalendarOwnerLabel(orgId)) ?? "另一位成員";
      return {
        ok: false,
        error: `已由 ${who} 連結。要改用你的帳號的話，請先按「中斷連結」。`,
      };
    }

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

/**
 * 手動全量對帳（看板與設定頁的「同步到 Google 日曆」按鈕）。
 *
 * 這個刻意「不」限 owner/admin：同步只是把看板現況重推一次，用的還是連結者的授權，
 * 不會改到任何設定。一般成員改完請款日期後想立刻讓提醒生效，不該還要去找管理員。
 */
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
    const { orgId, role } = await requireOrgWithRole();
    if (!canManageOrg(role)) return { ok: false, error: NOT_ALLOWED };

    const { calendarRemoved } = await disconnectCalendar(orgId);
    await logWeb(orgId, "update", "calendar", null, "中斷 Google 日曆連結");
    revalidatePath("/settings");
    revalidatePath("/billing");
    return {
      ok: true,
      notice: calendarRemoved
        ? undefined
        : "Google 授權已失效，那本「請款提醒」日曆刪不掉，請自行到 Google 日曆移除。",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "中斷連結失敗" };
  }
}

export async function updateReminderDays(days: number): Promise<CalendarActionState> {
  if (!Number.isInteger(days) || days < 0 || days > 60) {
    return { ok: false, error: "提前天數需介於 0 到 60" };
  }
  try {
    const { orgId, role } = await requireOrgWithRole();
    if (!canManageOrg(role)) return { ok: false, error: NOT_ALLOWED };
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
