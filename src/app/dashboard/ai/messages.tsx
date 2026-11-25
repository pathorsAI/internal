"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ArrowLeftRight, BookMarked, Check, Loader2, Paperclip, PencilLine, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/ds/status-dot";
import { Markdown } from "@/components/ai/markdown";
import { PartyAvatar } from "@/components/party-avatar";
import { LOAD_TOOL_GROUPS } from "@/lib/ai/tool-groups";
import type { AttachmentRef, UiMessage, UiToolCall } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { splitOptions } from "./split-options";
import { UndoButton } from "../activity/activity-detail";

export type ChatUser = { name: string; image: string | null };

/** 本人所屬的組織（畫確認卡與工具小標籤用）。 */
export type ChatOrg = { id: string; name: string; slug: string | null; logo: string | null };

/** 對話可以跨組織：本人的組織清單＋目前的組織。只有一個組織時卡片不顯示組織列。 */
export type ChatOrgs = { orgs: readonly ChatOrg[]; currentOrgId: string };

/** 工具呼叫的 organizationId（id 或 slug，沒帶 = 目前的組織）→ 組織。 */
export function targetOrg(scope: ChatOrgs, organizationId: string | undefined): ChatOrg | undefined {
  const key = organizationId ?? scope.currentOrgId;
  return scope.orgs.find((o) => o.id === key || o.slug === key);
}

