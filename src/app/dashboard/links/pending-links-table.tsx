"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusTag } from "@/components/ds/status-dot";
import { Amount, amountKind } from "@/components/amount";
import { formatCurrency } from "@/lib/currency";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { LinkCandidate } from "@/lib/linking/match";
import type { PendingLinkRow } from "@/lib/linking/pending";
import {
  attachLinkCandidate,
  choosePartyForLink,
  createPartyForLink,
  skipPendingLink,
  type LinkActionState,
} from "./actions";

type Busy = string | null;

function GapText({ c }: Readonly<{ c: LinkCandidate }>) {
  const t = useTranslations("links");
  if (c.amountMatches) return <span className="text-income">{t("candidate.matches")}</span>;
  if (c.gap > 0) return <span>{t("candidate.short", { amount: formatCurrency(c.gap, c.currency) })}</span>;
  if (c.gap < 0) return <span>{t("candidate.over", { amount: formatCurrency(-c.gap, c.currency) })}</span>;
  return null;
}

function RowActions({ row }: Readonly<{ row: PendingLinkRow }>) {
  const t = useTranslations("links");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<Busy>(null);

  function act(key: string, fn: () => Promise<LinkActionState>, success: string) {
    setBusy(key);
    start(async () => {
      const res = await fn();
      setBusy(null);
      if (!res.ok) {
        toast.error(res.error ?? t("errors.failed"));
        return;
      }
      toast.success(success);
      if (res.aliasAdded) toast.message(t("toast.aliasAdded", { name: res.aliasAdded }));
      if (res.stillPending) toast.message(t("toast.stillPending"));
      for (const title of res.contractsReady ?? []) toast.message(t("toast.contractHint", { title }));
      router.refresh();
    });
  }

  const disabled = pending;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      {row.reviewReason === "party_similar" && row.party ? (
        <>
          <span className="text-xs text-muted-foreground">{t("party.heldName", { name: row.party.name })}</span>
          {row.party.candidates.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-sm"
            >
              <div className="flex min-w-0 flex-col">
                <span className="truncate font-medium">{p.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("party.score", { score: Math.round(p.score * 100) })}
                  {p.via === "alias" ? ` · ${t("party.viaAlias")}` : ""}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => act(`party:${p.id}`, () => choosePartyForLink(row.id, p.id), t("toast.partyChosen"))}
              >
                {busy === `party:${p.id}` ? "…" : t("party.pick")}
              </Button>
            </div>
          ))}
          <div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={disabled}
              onClick={() => act("new", () => createPartyForLink(row.id), t("toast.partyCreated"))}
            >
              {busy === "new" ? "…" : t("party.create")}
            </Button>
          </div>
        </>
      ) : null}

      {row.candidates.length > 0
        ? row.candidates.map((c) => {
            const key = `${c.kind}:${c.id}:${c.subscriptionPeriod ?? ""}`;
            return (
              <div
                key={key}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-md border px-2.5 py-1.5 text-sm",
                  c.amountMatches && "border-primary/40 bg-primary/5",
                )}
              >
                <div className="flex min-w-0 flex-col">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="shrink-0 text-xs text-muted-foreground">{t(`kind.${c.kind}`)}</span>
                    <span className="truncate font-medium" title={c.label}>
                      {c.label}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground tabular-nums">
                    <span>{t("candidate.expected", { amount: formatCurrency(c.expected, c.currency) })}</span>
                    <GapText c={c} />
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={c.amountMatches ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() =>
                    act(
                      key,
                      () => attachLinkCandidate(row.id, c.kind, c.id, c.subscriptionPeriod),
                      t("toast.attached"),
                    )
                  }
                >
                  {busy === key ? "…" : t("actions.attach")}
                </Button>
              </div>
            );
          })
        : row.reviewReason !== "party_similar" && (
            <span className="text-xs text-muted-foreground">{t("candidate.none")}</span>
          )}

      {row.reviewReason === "party_similar" ? null : (
        <div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            title={t("actions.skipHint")}
            disabled={disabled}
            onClick={() => act("skip", () => skipPendingLink(row.id), t("toast.skipped"))}
          >
            {busy === "skip" ? "…" : t("actions.skip")}
          </Button>
        </div>
      )}
    </div>
  );
}

export function PendingLinksTable({ rows }: Readonly<{ rows: PendingLinkRow[] }>) {
  const t = useTranslations("links");
  return (
    <Table className="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead className="w-24">{t("columns.date")}</TableHead>
          <TableHead className="w-52">{t("columns.party")}</TableHead>
          <TableHead className="w-32 text-right">{t("columns.amount")}</TableHead>
          <TableHead className="w-48">{t("columns.description")}</TableHead>
          <TableHead>{t("columns.candidates")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <TableRow key={r.id} className="align-top hover:bg-transparent">
            <TableCell className="whitespace-nowrap text-muted-foreground">{formatDate(r.txnDate)}</TableCell>
            <TableCell>
              <div className="flex min-w-0 flex-col items-start gap-1">
                <span className="max-w-full truncate font-medium">{r.partyName ?? r.party?.name ?? "—"}</span>
                <span title={t(`reasonHint.${r.reviewReason as "link_suggested"}`)}>
                  <StatusTag tone={r.reviewReason === "party_similar" ? "warning" : "primary"}>
                    {t(`reason.${r.reviewReason as "link_suggested"}`)}
                  </StatusTag>
                </span>
              </div>
            </TableCell>
            <TableCell className="text-right font-medium">
              <Amount value={r.amount} currency={r.currency} kind={amountKind(r.type)} />
            </TableCell>
            <TableCell className="truncate text-muted-foreground" title={r.description ?? undefined}>
              {r.description ?? "—"}
            </TableCell>
            <TableCell className="whitespace-normal">
              <RowActions row={r} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
