"use client";

import { useOptimistic, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Info, Link2, RefreshCw, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/form-field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type {
  IntegrationCatalogEntry,
  IntegrationField,
  IntegrationProviderId,
  IntegrationStatus,
} from "@/lib/integrations/types";
import {
  connectIntegration,
  disconnectIntegration,
  reconnectIntegration,
  setIntegrationEnabledAction,
} from "./actions";

/** server 交給 client 的一列：只有能顯示的東西，沒有任何憑證或密文。 */
export type IntegrationRowData = {
  id: IntegrationProviderId;
  logo: IntegrationCatalogEntry["logo"];
  credentialFields: IntegrationField[];
  configFields: IntegrationField[];
  /** registry 裡有沒有實作；沒有的話不能連接。 */
  implemented: boolean;
  connection: {
    enabled: boolean;
    status: IntegrationStatus;
    /** 已格式化的日期字串。 */
    connectedAt: string;
    connectedByName: string | null;
    lastSyncedAt: string | null;
    lastError: string | null;
  } | null;
};

type SheetTarget = { row: IntegrationRowData; mode: "connect" | "reconnect"; nonce: number };

export function IntegrationsList({
  rows,
  canManage,
  calendar,
}: Readonly<{
  rows: IntegrationRowData[];
  canManage: boolean;
  calendar: { connected: boolean; ownerLabel: string | null };
}>) {
  const t = useTranslations("integrations");
  const [target, setTarget] = useState<SheetTarget | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

  function openSheet(row: IntegrationRowData, mode: SheetTarget["mode"]) {
    // nonce 當 key：每次打開都是一張乾淨的表單，關閉時元件留著讓收合動畫跑完。
    setTarget((prev) => ({ row, mode, nonce: (prev?.nonce ?? 0) + 1 }));
    setSheetOpen(true);
  }

  return (
    <div className="space-y-3">
      {canManage ? null : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Info className="size-4 shrink-0" />
          {t("readOnlyNote")}
        </p>
      )}
      <ul className="divide-y rounded-lg border bg-card">
        {rows.map((row) => (
          <IntegrationRow
            key={row.id}
            row={row}
            canManage={canManage}
            onConnect={(mode) => openSheet(row, mode)}
          />
        ))}
        <CalendarRow connected={calendar.connected} ownerLabel={calendar.ownerLabel} />
      </ul>
      {target ? (
        <ConnectSheet
          key={target.nonce}
          target={target}
          open={sheetOpen}
          onOpenChange={setSheetOpen}
        />
      ) : null}
    </div>
  );
}

function LogoTile({ letter, className }: Readonly<{ letter: string; className: string }>) {
  return (
    <div
      aria-hidden
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-md text-base font-semibold",
        className,
      )}
    >
      {letter}
    </div>
  );
}