export function UserMessage({
  text,
  user,
  attachments,
}: Readonly<{ text: string; user: ChatUser; attachments?: AttachmentRef[] }>) {
  return (
    <div className="flex items-start justify-end gap-2">
      <div className="flex max-w-[85%] flex-col items-end gap-1.5">
        {text ? (
          <p className="rounded-xl bg-muted px-3.5 py-2 text-sm leading-6 whitespace-pre-wrap">
            {text}
          </p>
        ) : null}
        {/* 從 LINE／WhatsApp 傳來的單據：列檔名，點了開原檔 */}
        {attachments?.map((a) => (
          <a
            key={a.documentId}
            href={`/api/documents/${a.documentId}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <Paperclip className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{a.fileName ?? `#${a.documentId}`}</span>
          </a>
        ))}
      </div>
      <PartyAvatar name={user.name} src={user.image} size="md" className="mt-1 rounded-full" />
    </div>
  );
}


/** 只讀工具列成一行：list_categories · list_bank_accounts（跟提案示意一樣，用原本的工具名）。 */
function ToolLine({ tools, orgScope }: Readonly<{ tools: UiToolCall[]; orgScope: ChatOrgs }>) {
  const t = useTranslations("ai.chat");
  if (tools.length === 0) return null;
  const running = tools.some((x) => x.status === "running");
  return (
    <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
      {running ? (
        <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin" aria-hidden />
      ) : (
        <Wrench className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      )}
      <span className="sr-only">{t("tools", { count: tools.length })}</span>
      <span className="flex flex-wrap gap-x-1.5 font-mono">
        {tools.map((x, i) => (
          <span key={x.id} className={cn(x.status === "error" && "text-destructive")} title={x.error}>
            {x.name}
            <OtherOrgLabel call={x} orgScope={orgScope} />
            {x.status === "error" ? ` (${t("toolFailed")})` : ""}
            {i < tools.length - 1 ? " ·" : ""}
          </span>
        ))}
      </span>
    </div>
  );
}

/** 只讀工具跑在「不是目前的組織」時，在工具名後面加一個小小的組織名稱。 */
function OtherOrgLabel({ call, orgScope }: Readonly<{ call: UiToolCall; orgScope: ChatOrgs }>) {
  if (!call.organizationId) return null;
  const org = targetOrg(orgScope, call.organizationId);
  if (!org || org.id === orgScope.currentOrgId) return null;
  return <span className="ml-1 font-sans text-[11px] text-foreground/70">（{org.name}）</span>;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  const s = JSON.stringify(v);
  return s.length > 240 ? `${s.slice(0, 239)}…` : s;
}

/** 寫入工具的確認卡：列出要做什麼，按確認才執行；刪除與無法復原的寫入標紅。 */
export function ConfirmCard({
  call,
  disabled,
  orgScope,
  onConfirm,
  onRetarget,
}: Readonly<{
  call: UiToolCall;
  disabled: boolean;
  orgScope: ChatOrgs;
  onConfirm: (call: UiToolCall, approve: boolean) => void;
  /** 按「換到 …」：把這張待確認的卡改到另一個組織（確認時才真的送出）。 */
  onRetarget: (call: UiToolCall, orgId: string) => void;
}>) {
  const t = useTranslations("ai.confirm");
  const danger = call.level === "danger";
  const args = Object.entries(call.args ?? {});
  const resolved = call.status !== "pending";
  // 寫入成功後可以直接復原（呼叫跟操作紀錄頁同一支 server action）；復原過就換成「已復原」。
  const [undone, setUndone] = useState(false);
  const canUndo = call.status === "ok" && call.activityId !== undefined && !undone;
  const multiOrg = orgScope.orgs.length > 1;
  const org = targetOrg(orgScope, call.organizationId);

  return (
    <div
      className={cn(
        "max-w-xl space-y-3 rounded-xl border bg-card p-4 shadow-xs",
        danger && "border-destructive/40",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground",
            danger && "text-destructive",
          )}
        >
          {danger ? <AlertTriangle className="size-3.5" /> : <PencilLine className="size-3.5" />}
          {danger ? t("danger") : t("write")}
        </span>
        <span className="inline-flex items-center gap-2">
          {resolved ? <ResolvedTag status={call.status} /> : null}
          {undone ? <StatusTag tone="neutral">{t("undone")}</StatusTag> : null}
          {canUndo ? (
            <UndoButton id={call.activityId as number} size="xs" onDone={() => setUndone(true)} />
          ) : null}
        </span>
      </div>
      {/* 本人在好幾個組織時：寫進哪個組織要一眼看得到，按錯了可以一鍵換過去再確認 */}
      {multiOrg && org ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="inline-flex min-w-0 items-center gap-2">
            <PartyAvatar name={org.name} src={org.logo} size="md" />
            <span className="truncate text-sm font-semibold">{org.name}</span>
            <span className="sr-only">{t("orgLabel")}</span>
          </span>
          {call.status === "pending"
            ? orgScope.orgs
                .filter((o) => o.id !== org.id)
                .map((o) => (
                  <Button
                    key={o.id}
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                    disabled={disabled}
                    onClick={() => onRetarget(call, o.id)}
                  >
                    <ArrowLeftRight className="size-3.5" aria-hidden />
                    {t("switchOrg", { name: o.name })}
                  </Button>
                ))
            : null}
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-medium">{call.summary ?? call.name}</p>
        {call.summary ? <p className="font-mono text-xs text-muted-foreground">{call.name}</p> : null}
      </div>
      {call.ruleHint ? (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <BookMarked className="size-3.5 shrink-0 text-primary" aria-hidden />
          {call.ruleHint}
        </p>
      ) : null}
      {args.length > 0 ? (
        <details className="group text-xs" open={!call.summary}>
          <summary className="cursor-pointer text-muted-foreground select-none hover:text-foreground">
            {t("details")}
          </summary>
          <dl className="mt-2 grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-1">
            {args.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="font-mono text-muted-foreground">{k}</dt>
                <dd className="break-words tabular-nums">{formatValue(v)}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
      {call.status === "error" && call.error ? (
        <p className="text-xs text-destructive">{call.error}</p>
      ) : null}
      {call.status === "pending" ? (
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" disabled={disabled} onClick={() => onConfirm(call, false)}>
            {t("cancel")}
          </Button>
          <Button
            size="sm"
            variant={danger ? "destructive" : "default"}
            disabled={disabled}
            onClick={() => onConfirm(call, true)}
          >
            {danger ? t("approveDanger") : t("approve")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ResolvedTag({ status }: Readonly<{ status: UiToolCall["status"] }>) {
  const t = useTranslations("ai.confirm");
  if (status === "running") {
    return (
      <StatusTag tone="primary">
        <Loader2 className="size-3 animate-spin" />
        {t("running")}
      </StatusTag>
    );
  }
  if (status === "ok") {
    return (
      <StatusTag tone="income">
        <Check className="size-3" />
        {t("done")}
      </StatusTag>
    );
  }
  if (status === "error") return <StatusTag tone="risk">{t("failed")}</StatusTag>;
  return <StatusTag tone="neutral">{t("cancelled")}</StatusTag>;
}

export function AssistantMessage({
  message,
  streaming,
  disabled,
  orgScope,
  onConfirm,
  onRetarget,
  onOption,
}: Readonly<{
  message: Extract<UiMessage, { kind: "assistant" }>;
  streaming: boolean;
  disabled: boolean;
  orgScope: ChatOrgs;
  onConfirm: (call: UiToolCall, approve: boolean) => void;
  onRetarget: (call: UiToolCall, orgId: string) => void;
  /** 只有最後一則回覆給：點快速選項就把那段字當成下一題送出。其他則只拆掉標記不顯示選項。 */
  onOption?: (text: string) => void;
}>) {
  const t = useTranslations("ai.chat");
  const tOptions = useTranslations("ai.options");
  const visible = message.tools.filter((x) => x.name !== LOAD_TOOL_GROUPS);
  const reads = visible.filter((x) => x.level === "read");
  const writes = visible.filter((x) => x.level !== "read");
  const { text, options } = splitOptions(message.text, streaming);
  const empty = !text && visible.length === 0;
  const showOptions = Boolean(onOption) && !streaming && options.length > 0;

  return (
    <div className="space-y-3">
      <ToolLine tools={reads} orgScope={orgScope} />
      {/* 確認卡在文字前面：按下確認後模型接著講的結果，會接在卡片下方 */}
      {writes.map((c) => (
        <ConfirmCard
          key={c.id}
          call={c}
          disabled={disabled}
          orgScope={orgScope}
          onConfirm={onConfirm}
          onRetarget={onRetarget}
        />
      ))}
      {text ? <Markdown text={text} /> : null}
      {showOptions ? (
        <fieldset aria-label={tOptions("label")} className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
          {options.map((o) => (
            <Button
              key={o}
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-xs font-normal"
              disabled={disabled}
              onClick={() => onOption?.(o)}
            >
              {o}
            </Button>
          ))}
        </fieldset>
      ) : null}
      {empty && streaming ? (
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          {t("thinking")}
        </p>
      ) : null}
    </div>
  );
}
