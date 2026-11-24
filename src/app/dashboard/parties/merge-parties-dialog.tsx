"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Merge } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusTag } from "@/components/ds/status-dot";
import type { MergeCounts } from "@/lib/party-merge";
import { mergePartiesAction, previewPartyMerge } from "./actions";

export type MergePartyOption = { id: number; name: string; txnCount: number };

const COUNT_KEYS: (keyof MergeCounts)[] = [
  "transactions",
  "projects",
  "contracts",
  "subscriptions",
  "billingItems",
  "invoices",
  "vendorBillingAccounts",
  "vendorBillingMatchParties",
  "recurringExpenses",
];

/**
 * 合併交易對象：選要保留的目標、勾要併進來的來源 → 預覽會搬多少資料 → 確認。
 * variant "header" 是頁首的「合併」按鈕；"hint" 是列上的「可能重複」捷徑（預先帶好目標與來源）。
 */
export function MergePartiesDialog({
  parties,
  initialTargetId,
  initialSourceIds = [],
  variant = "header",
  hint,
}: Readonly<{
  parties: MergePartyOption[];
  initialTargetId?: number;
  initialSourceIds?: number[];
  variant?: "header" | "hint";
  /** variant="hint" 時 tag 的 title（跟誰很像） */
  hint?: string;
}>) {
  const t = useTranslations("links");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState<string>(initialTargetId ? String(initialTargetId) : "");
  const [sourceIds, setSourceIds] = useState<number[]>(initialSourceIds);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewPartyMerge>> | null>(null);
  const [previewing, startPreview] = useTransition();
  const [merging, startMerge] = useTransition();

  function reset() {
    setTargetId(initialTargetId ? String(initialTargetId) : "");
    setSourceIds(initialSourceIds);
    setQuery("");
    setPreview(null);
  }

  const target = Number(targetId) || null;
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return parties.filter(
      (p) => p.id !== target && (!q || p.name.toLowerCase().includes(q) || sourceIds.includes(p.id)),
    );
  }, [parties, query, target, sourceIds]);
  const ready = target != null && sourceIds.filter((id) => id !== target).length > 0;

  function toggle(id: number) {
    setPreview(null);
    setSourceIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function runPreview() {
    if (!ready || target == null) {
      toast.error(t("merge.pickBoth"));
      return;
    }
    startPreview(async () => {
      const res = await previewPartyMerge(target, sourceIds.filter((id) => id !== target));
      if (!res.ok) toast.error(res.error ?? t("errors.failed"));
      setPreview(res.ok ? res : null);
    });
  }

  function runMerge() {
    if (!ready || target == null) return;
    startMerge(async () => {
      const res = await mergePartiesAction(target, sourceIds.filter((id) => id !== target));
      if (!res.ok) {
        toast.error(res.error ?? t("errors.failed"));
        return;
      }
      toast.success(t("merge.done", { count: res.merged ?? 0, name: res.name ?? "" }));
      setOpen(false);
      router.refresh();
    });
  }

  const counts = preview?.counts;
  const moved = counts ? COUNT_KEYS.filter((k) => counts[k] > 0) : [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) reset();
      }}
    >
      <DialogTrigger asChild>
        {variant === "header" ? (
          <Button type="button" variant="outline" size="sm">
            <Merge className="size-4" /> {t("merge.button")}
          </Button>
        ) : (
          <button type="button" title={hint} className="cursor-pointer" onClick={(e) => e.stopPropagation()}>
            <StatusTag tone="warning">{t("merge.possibleDuplicate")}</StatusTag>
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{t("merge.title")}</DialogTitle>
          <DialogDescription>{t("merge.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("merge.target")}</span>
            <Select
              value={targetId}
              onValueChange={(v) => {
                setTargetId(v);
                setPreview(null);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t("merge.targetPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {parties.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">{t("merge.sources")}</span>
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("merge.search")} />
            <div className="max-h-52 overflow-y-auto rounded-md border">
              {visible.map((p) => (
                <label
                  key={p.id}
                  className="flex cursor-pointer items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={sourceIds.includes(p.id)}
                      onChange={() => toggle(p.id)}
                    />
                    <span className="truncate">{p.name}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {t("merge.txnCount", { count: p.txnCount })}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {preview?.ok && counts ? (
            <div className="flex flex-col gap-2 rounded-md bg-muted/40 px-3 py-2.5 text-sm">
              <span className="text-xs font-medium text-muted-foreground">{t("merge.willMove")}</span>
              {moved.length === 0 ? (
                <span className="text-muted-foreground">{t("merge.nothingToMove")}</span>
              ) : (
                <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                  {moved.map((k) => (
                    <div key={k} className="contents">
                      <dt className="text-muted-foreground">{t(`merge.counts.${k}`)}</dt>
                      <dd className="text-right tabular-nums">{counts[k]}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {preview.aliases && preview.aliases.length > 0 ? (
                <>
                  <span className="pt-1 text-xs font-medium text-muted-foreground">{t("merge.aliases")}</span>
                  <span className="break-words">{preview.aliases.join("、")}</span>
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            {t("merge.cancel")}
          </Button>
          {preview?.ok ? (
            <Button type="button" variant="destructive" disabled={merging || !ready} onClick={runMerge}>
              {merging ? t("merge.merging") : t("merge.confirm")}
            </Button>
          ) : (
            <Button type="button" disabled={previewing || !ready} onClick={runPreview}>
              {previewing ? t("merge.previewing") : t("merge.preview")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
