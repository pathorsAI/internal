"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowUp, History, Plus, Sparkles, Square, Trash2 } from "lucide-react";
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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { takeStashedQuestion } from "@/components/ai/prompt-form";
import type {
  ChatErrorCode,
  ChatEvent,
  ChatRequest,
  UiConversation,
  UiMessage,
  UiToolCall,
} from "@/lib/ai/types";
import { cn } from "@/lib/utils";
import { deleteConversation } from "./actions";
import { CHAT_FRAME } from "./frame";
import { AssistantMessage, UserMessage } from "./messages";

type Props = Readonly<{
  conversationId: string | null;
  initialMessages: UiMessage[];
  initialConversations: UiConversation[];
  canWrite: boolean;
}>;

/** 讀 NDJSON 串流，一行一個事件。 */
async function readEvents(res: Response, onEvent: (e: ChatEvent) => void): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const emitLine = (line: string) => {
    if (!line.trim()) return;
    try {
      onEvent(JSON.parse(line) as ChatEvent);
    } catch {
      // 半行或壞掉的行，略過
    }
  };
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      emitLine(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
    }
  }
  emitLine(buffer);
}

function updateTool(messages: UiMessage[], id: string, patch: Partial<UiToolCall>): UiMessage[] {
  return messages.map((m) =>
    m.kind === "assistant" && m.tools.some((t) => t.id === id)
      ? { ...m, tools: m.tools.map((t) => (t.id === id ? { ...t, ...patch } : t)) }
      : m,
  );
}

/** 把一段文字接到指定的 assistant 泡泡；新的一輪（separate）前面空一行。 */
function appendText(
  messages: UiMessage[],
  targetId: string | null,
  delta: string,
  separate: boolean,
): UiMessage[] {
  return messages.map((m) =>
    m.kind === "assistant" && m.id === targetId
      ? { ...m, text: m.text && separate ? `${m.text}\n\n${delta}` : m.text + delta }
      : m,
  );
}

/** 在指定的 assistant 泡泡新增或取代一張工具卡（同 id 的移到最後）。 */
function upsertTool(messages: UiMessage[], targetId: string | null, call: UiToolCall): UiMessage[] {
  return messages.map((m) =>
    m.kind === "assistant" && m.id === targetId
      ? { ...m, tools: [...m.tools.filter((x) => x.id !== call.id), call] }
      : m,
  );
}

function cancelPendingTools(tools: UiToolCall[]): UiToolCall[] {
  return tools.map((x) => (x.status === "pending" ? { ...x, status: "cancelled" as const } : x));
}

/** 把所有還沒按的確認卡標成取消。 */
function cancelPendingCards(messages: UiMessage[]): UiMessage[] {
  return messages.map((m) =>
    m.kind === "assistant" && m.tools.some((x) => x.status === "pending")
      ? { ...m, tools: cancelPendingTools(m.tools) }
      : m,
  );
}