function IntegrationRow({
  row,
  canManage,
  onConnect,
}: Readonly<{
  row: IntegrationRowData;
  canManage: boolean;
  onConnect: (mode: SheetTarget["mode"]) => void;
}>) {
  const t = useTranslations("integrations");
  const name = t(`providers.${row.id}.name`);
  const c = row.connection;
  const [pending, start] = useTransition();
  const [optimisticEnabled, setOptimisticEnabled] = useOptimistic(c?.enabled ?? false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  function toggle(next: boolean) {
    start(async () => {
      setOptimisticEnabled(next);
      const res = await setIntegrationEnabledAction(row.id, next);
      if (!res.ok) toast.error(res.error ?? t("toast.failed"));
    });
  }

  function disconnect() {
    start(async () => {
      const res = await disconnectIntegration(row.id);
      if (!res.ok) {
        toast.error(res.error ?? t("toast.failed"));
        return;
      }
      setConfirmDisconnect(false);
    });
  }

  let statusLine: React.ReactNode;
  if (!c) {
    statusLine = <span>{t("status.notConnected")}</span>;
  } else if (c.status === "needs_reauth") {
    statusLine = (
      <span className="text-destructive">
        {t("status.needsReauth", { error: c.lastError ?? t("status.unknownError") })}
      </span>
    );
  } else if (c.status === "error") {
    statusLine = (
      <span className="text-destructive">
        {t("status.error", { error: c.lastError ?? t("status.unknownError") })}
      </span>
    );
  } else {
    statusLine = <span>{optimisticEnabled ? t("status.connected") : t("status.connectedOff")}</span>;
  }

  const meta: string[] = [];
  if (c) {
    meta.push(
      t("status.connectedBy", {
        name: c.connectedByName ?? t("status.unknownMember"),
        date: c.connectedAt,
      }),
    );
    if (c.lastSyncedAt) meta.push(t("status.lastSynced", { date: c.lastSyncedAt }));
  }

  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <LogoTile letter={row.logo.letter} className={row.logo.className} />
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium">{name}</p>
          <p className="text-sm text-muted-foreground">{statusLine}</p>
          {meta.length > 0 ? (
            <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t(`providers.${row.id}.description`)}</p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:justify-end">
        <Switch
          checked={optimisticEnabled}
          onCheckedChange={toggle}
          disabled={!canManage || !c || c.status !== "connected" || pending}
          aria-label={t("actions.toggleLabel", { name })}
          className="mr-2"
        />
        {canManage && !c ? (
          <div className="flex flex-col items-end gap-1">
            <Button type="button" size="sm" onClick={() => onConnect("connect")} disabled={!row.implemented}>
              <Link2 className="size-4" /> {t("actions.connect")}
            </Button>
            {row.implemented ? null : (
              <span className="text-xs text-muted-foreground">{t("notImplemented")}</span>
            )}
          </div>
        ) : null}
        {canManage && c ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={c.status === "connected" ? "outline" : "default"}
              onClick={() => onConnect("reconnect")}
              disabled={!row.implemented || pending}
            >
              <RefreshCw className="size-4" /> {t("actions.reconnect")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setConfirmDisconnect(true)}
              disabled={pending}
            >
              <Unlink className="size-4" /> {t("actions.disconnect")}
            </Button>
          </>
        ) : null}
      </div>

      <AlertDialog open={confirmDisconnect} onOpenChange={(o) => !pending && setConfirmDisconnect(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("disconnectConfirm.title", { name })}</AlertDialogTitle>
            <AlertDialogDescription>{t("disconnectConfirm.description", { name })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("disconnectConfirm.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={(e) => {
                // 等 server 回來再關，失敗時對話框留著。
                e.preventDefault();
                disconnect();
              }}
            >
              {t("disconnectConfirm.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

/**
 * Google 日曆不走 org_integrations（token 在 better-auth 的 account 表、設定在
 * calendar_settings），這裡只反映狀態，管理介面在同頁下方的 #google-calendar。
 */
function CalendarRow({
  connected,
  ownerLabel,
}: Readonly<{ connected: boolean; ownerLabel: string | null }>) {
  const t = useTranslations("integrations");
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <LogoTile letter="G" className="bg-blue-600 text-white" />
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium">{t("providers.googleCalendar.name")}</p>
          <p className="text-sm text-muted-foreground">
            {connected
              ? t("status.calendarConnected", { owner: ownerLabel ?? t("status.unknownMember") })
              : t("status.notConnected")}
          </p>
          <p className="text-xs text-muted-foreground">{t("providers.googleCalendar.description")}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:justify-end">
        <Button asChild size="sm" variant="outline">
          <Link href="#google-calendar">{t("actions.manage")}</Link>
        </Button>
      </div>
    </li>
  );
}

function inputType(type: IntegrationField["type"]): string {
  if (type === "email") return "email";
  if (type === "password" || type === "token") return "password";
  return "text";
}

function ConnectSheet({
  target,
  open,
  onOpenChange,
}: Readonly<{
  target: SheetTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const t = useTranslations("integrations");
  const { row, mode } = target;
  const name = t(`providers.${row.id}.name`);
  const fields = [...row.credentialFields, ...row.configFields];
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pending, start] = useTransition();
  const dirty = Object.values(values).some((v) => v !== "");

  function requestClose(next: boolean) {
    if (next) return;
    if (pending) return;
    if (dirty) {
      setConfirmDiscard(true);
      return;
    }
    onOpenChange(false);
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res =
        mode === "connect"
          ? await connectIntegration(row.id, values)
          : await reconnectIntegration(row.id, values);
      if (!res.ok) {
        setError(res.error ?? t("toast.failed"));
        return;
      }
      toast.success(mode === "connect" ? t("toast.connected", { name }) : t("toast.reconnected", { name }));
      onOpenChange(false);
    });
  }

  return (
    <>
      <Sheet open={open} onOpenChange={requestClose}>
        <SheetContent className="data-[side=right]:sm:max-w-md">
          <SheetHeader className="shrink-0">
            <SheetTitle className="flex items-center gap-2">
              <LogoTile letter={row.logo.letter} className={cn("size-7 text-sm", row.logo.className)} />
              {mode === "connect" ? t("sheet.connectTitle", { name }) : t("sheet.reconnectTitle", { name })}
            </SheetTitle>
            <SheetDescription>
              {mode === "connect" ? t("sheet.description") : t("sheet.reconnectDescription")}
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" autoComplete="off">
            <div className="flex-1 space-y-4 overflow-y-auto px-4">
              {fields.map((f) => {
                const id = `integration-${row.id}-${f.key}`;
                return (
                  <Field key={f.key} label={t(`fields.${f.labelKey}`)} htmlFor={id} required={f.required}>
                    <Input
                      id={id}
                      name={f.key}
                      type={inputType(f.type)}
                      required={f.required}
                      autoComplete={f.autoComplete}
                      spellCheck={false}
                      value={values[f.key] ?? ""}
                      onChange={(ev) => {
                        const v = ev.target.value;
                        setValues((prev) => ({ ...prev, [f.key]: v }));
                      }}
                      disabled={pending}
                    />
                  </Field>
                );
              })}
              <p className="text-xs text-muted-foreground">{t("sheet.securityNote")}</p>
              {error ? (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </div>
            <SheetFooter className="flex-row justify-end">
              <Button type="button" variant="outline" onClick={() => requestClose(false)} disabled={pending}>
                {t("sheet.cancel")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("sheet.submitting") : t("sheet.submit")}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>

      <AlertDialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("discard.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("discard.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("discard.keepEditing")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmDiscard(false);
                onOpenChange(false);
              }}
            >
              {t("discard.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
