"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { CalendarCheck, CalendarPlus, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { authClient } from "@/lib/auth-client";
import {
  connectCalendar,
  disconnectCalendarAction,
  syncCalendar,
  updateReminderDays,
  type CalendarActionState,
} from "./calendar-actions";

/**
 * 這本日曆建在「連結者」的 Google 帳號底下，本系統不會自動分享給其他成員 ——
 * 分享是 Google 日曆自己的功能，要在那邊設定。與其讓同事以為壞掉，不如講清楚。
 */
function SharingHint({ ownerLabel }: Readonly<{ ownerLabel: string | null }>) {
  const t = useTranslations("settings");
  const who = ownerLabel ?? t("calendar.linkerFallback");
  return (
    <p className="text-xs text-muted-foreground">
      {t("calendar.sharingHint", { owner: who })}
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
  const t = useTranslations("settings");

  function report(res: CalendarActionState, okMessage: string) {
    if (!res.ok) {
      toast.error(res.error ?? t("calendar.toast.operationFailed"));
      return;
    }
    const r = res.result;
    toast.success(
      r
        ? t("calendar.toast.resultSuffix", {
            okMessage,
            created: r.created,
            updated: r.updated,
            deleted: r.deleted,
          })
        : okMessage,
    );
    // 成功但有後續要處理（例如日曆刪不掉）→ 另外跳一則，不要混在成功訊息裡被忽略。
    if (res.notice) toast.warning(res.notice, { duration: 10000 });
  }
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
      if (error) toast.error(error.message ?? t("calendar.toast.authFailed"));
    });
  }

  function connect() {
    start(async () => report(await connectCalendar(), t("calendar.toast.connectedAndSynced")));
  }

  function sync() {
    start(async () => report(await syncCalendar(), t("calendar.toast.synced")));
  }

  function disconnect() {
    start(async () => report(await disconnectCalendarAction(), t("calendar.toast.disconnected")));
  }

  function saveDays() {
    const n = Number(days);
    start(async () => report(await updateReminderDays(n), t("calendar.toast.reminderUpdated")));
  }

  const intro = <p className="text-sm text-muted-foreground">{t("calendar.intro")}</p>;

  // 一般成員：看得到狀態、可以手動重推，但不能改連結與提醒設定。
  if (!canManage) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarCheck className="size-4" />
            {t("calendar.title")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {intro}
          {connected ? (
            <>
              <p className="text-sm">
                {t("calendar.connectedReadOnly", {
                  owner: ownerLabel ?? t("calendar.unknownOwner"),
                  days: reminderDays,
                })}
              </p>
              <Button type="button" onClick={sync} disabled={pending}>
                <RefreshCw className="size-4" /> {t("calendar.syncNow")}
              </Button>
              <SharingHint ownerLabel={ownerLabel} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("calendar.notConnected")}
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
          {t("calendar.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {intro}

        {(() => {
          if (connected) {
            return (
              <>
                <p className="text-sm">
                  {t("calendar.connectedManage", {
                    owner: ownerLabel ?? t("calendar.unknownOwner"),
                    youSuffix: isOwner ? t("calendar.you") : "",
                  })}
                </p>

                <div className="flex flex-wrap items-end gap-2">
                  <Field label={t("calendar.reminderDaysLabel")} htmlFor="reminder-days">
                    <Input
                      id="reminder-days"
                      type="number"
                      min="0"
                      max="60"
                      value={days}
                      onChange={(e) => setDays(e.target.value)}
                      className="w-28"
                    />
                  </Field>
                  <Button type="button" variant="outline" onClick={saveDays} disabled={pending}>
                    {t("calendar.saveAndResync")}
                  </Button>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={sync} disabled={pending}>
                    <RefreshCw className="size-4" /> {t("calendar.syncNow")}
                  </Button>
                  <Button type="button" variant="outline" onClick={disconnect} disabled={pending}>
                    <Unlink className="size-4" /> {t("calendar.disconnect")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("calendar.disconnectNote", { owner: ownerLabel ?? t("calendar.linkerFallback") })}
                  {isOwner ? "" : t("calendar.switchNote")}
                </p>
                <SharingHint ownerLabel={ownerLabel} />
              </>
            );
          }
          if (!granted) {
            return (
              <div className="space-y-2">
                <Button type="button" onClick={grant} disabled={pending}>
                  <CalendarPlus className="size-4" /> {t("calendar.grant")}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {t("calendar.grantNote")}
                </p>
              </div>
            );
          }
          return (
            <div className="space-y-2">
              <Button type="button" onClick={connect} disabled={pending}>
                <CalendarCheck className="size-4" /> {t("calendar.connect")}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t("calendar.connectNote")}
              </p>
            </div>
          );
        })()}
      </CardContent>
    </Card>
  );
}