export function AiChat({ conversationId, initialMessages, initialConversations, canWrite }: Props) {
  const t = useTranslations("ai");
  const router = useRouter();
  const searchParams = useSearchParams();
  const [messages, setMessages] = useState<UiMessage[]>(initialMessages);
  const [conversations, setConversations] = useState(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(conversationId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ChatErrorCode | "network" | null>(null);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(conversationId);
  // 事件要寫進哪一個 assistant 泡泡；新的一輪（msg 事件）文字前面要空一行。
  const targetRef = useRef<string | null>(null);
  const separateRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const startedRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const apply = useCallback(
    (e: ChatEvent) => {
      switch (e.t) {
        case "conv": {
          activeRef.current = e.id;
          setActiveId(e.id);
          setConversations((cs) => [
            { id: e.id, title: e.title, updatedAt: new Date().toISOString() },
            ...cs.filter((c) => c.id !== e.id),
          ]);
          // 不重新載入頁面，只把網址換成這段對話的，重新整理或分享時才回得來。
          globalThis.history.replaceState(null, "", `/dashboard/ai/${e.id}`);
          break;
        }
        case "msg":
          separateRef.current = true;
          break;
        case "text": {
          const target = targetRef.current;
          const sep = separateRef.current;
          separateRef.current = false;
          setMessages((ms) => appendText(ms, target, e.d, sep));
          break;
        }
        case "tool": {
          const target = targetRef.current;
          setMessages((ms) => upsertTool(ms, target, e.call));
          break;
        }
        case "tool_done":
          setMessages((ms) => updateTool(ms, e.id, { status: e.status, error: e.error }));
          break;
        case "error":
          setError(e.code);
          break;
        case "done":
          break;
      }
    },
    [],
  );

  const post = useCallback(
    // 錯誤都在裡面處理掉，這個 promise 不會 reject，呼叫端不用 await。
    async (body: ChatRequest) => {
      const controller = new AbortController();
      abortRef.current = controller;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        const isStream = res.headers.get("content-type")?.includes("ndjson");
        if (!res.ok && !isStream) {
          const ev = (await res.json().catch(() => null)) as ChatEvent | null;
          setError(ev?.t === "error" ? ev.code : "internal");
          return;
        }
        await readEvents(res, apply);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) setError("network");
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [apply],
  );

  const send = useCallback(
    (text: string, page?: string | null) => {
      const q = text.trim();
      if (!q || busy) return;
      const stamp = Date.now();
      const bubbleId = `a${stamp}`;
      targetRef.current = bubbleId;
      separateRef.current = false;
      // 伺服器收到新問題會把上一題沒按的確認卡當成取消，畫面上同步標示。
      setMessages((ms) => [
        ...cancelPendingCards(ms),
        { kind: "user", id: `u${stamp}`, text: q },
        { kind: "assistant", id: bubbleId, text: "", tools: [] },
      ]);
      setInput("");
      post({
        conversationId: activeRef.current ?? undefined,
        message: q,
        ...(page && !activeRef.current ? { page } : {}),
      });
    },
    [busy, post],
  );

  const confirm = useCallback(
    (call: UiToolCall, approve: boolean) => {
      if (busy || !activeRef.current) return;
      const bubble = messages.find((m) => m.kind === "assistant" && m.tools.some((x) => x.id === call.id));
      targetRef.current = bubble?.id ?? null;
      separateRef.current = true;
      setMessages((ms) => updateTool(ms, call.id, { status: approve ? "running" : "cancelled" }));
      post({ conversationId: activeRef.current, confirm: { toolCallId: call.id, approve } });
    },
    [busy, messages, post],
  );

  // 從首頁輸入框／⌘K 帶過來的問題：一進來就送出（只送一次）。放進 timeout 再讀，
  // 開發模式 StrictMode 掛兩次 effect 時第一次的會被 cleanup 取消，不會讀走又沒送。
  useEffect(() => {
    if (conversationId) return;
    const timer = setTimeout(() => {
      if (startedRef.current) return;
      startedRef.current = true;
      const handoff = searchParams.get("new") === "1" ? takeStashedQuestion() : null;
      const q = handoff?.q ?? searchParams.get("q");
      if (q) {
        globalThis.history.replaceState(null, "", "/dashboard/ai");
        send(q, handoff?.page ?? null);
      } else {
        composerRef.current?.focus();
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [conversationId, searchParams, send]);

  const history = (
    <ConversationList
      conversations={conversations}
      activeId={activeId}
      onDeleted={(id) => {
        setConversations((cs) => cs.filter((c) => c.id !== id));
        if (id === activeRef.current) router.push("/dashboard/ai");
      }}
    />
  );

  const suggestions = [t("prompt.suggestions.unbilled"), t("prompt.suggestions.topSpend")];

  return (
    <div className={CHAT_FRAME}>
      <aside className="hidden w-64 shrink-0 flex-col border-r md:flex">{history}</aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2 md:hidden">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm">
                <History className="size-4" />
                {t("history.open")}
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-72 gap-0 p-0">
              <SheetTitle className="sr-only">{t("history.open")}</SheetTitle>
              {history}
            </SheetContent>
          </Sheet>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
            {messages.length === 0 ? (
              <div className="dot-paper flex flex-col items-center gap-3 rounded-xl px-6 py-14 text-center">
                <Sparkles className="size-5 text-primary" aria-hidden />
                <p className="text-base font-medium">{t("chat.emptyTitle")}</p>
                <p className="max-w-md text-sm text-muted-foreground">
                  {canWrite ? t("chat.emptyBody") : t("chat.readOnly")}
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-1">
                  {suggestions.map((s) => (
                    <Button
                      key={s}
                      variant="outline"
                      size="sm"
                      className="h-7 px-2.5 text-xs font-normal text-muted-foreground hover:text-foreground"
                      onClick={() => send(s)}
                    >
                      {s}
                    </Button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) =>
                m.kind === "user" ? (
                  <UserMessage key={m.id} text={m.text} />
                ) : (
                  <AssistantMessage
                    key={m.id}
                    message={m}
                    streaming={busy && i === messages.length - 1}
                    disabled={busy}
                    onConfirm={confirm}
                  />
                ),
              )
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {t(`chat.errors.${error}`)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="border-t bg-background px-4 py-3">
          <form
            className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-xl border bg-card p-2 pl-3 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <textarea
              ref={composerRef}
              data-ai-composer
              rows={1}
              value={input}
              maxLength={4000}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // 中文輸入法選字時按 Enter 不送出
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={t("prompt.placeholder")}
              aria-label={t("prompt.placeholder")}
              className="field-sizing-content max-h-40 min-h-8 flex-1 resize-none bg-transparent py-1.5 text-base outline-none placeholder:text-muted-foreground md:text-sm"
            />
            {busy ? (
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                aria-label={t("chat.stop")}
                onClick={() => abortRef.current?.abort()}
              >
                <Square className="size-3.5" />
              </Button>
            ) : (
              <Button type="submit" size="icon-sm" aria-label={t("prompt.submit")} disabled={!input.trim()}>
                <ArrowUp className="size-4" />
              </Button>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function ConversationList({
  conversations,
  activeId,
  onDeleted,
}: Readonly<{
  conversations: UiConversation[];
  activeId: string | null;
  onDeleted: (id: string) => void;
}>) {
  const t = useTranslations("ai.history");
  const [pendingDelete, setPendingDelete] = useState<UiConversation | null>(null);
  const [deleting, startDelete] = useTransition();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <span className="text-sm font-medium text-muted-foreground">{t("title")}</span>
        <Button asChild variant="outline" size="sm" className="h-7 px-2 text-xs">
          <Link href="/dashboard/ai">
            <Plus className="size-3.5" />
            {t("new")}
          </Link>
        </Button>
      </div>
      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {conversations.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">{t("empty")}</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.map((c) => (
              <li key={c.id} className="group relative">
                <Link
                  href={`/dashboard/ai/${c.id}`}
                  aria-current={c.id === activeId ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2 rounded-md py-2 pr-8 pl-2 text-sm transition-colors hover:bg-accent",
                    c.id === activeId && "bg-accent font-medium",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{c.title || t("untitled")}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums group-hover:invisible">
                    {shortDate(c.updatedAt)}
                  </span>
                </Link>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={t("delete")}
                  className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-destructive focus-visible:opacity-100"
                  onClick={() => setPendingDelete(c)}
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </nav>

      <AlertDialog open={pendingDelete !== null} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("delete")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirm", { title: pendingDelete?.title || t("untitled") })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(e) => {
                e.preventDefault();
                const target = pendingDelete;
                if (!target) return;
                startDelete(async () => {
                  const res = await deleteConversation(target.id);
                  setPendingDelete(null);
                  if (res.ok) {
                    toast.success(t("deleted"));
                    onDeleted(target.id);
                  }
                });
              }}
            >
              {t("delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
