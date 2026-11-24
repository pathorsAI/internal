"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, BookMarked, Check, Loader2, Paperclip, PencilLine, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/ds/status-dot";
import { Markdown } from "@/components/ai/markdown";
import { PartyAvatar } from "@/components/party-avatar";
import { LOAD_TOOL_GROUPS } from "@/lib/ai/tool-groups";
import type { AttachmentRef, UiMessage, UiToolCall } from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { splitOptions } from "./split-options";

export type ChatUser = { name: string; image: string | null };

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
function ToolLine({ tools }: Readonly<{ tools: UiToolCall[] }>) {
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
            {x.status === "error" ? ` (${t("toolFailed")})` : ""}
            {i < tools.length - 1 ? " ·" : ""}
          </span>
        ))}
      </span>
    </div>
  );
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
  onConfirm,
}: Readonly<{
  call: UiToolCall;
  disabled: boolean;
  onConfirm: (call: UiToolCall, approve: boolean) => void;
}>) {
  const t = useTranslations("ai.confirm");
  const danger = call.level === "danger";
  const args = Object.entries(call.args ?? {});
  const resolved = call.status !== "pending";

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
        {resolved ? <ResolvedTag status={call.status} /> : null}
      </div>
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
  onConfirm,
  onOption,
}: Readonly<{
  message: Extract<UiMessage, { kind: "assistant" }>;
  streaming: boolean;
  disabled: boolean;
  onConfirm: (call: UiToolCall, approve: boolean) => void;
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
      <ToolLine tools={reads} />
      {/* 確認卡在文字前面：按下確認後模型接著講的結果，會接在卡片下方 */}
      {writes.map((c) => (
        <ConfirmCard key={c.id} call={c} disabled={disabled} onConfirm={onConfirm} />
      ))}
      {text ? <Markdown text={text} /> : null}
      {showOptions ? (
        <div role="group" aria-label={tOptions("label")} className="flex flex-wrap gap-2">
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
        </div>
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
