"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import type { ChatProvider } from "@/db/chat";
import { StatusTag } from "@/components/ds/status-dot";
import { QrCode } from "@/components/qr-code";
import { TableCard } from "@/components/table-card";
import { Button } from "@/components/ui/button";
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
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { chatBindingStatus, createLinkCode, unlinkChatAccount } from "./actions";

export type ChatAccountRow = {
  provider: ChatProvider;
  /** 平台的 secret 有沒有設齊；沒有就整列顯示「尚未啟用」。 */
  enabled: boolean;
  identity: {
    displayName: string | null;
    /** bot 目前替這個人操作的組織（被刪了或還沒選是 null）。 */
    orgName: string | null;
    createdAt: string;
    lastSeenAt: string;
  } | null;
};

const PROVIDER_NAME: Record<ChatProvider, string> = { line: "LINE", whatsapp: "WhatsApp" };

/** 「綁定 123456」那段倒數：剩幾秒（不會小於 0）。 */
function secondsLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

function mmss(s: number): string {
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 狀態欄：尚未啟用 → 已綁定 → 未綁定。 */
function AccountStatus({ enabled, linked }: Readonly<{ enabled: boolean; linked: boolean }>) {
  const t = useTranslations("settings.chat");
  if (!enabled) return <StatusTag tone="neutral">{t("status.disabled")}</StatusTag>;
  if (linked) return <StatusTag tone="income">{t("status.linked")}</StatusTag>;
  return <StatusTag tone="neutral">{t("status.unlinked")}</StatusTag>;
}

export function ChatAccountsTable({
  rows,
  currentOrgName,
}: Readonly<{ rows: ChatAccountRow[]; currentOrgName: string }>) {
  const t = useTranslations("settings.chat");
  const [binding, setBinding] = useState<ChatProvider | null>(null);
  const [unlinking, setUnlinking] = useState<ChatProvider | null>(null);
  const closeBind = useCallback(() => setBinding(null), []);
  const closeUnlink = useCallback(() => setUnlinking(null), []);

  return (
    <>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.provider")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.account")}</TableHead>
              <TableHead>{t("columns.org")}</TableHead>
              <TableHead>{t("columns.linkedAt")}</TableHead>
              <TableHead className="text-right">{t("columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.provider}>
                <TableCell className="font-medium">{PROVIDER_NAME[r.provider]}</TableCell>
                <TableCell>
                  <AccountStatus enabled={r.enabled} linked={Boolean(r.identity)} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.identity ? (r.identity.displayName ?? t("unnamed")) : "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {r.identity ? (r.identity.orgName ?? t("noOrg")) : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground tabular-nums">
                  {r.identity ? formatDate(r.identity.createdAt) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  {r.identity ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setUnlinking(r.provider)}
                    >
                      {t("unlink.trigger")}
                    </Button>
                  ) : null}
                  {!r.identity && r.enabled ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setBinding(r.provider)}>
                      {t("bind.trigger")}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableCard>

      {/* 每次打開都重新掛一份（key），關掉就卸下，綁定碼不會殘留到下一次。 */}
      {binding ? (
        <BindSheet key={binding} provider={binding} currentOrgName={currentOrgName} onClose={closeBind} />
      ) : null}
      <UnlinkDialog provider={unlinking} onClose={closeUnlink} />
    </>
  );
}

type Issued = { code: string; expiresAt: string; openUrl: string | null; message: string };

