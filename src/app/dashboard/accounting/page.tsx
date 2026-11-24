import { getTranslations } from "next-intl/server";
import { BookText } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { Amount } from "@/components/amount";
import { DeleteButton } from "@/components/delete-button";
import { StatusTag } from "@/components/ds/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAccountingSettings, listGlAccounts, listManualEntries, todayInTaipei } from "@/db/ledger";
import { deleteJournalEntry } from "@/db/ledger-mutations";
import { formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { AccountingNav } from "./accounting-nav";
import { NewJournalEntry } from "./journal-client";

export const dynamic = "force-dynamic";

const LEDGER_TONE = { both: "neutral", government: "primary", management: "warning" } as const;

export default async function JournalPage() {
  const t = await getTranslations("accounting");
  const { orgId } = await requireOrg();
  const [accounts, entries, settings] = await Promise.all([
    listGlAccounts(orgId),
    listManualEntries(orgId),
    getAccountingSettings(orgId),
  ]);
  const currency = settings.functionalCurrency;

  return (
    <>
      <PageHeader title={t("title")}>
        <NewJournalEntry
          accounts={accounts.map((a) => ({ id: a.id, code: a.code, name: a.name, type: a.type, isActive: a.isActive }))}
          today={todayInTaipei()}
          currency={currency}
        />
      </PageHeader>
      <AccountingNav active="journal" />
      <p className="text-sm text-muted-foreground">{t("journal.description")}</p>

      <TableCard title={t("journal.title")} action={t("journal.count", { count: entries.length })}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t("journal.date")}</TableHead>
                <TableHead>{t("journal.ledger")}</TableHead>
                <TableHead>{t("journal.memo")}</TableHead>
                <TableHead>{t("journal.lines")}</TableHead>
                <TableHead className="text-right">{t("journal.amount")}</TableHead>
                <TableHead>{t("journal.createdBy")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.length === 0 ? (
                <EmptyRow colSpan={7} icon={BookText} message={t("journal.empty")} />
              ) : (
                entries.map((e) => (
                  <TableRow key={e.id} className="align-top">
                    <TableCell className="text-xs tabular-nums">{formatDate(e.entryDate)}</TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <StatusTag tone={LEDGER_TONE[e.ledger]}>{t(`ledger.${e.ledger}`)}</StatusTag>
                        <span className="text-xs text-muted-foreground">{t(`entryKind.${e.kind}`)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="max-w-64 whitespace-normal">{e.memo ?? t("common.none")}</TableCell>
                    <TableCell>
                      <ul className="flex flex-col gap-0.5 text-xs">
                        {e.lines.map((l) => (
                          <li key={l.id} className={l.credit > 0 ? "flex gap-2 pl-4" : "flex gap-2"}>
                            <span className="text-muted-foreground">{l.debit > 0 ? t("journal.dr") : t("journal.cr")}</span>
                            <span className="min-w-0 flex-1 truncate">
                              <span className="font-mono tabular-nums">{l.code}</span> {l.name}
                            </span>
                            <Amount value={l.debit > 0 ? l.debit : l.credit} currency={currency} kind="neutral" />
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                    <TableCell className="text-right">
                      <Amount value={e.total} currency={currency} kind="neutral" />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{e.createdBy ?? t("common.none")}</TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        action={deleteJournalEntry}
                        id={e.id}
                        title={t("journal.deleteTitle")}
                        description={t("journal.deleteDescription")}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TableCard>
    </>
  );
}
