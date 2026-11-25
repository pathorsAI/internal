"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { formatDateTime } from "@/lib/format";
import { toast } from "sonner";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { StatusTag } from "@/components/ds/status-dot";
import { activityDetailAction, undoActivityAction, type ActivityDetail } from "./actions";

/** 哪一筆的細節開著；列與「已復原 #id」連結都透過它打開 Sheet。 */
const OpenContext = createContext<(id: number) => void>(() => {});

export function ActivityDetailProvider({ children }: Readonly<{ children: React.ReactNode }>) {
  const [openId, setOpenId] = useState<number | null>(null);
  const open = useCallback((id: number) => setOpenId(id), []);
  return (
    <OpenContext.Provider value={open}>
      {children}
      <ActivitySheet id={openId} onClose={() => setOpenId(null)} onOpen={open} />
    </OpenContext.Provider>
  );
}

/** 整列可點，點了開細節（設計規範：開 Sheet 的列整列可點）。 */
export function ActivityRow({ id, children }: Readonly<{ id: number; children: React.ReactNode }>) {
  const open = useContext(OpenContext);
  return (
    <TableRow
      className="cursor-pointer"
      tabIndex={0}
      onClick={() => open(id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          open(id);
        }
      }}
    >
      {children}
    </TableRow>
  );
}

/** 「已復原 #id」：點了開那一筆。 */
export function UndoOfLink({ id }: Readonly<{ id: number }>) {
  const t = useTranslations("activity.undo");
  const open = useContext(OpenContext);
  return (
    <button
      type="button"
      className="text-xs text-primary hover:underline"
      onClick={(e) => {
        e.stopPropagation();
        open(id);
      }}
    >
      {t("undoOf", { id })}
    </button>
  );
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  // 快照裡的 timestamptz 是 ISO 字串（2026-11-25T04:11:45.90213+00:00），轉成畫面上一致的日期時間
  if (typeof v === "string") return ISO_TIMESTAMP.test(v) ? formatDateTime(v) : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 240 ? `${s.slice(0, 239)}…` : s;
}

function ActivitySheet({
  id,
  onClose,
  onOpen,
}: Readonly<{ id: number | null; onClose: () => void; onOpen: (id: number) => void }>) {
  const t = useTranslations("activity.undo");
  // 載入結果連同它是哪一筆一起存：id 換了、結果還是舊的就當成載入中，不必在 effect 裡同步 setState。
  const [loaded, setLoaded] = useState<{ id: number; detail: ActivityDetail | null } | null>(null);
  const detail = loaded && loaded.id === id ? loaded.detail : null;
  const loading = id !== null && loaded?.id !== id;

  useEffect(() => {
    if (id === null) return;
    let cancelled = false;
    activityDetailAction(id)
      .then((d) => {
        if (!cancelled) setLoaded({ id, detail: d });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id, detail: null });
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const close = () => {
    setLoaded(null);
    onClose();
  };

  return (
    <Sheet open={id !== null} onOpenChange={(o) => (o ? null : close())}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{id === null ? "" : t("sheetTitle", { id })}</SheetTitle>
          <SheetDescription>{detail?.summary ?? "—"}</SheetDescription>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          {loading || !detail ? (
            <div className="space-y-2">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <DetailBody detail={detail} onOpen={onOpen} onDone={close} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function DetailBody({
  detail,
  onOpen,
  onDone,
}: Readonly<{ detail: ActivityDetail; onOpen: (id: number) => void; onDone: () => void }>) {
  const t = useTranslations("activity.undo");
  return (
    <>
      {detail.undoOf !== null || detail.undoneBy !== null ? (
        <div className="flex flex-wrap gap-2">
          {detail.undoOf === null ? null : (
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => onOpen(detail.undoOf as number)}>
              {t("undoOf", { id: detail.undoOf })}
            </button>
          )}
          {detail.undoneBy === null ? null : (
            <button type="button" onClick={() => onOpen(detail.undoneBy as number)}>
              <StatusTag tone="neutral">{t("undoneByLink", { id: detail.undoneBy })}</StatusTag>
            </button>
          )}
        </div>
      ) : null}

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-muted-foreground">{t("changes")}</h3>
        {detail.diff.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noChanges")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("field")}</TableHead>
                  <TableHead>{t("before")}</TableHead>
                  <TableHead>{t("after")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.diff.map((d) => (
                  <TableRow key={d.key}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground" title={d.key}>
                      {d.label}
                    </TableCell>
                    <TableCell className="max-w-[16ch] break-words text-xs tabular-nums text-muted-foreground line-through decoration-muted-foreground/40">
                      {formatValue(d.before)}
                    </TableCell>
                    <TableCell className="max-w-[16ch] break-words text-xs tabular-nums">{formatValue(d.after)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {detail.plan.ok ? (
        <UndoButton id={detail.id} kind={detail.plan.kind} onDone={onDone} />
      ) : (
        <p className="text-sm text-muted-foreground">{detail.plan.reason}</p>
      )}
    </>
  );
}

/** 復原按鈕＋確認視窗。操作紀錄頁與站內 AI 確認卡共用。 */
export function UndoButton({
  id,
  kind,
  onDone,
  size = "sm",
}: Readonly<{ id: number; kind?: string; onDone?: (newActivityId: number | null) => void; size?: "sm" | "xs" }>) {
  const t = useTranslations("activity.undo");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const description = useMemo(() => {
    if (kind === "softDelete" || kind === "delete" || kind === "restore" || kind === "undelete" || kind === "reinsert") {
      return t(`kind.${kind}`);
    }
    return null;
  }, [kind, t]);

  function onConfirm() {
    start(async () => {
      const res = await undoActivityAction(id);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toastSuccess", { id: res.activityId ?? id }));
        onDone?.(res.activityId);
        router.refresh();
      } else {
        toast.error(res.error || t("toastFailed"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size={size}>
          <Undo2 className={size === "xs" ? "size-3" : "size-4"} aria-hidden /> {t("button")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("confirmTitle")}</AlertDialogTitle>
          {description ? <AlertDialogDescription>{description}</AlertDialogDescription> : null}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("confirmCancel")}</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={onConfirm}>
            {pending ? t("confirming") : t("button")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
