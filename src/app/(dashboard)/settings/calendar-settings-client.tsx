"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarCheck, CalendarPlus, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";
import {
  connectCalendar,
  disconnectCalendarAction,
  syncCalendar,
  updateReminderDays,
  type CalendarActionState,
} from "./calendar-actions";

function report(res: CalendarActionState, okMessage: string) {
  if (!res.ok) {
    toast.error(res.error ?? "操作失敗");
    return;
  }
  const r = res.result;
  toast.success(
    r ? `${okMessage}（新增 ${r.created}、更新 ${r.updated}、移除 ${r.deleted}）` : okMessage,
  );
  // 成功但有後續要處理（例如日曆刪不掉）→ 另外跳一則，不要混在成功訊息裡被忽略。
  if (res.notice) toast.warning(res.notice, { duration: 10000 });
}

/**
 * 這本日曆建在「連結者」的 Google 帳號底下，本系統不會自動分享給其他成員 ——
 * 分享是 Google 日曆自己的功能，要在那邊設定。與其讓同事以為壞掉，不如講清楚。
 */
function SharingHint({ ownerLabel }: Readonly<{ ownerLabel: string | null }>) {
  const who = ownerLabel ?? "連結者";
  return (
    <p className="text-xs text-muted-foreground">
      這本日曆建在 {who} 的 Google 帳號底下，其他成員預設看不到。要讓同事也收到提醒，
      請 {who} 到 Google 日曆找到「請款提醒 · 組織名」，用「設定與共用」把日曆分享給他們
      —— 這要在 Google 日曆那邊做，本系統不會代為分享。
    </p>
  );
}

export function CalendarSettingsClient({
  connected,
  granted,
  reminderDays,
  canManage,
  ownerLabel,
  isOwner,
}: Readonly<{
  connected: boolean;
  granted: boolean;
  reminderDays: number;
  canManage: boolean;
  ownerLabel: string | null;
  isOwner: boolean;
}>) {
  const [pending, start] = useTransition();
  const [days, setDays] = useState(String(reminderDays));

  /**
   * 先跳 Google 授權（要到 calendar 權限），回來後才把自己設為日曆擁有者並同步。
   * 授權完成會導回 /settings，使用者再按一次「連結並同步」即可 —— 這裡不自動接續，
   * 因為 OAuth 是整頁跳轉，回來後元件已重新掛載。
   */
  function grant() {
    start(async () => {
      const { error } = await authClient.oauth2.link({
        providerId: "google-calendar",
        callbackURL: "/settings",
      });
      if (error) toast.error(error.message ?? "授權失敗");
    });
  }

  function connect() {
    start(async () => report(await connectCalendar(), "已連結並同步"));
  }

  function sync() {
    start(async () => report(await syncCalendar(), "已同步"));
  }

  function disconnect() {
    start(async () => report(await disconnectCalendarAction(), "已中斷連結"));
  }

  function saveDays() {
    const n = Number(days);
    start(async () => report(await updateReminderDays(n), "已更新提醒設定"));
  }

  const intro = (
    <p className="text-sm text-muted-foreground">
      把請款、收款與開發票的日期推到一本名為「請款提醒 ·
      組織名」的專屬子日曆，提醒由 Google 自己發送。已收款、已開發票的項目會自動從日曆移除。
      一個組織同時只會有一個連結。
    </p>
  );

  // 一般成員：看得到狀態、可以手動重推，但不能改連結與提醒設定。
  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="size-4" />
            Google 日曆
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {intro}
          {connected ? (
            <>
              <p className="text-sm">
                目前由 <span className="font-medium">{ownerLabel ?? "某位成員"}</span> 連結，
                提前 {reminderDays} 天提醒。
              </p>
              <Button type="button" onClick={sync} disabled={pending}>
                <RefreshCw className="size-4" /> 立即同步
              </Button>
              <SharingHint ownerLabel={ownerLabel} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              尚未連結。連結需要組織的擁有者或管理員來設定。
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarCheck className="size-4" />
          Google 日曆
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {intro}

        {(() => {
          if (connected) {
            return (
              <>
                <p className="text-sm">
                  目前由 <span className="font-medium">{ownerLabel ?? "某位成員"}</span>
                  {isOwner ? "（你）" : ""} 連結。
                </p>

                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="reminder-days">提前幾天提醒</Label>
                    <Input
                      id="reminder-days"
                      type="number"
                      min="0"
                      max="60"
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      className="w-28"
                    />
                  </div>
                  <Button type="button" variant="outline" onClick={saveDays} disabled={pending}>
                    儲存並重推
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={sync} disabled={pending}>
                    <RefreshCw className="size-4" /> 立即同步
                  </Button>
                  <Button type="button" variant="outline" onClick={disconnect} disabled={pending}>
                    <Unlink className="size-4" /> 中斷連結
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  中斷連結會一併刪除 Google 上那本「請款提醒」日曆與裡面的事件 ——
                  否則它會留在 {ownerLabel ?? "連結者"} 的帳號裡，不再更新也不再移除，
                  訂閱的人會一直看到早就處理完的提醒。
                  {isOwner ? "" : " 要改用你的帳號連結，請先中斷再重新連結。"}
                </p>
                <SharingHint ownerLabel={ownerLabel} />
              </>
            );
          }
          if (!granted) {
            return (
              <div className="space-y-2">
                <Button type="button" onClick={grant} disabled={pending}>
                  <CalendarPlus className="size-4" /> 授權 Google 日曆
                </Button>
                <p className="text-xs text-muted-foreground">
                  會另外跳一次 Google 同意畫面索取日曆權限；登入用的授權不受影響。
                </p>
              </div>
            );
          }
          return (
            <div className="space-y-2">
              <Button type="button" onClick={connect} disabled={pending}>
                <CalendarCheck className="size-4" /> 連結並同步
              </Button>
              <p className="text-xs text-muted-foreground">
                已取得日曆權限，按下後會用你的帳號建立專屬日曆並推入目前所有待辦。
              </p>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
