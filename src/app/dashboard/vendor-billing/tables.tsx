"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { formatCurrency } from "@/lib/format";
import { isReseller } from "@/lib/vendor-billing/account-meta";
import type { BillingAccountRow, InvoiceRow, PaymentMethodRow } from "@/lib/vendor-billing/service";
import { InvoiceTxn, ProviderStatus } from "./invoice-list";
import {
  AccountStatusChip,
  ClickableRow,
  ExpiryChip,
  MatchChip,
  ProviderBadge,
  asKind,
  day,
  expiryText,
  isCardKind,
  period,
} from "./shared";

/** 寬表格在窄螢幕橫向捲動，不把整頁撐寬。 */
function Scroll({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="min-w-0 overflow-x-auto">{children}</div>;
}

const muted = <span className="text-muted-foreground">—</span>;

export function AccountsTable({
  rows,
  today,
  onOpen,
}: Readonly<{ rows: BillingAccountRow[]; today: string; onOpen: (id: number) => void }>) {
  const t = useTranslations("vendorBilling");
  return (
    <TableCard>
      <Scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.provider")}</TableHead>
              <TableHead>{t("columns.account")}</TableHead>
              <TableHead className="text-right">{t("columns.resources")}</TableHead>
              <TableHead>{t("columns.paymentMethod")}</TableHead>
              <TableHead>{t("columns.party")}</TableHead>
              <TableHead>{t("columns.latestInvoice")}</TableHead>
              <TableHead>{t("columns.owner")}</TableHead>
              <TableHead>{t("columns.source")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={8} message={t("empty.accounts")} />
            ) : (
              rows.map((a) => {
                const pm = a.paymentMethod;
                return (
                  <ClickableRow key={a.id} onOpen={() => onOpen(a.id)}>
                    <TableCell>
                      <ProviderBadge provider={a.provider} />
                    </TableCell>
                    <TableCell className="max-w-64">
                      <div className="truncate font-medium">{a.displayName}</div>
                      {a.externalId ? (
                        <div className="truncate font-mono text-xs text-muted-foreground">{a.externalId}</div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      <div>{a.resourceCount}</div>
                      {a.missingResourceCount > 0 ? (
                        <div className="text-xs text-amber-700 dark:text-amber-400">
                          {t("cell.missingResources", { count: a.missingResourceCount })}
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {pm ? (
                        <span className="flex items-center gap-1.5">
                          <span className="truncate">{pm.label}</span>
                          {isCardKind(pm.kind) ? (
                            <ExpiryChip month={pm.expiryMonth} year={pm.expiryYear} today={today} />
                          ) : null}
                        </span>
                      ) : (
                        <span className="flex flex-col">
                          <span
                            className={
                              a.status === "active" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
                            }
                          >
                            {t("cell.notSet")}
                          </span>
                          {isReseller(a.meta) ? (
                            <span className="text-xs text-muted-foreground">{t("cell.resellerHint")}</span>
                          ) : null}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{a.partyName ?? muted}</TableCell>
                    <TableCell>
                      {a.latestInvoice ? (
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {day(a.latestInvoice.invoiceDate)}
                          </span>
                          <span className="tabular-nums">
                            {formatCurrency(a.latestInvoice.amount, a.latestInvoice.currency)}
                          </span>
                          <MatchChip status={a.latestInvoice.matchStatus} />
                        </span>
                      ) : (
                        muted
                      )}
                    </TableCell>
                    <TableCell>{a.ownerName ?? muted}</TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">
                          {t(a.source === "synced" ? "source.synced" : "source.manual")}
                        </span>
                        <AccountStatusChip status={a.status} />
                      </span>
                    </TableCell>
                  </ClickableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Scroll>
    </TableCard>
  );
}

export function MethodsTable({
  rows,
  today,
  onOpen,
}: Readonly<{ rows: PaymentMethodRow[]; today: string; onOpen: (id: number) => void }>) {
  const t = useTranslations("vendorBilling");
  return (
    <TableCard>
      <Scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.label")}</TableHead>
              <TableHead>{t("columns.kind")}</TableHead>
              <TableHead>{t("columns.last4")}</TableHead>
              <TableHead>{t("columns.expiry")}</TableHead>
              <TableHead>{t("columns.settlesFrom")}</TableHead>
              <TableHead>{t("columns.usedBy")}</TableHead>
              <TableHead>{t("columns.source")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} message={t("empty.methods")} />
            ) : (
              rows.map((m) => (
                <ClickableRow key={m.id} onOpen={() => onOpen(m.id)} className={m.isActive ? undefined : "opacity-60"}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-1.5">
                      {m.label}
                      {m.isActive ? null : (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("cell.inactive")}
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell>{t(`kind.${asKind(m.kind)}`)}</TableCell>
                  <TableCell className="font-mono tabular-nums">{m.last4 ? `•${m.last4}` : muted}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 tabular-nums">
                      {m.expiryMonth && m.expiryYear ? expiryText(m.expiryMonth, m.expiryYear) : muted}
                      {isCardKind(m.kind) ? (
                        <ExpiryChip month={m.expiryMonth} year={m.expiryYear} today={today} />
                      ) : null}
                    </span>
                  </TableCell>
                  <TableCell>{m.settlesFromAccountName ?? muted}</TableCell>
                  <TableCell className="max-w-72">
                    {m.accounts.length ? (
                      <span className="block truncate" title={m.accounts.map((a) => a.displayName).join(", ")}>
                        {m.accounts.map((a) => a.displayName).join(", ")}
                      </span>
                    ) : (
                      muted
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {t(m.source === "manual" ? "source.manual" : "source.synced")}
                  </TableCell>
                </ClickableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Scroll>
    </TableCard>
  );
}

export function InvoicesTable({
  rows,
  today,
  onOpen,
}: Readonly<{ rows: InvoiceRow[]; today: string; onOpen: (accountId: number) => void }>) {
  const t = useTranslations("vendorBilling");
  return (
    <TableCard>
      <Scroll>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.date")}</TableHead>
              <TableHead>{t("columns.invoiceAccount")}</TableHead>
              <TableHead>{t("columns.number")}</TableHead>
              <TableHead>{t("columns.period")}</TableHead>
              <TableHead className="text-right">{t("columns.amount")}</TableHead>
              <TableHead>{t("columns.providerStatus")}</TableHead>
              <TableHead>{t("columns.matchStatus")}</TableHead>
              <TableHead>{t("columns.transaction")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={8} message={t("empty.invoices")} />
            ) : (
              rows.map((inv) => (
                <ClickableRow key={inv.id} onOpen={() => onOpen(inv.billingAccountId)}>
                  <TableCell className="tabular-nums">{day(inv.invoiceDate)}</TableCell>
                  <TableCell className="max-w-48">
                    <span className="block truncate">{inv.accountName}</span>
                  </TableCell>
                  <TableCell className="font-medium">{inv.externalRef}</TableCell>
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {period(inv.periodStart, inv.periodEnd)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(inv.amount, inv.currency)}
                  </TableCell>
                  <TableCell>
                    <ProviderStatus invoice={inv} today={today} />
                  </TableCell>
                  <TableCell>
                    <MatchChip status={inv.matchStatus} />
                  </TableCell>
                  <TableCell className="max-w-72 text-xs">
                    <InvoiceTxn invoice={inv} />
                  </TableCell>
                </ClickableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Scroll>
    </TableCard>
  );
}