/** 產生綁定碼的 Sheet：6 位數、10 分鐘倒數、開啟 LINE／WhatsApp、QR code；綁好就自動關。 */
function BindSheet({
  provider,
  currentOrgName,
  onClose,
}: Readonly<{ provider: ChatProvider; currentOrgName: string; onClose: () => void }>) {
  const t = useTranslations("settings.chat");
  const router = useRouter();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [pending, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());

  const issue = useCallback(
    (p: ChatProvider) => {
      start(async () => {
        const res = await createLinkCode(p);
        if (res.ok) {
          setIssued({ code: res.code, expiresAt: res.expiresAt, openUrl: res.openUrl, message: res.message });
          setNow(Date.now());
        } else {
          toast.error(t(`bind.errors.${res.error}`));
          onClose();
        }
      });
    },
    [onClose, t],
  );

  // 掛上就產生一組（舊碼由伺服器作廢）。只跟著 provider 變：issue 的身分每次 render
  // 都可能不同，不能讓它重新觸發產生新碼。
  const issueRef = useRef(issue);
  useEffect(() => {
    issueRef.current = issue;
  }, [issue]);
  useEffect(() => {
    issueRef.current(provider);
  }, [provider]);

  const left = issued ? secondsLeft(issued.expiresAt, now) : 0;
  const expired = issued !== null && left === 0;

  // 倒數＋每 3 秒問一次綁好了沒（使用者在手機上送出綁定訊息後，這邊自己關掉、列表更新）。
  useEffect(() => {
    if (!issued || expired) return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const poll = setInterval(async () => {
      const { bound } = await chatBindingStatus(provider);
      if (bound) {
        toast.success(t("bind.done", { provider: PROVIDER_NAME[provider] }));
        onClose();
        router.refresh();
      }
    }, 3000);
    return () => {
      clearInterval(tick);
      clearInterval(poll);
    };
  }, [provider, issued, expired, onClose, router, t]);

  const name = PROVIDER_NAME[provider];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="shrink-0">
          <SheetTitle>{t("bind.title", { provider: name })}</SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-6 overflow-y-auto px-4 pb-6">
          {issued ? (
            <>
              <div className="space-y-1">
                <div className="text-sm font-medium text-muted-foreground">{t("bind.codeLabel")}</div>
                <div
                  className={
                    expired
                      ? "font-mono text-3xl font-semibold tracking-[0.3em] text-muted-foreground line-through tabular-nums"
                      : "font-mono text-3xl font-semibold tracking-[0.3em] tabular-nums"
                  }
                >
                  {issued.code}
                </div>
                <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                  {expired ? t("bind.expired") : t("bind.expiresIn", { time: mmss(left) })}
                </p>
              </div>

              {expired ? (
                <Button type="button" variant="outline" disabled={pending} onClick={() => issue(provider)}>
                  <RefreshCw className="size-4" />
                  {t("bind.regenerate")}
                </Button>
              ) : (
                <>
                  {issued.openUrl ? (
                    <div className="space-y-3">
                      <Button asChild>
                        <a href={issued.openUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-4" />
                          {t("bind.open", { provider: name })}
                        </a>
                      </Button>
                      <div className="flex items-center gap-4">
                        <QrCode
                          value={issued.openUrl}
                          size={152}
                          label={t("bind.qrLabel", { provider: name })}
                          className="shrink-0 rounded-md border"
                        />
                        <p className="text-sm text-muted-foreground">{t("bind.qrHint", { provider: name })}</p>
                      </div>
                    </div>
                  ) : null}
                  <p className="text-sm text-muted-foreground">
                    {t("bind.manual", { provider: name, message: issued.message })}
                  </p>
                  {currentOrgName ? (
                    <p className="text-xs text-muted-foreground">{t("bind.orgNote", { org: currentOrgName })}</p>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("bind.issuing")}
            </p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function UnlinkDialog({
  provider,
  onClose,
}: Readonly<{ provider: ChatProvider | null; onClose: () => void }>) {
  const t = useTranslations("settings.chat");
  const router = useRouter();
  const [pending, start] = useTransition();
  const name = provider ? PROVIDER_NAME[provider] : "";

  return (
    <AlertDialog open={provider !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("unlink.confirmTitle", { provider: name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("unlink.confirmDescription", { provider: name })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("unlink.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              if (!provider) return;
              start(async () => {
                const res = await unlinkChatAccount(provider);
                onClose();
                if (res.ok) router.refresh();
                else toast.error(t("unlink.failed"));
              });
            }}
          >
            {t("unlink.trigger")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
