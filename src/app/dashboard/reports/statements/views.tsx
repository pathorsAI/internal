/**
 * 財務報表頁的 server 端區塊：檢查列、權益變動表、營業稅、待處理、附註。
 * 都不需要互動，列印頁也直接重用（下鑽表格在 statement-table.tsx，是 client component）。
 */
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowUpRight, CircleCheck, Inbox, Receipt } from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyRow, EmptyState } from "@/components/empty-state";
import { StatusDot, StatusTag } from "@/components/ds/status-dot";
import { TableCard } from "@/components/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Check, EquityChangesRow, ReviewItem, VatPeriodRow, VatRegime } from "@/lib/ledger/types";
import { cn } from "@/lib/utils";
import { loose, rowClass, type LooseT } from "./labels";
import type { NotesData } from "./notes";
import { sourceHref } from "./params";

/**
 * 這個檔案的翻譯一律走寬鬆的 translator：key 多半是動態組的（code、status、regime），
 * 而且整棵 statements 字典交給 next-intl 的型別推導會超過 TS 的實例化深度。
 */
async function tr(prefix = ""): Promise<LooseT> {
  const base = loose(await getTranslations("statements"));
  if (!prefix) return base;
  const f = ((key: string, values?: Record<string, string | number | Date>) => base(`${prefix}.${key}`, values)) as LooseT;
  f.has = (key: string) => base.has(`${prefix}.${key}`);
  return f;
}

const CHECK_TONE = { pass: "income", warn: "warning", fail: "risk" } as const;

/** 檢查列：每項一個色點＋短名稱；待處理筆數連到待處理頁籤。 */
export async function ChecksStrip({
  checks,
  reviewCount,
  reviewHref,
}: Readonly<{ checks: Check[]; reviewCount: number; reviewHref: string }>) {
  const t = await tr();
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border bg-card px-4 py-2.5 text-sm shadow-xs">
      <span className="text-xs font-medium text-muted-foreground">{t("checks.title")}</span>
      {checks.map((c) => (
        <span key={c.code} className="inline-flex items-center gap-1.5" title={t(`checks.status.${c.status}`)}>
          <StatusDot tone={CHECK_TONE[c.status]} />
          <span className={cn(c.status === "fail" && "text-destructive")}>{t(`checks.codes.${c.code}`)}</span>
        </span>
      ))}
      <Link href={reviewHref} className="ml-auto inline-flex items-center gap-1 text-xs text-primary hover:underline">
        {t("checks.review", { count: reviewCount })}
        <ArrowUpRight className="size-3" />
      </Link>
    </div>
  );
}

/** 權益變動表：列 = 期初、本期淨利、股本變動、其他、期末；欄 = 股本、保留盈餘、其他、合計。 */
export async function EquityTable({ rows }: Readonly<{ rows: EquityChangesRow[] }>) {
  const t = await tr();
  const cols = ["capital", "retained", "other", "total"] as const;
  return (
    <TableCard title={t("reports.eq")}>
      <div className="min-w-0 overflow-x-auto">
        <Table className="min-w-[640px]">
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.item")}</TableHead>
              {cols.map((c) => (
                <TableHead key={c} className="w-36 text-right">
                  {t(`labels.equity.columns.${c}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={5} message={t("table.empty")} />
            ) : (
              rows.map((r) => (
                <TableRow
                  key={r.key}
                  className={r.key === "opening" || r.key === "closing" ? rowClass("total") : "hover:bg-transparent"}
                >
                  <TableCell>{t(`labels.equity.${r.key}`)}</TableCell>
                  {cols.map((c) => (
                    <TableCell key={c} className={cn("text-right", c === "total" && "font-medium")}>
                      <Amount value={r[c]} kind="neutral" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </TableCard>
  );
}

/** 營業稅：每期一列，發票端與總帳端並列，差額 > 1 元標出來。 */
export async function VatTable({
  rows,
  regime,
  year,
}: Readonly<{ rows: VatPeriodRow[]; regime: VatRegime; year: number }>) {
  const t = await tr("vat");
  if (regime === "none") {
    return (
      <TableCard title={t("title", { year })}>
        <EmptyState icon={Receipt} message={t("noRegime")} />
      </TableCard>
    );
  }
  const total = (k: keyof VatPeriodRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const money = [
    "invoiceTaxableNet",
    "invoiceZeroRatedNet",
    "invoiceExemptNet",
    "invoiceOutputTax",
    "invoiceInputTax",
    "glRevenue",
    "glOutputTax",
    "glInputTax",
    "taxDue",
    "difference",
  ] as const;
  return (
    <TableCard title={t("title", { year })} action={t(`regime.${regime}`)}>
      <div className="min-w-0 overflow-x-auto">
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">{t("columns.period")}</TableHead>
              {money.map((k) => (
                <TableHead key={k} className="text-right">
                  {t(`columns.${k}`)}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={money.length + 1} icon={Receipt} message={t("empty")} />
            ) : (
              <>
                {rows.map((r) => {
                  const off = Math.abs(r.difference) > 1;
                  return (
                    <TableRow key={r.label} className="hover:bg-transparent">
                      <TableCell className="tabular-nums">{r.label}</TableCell>
                      {money.map((k) => (
                        <TableCell
                          key={k}
                          className={cn(
                            "text-right",
                            k === "taxDue" && "font-medium",
                            k === "difference" && off && "text-warning font-medium",
                          )}
                        >
                          {k === "difference" && off ? (
                            <StatusTag tone="warning">
                              <Amount value={r[k]} kind="neutral" />
                            </StatusTag>
                          ) : (
                            <Amount value={r[k]} kind="neutral" />
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
                <TableRow className={rowClass("total")}>
                  <TableCell>{t("total")}</TableCell>
                  {money.map((k) => (
                    <TableCell key={k} className="text-right">
                      <Amount value={total(k)} kind="neutral" />
                    </TableCell>
                  ))}
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t(`note.${regime}`)}</p>
    </TableCard>
  );
}

const REVIEW_ORDER: ReviewItem["code"][] = [
  "missing_fx",
  "fx_transfer_one_sided",
  "ar_residual",
  "invoice_unlinked",
  "uncategorized",
  "fx_estimated",
  "shareholder_plug",
  "unmapped_default",
  "opening_balance",
];
const SEVERITY_TONE = { error: "risk", warning: "warning", info: "neutral" } as const;

/** 待處理：依 code 分組，每組一句說明＋筆數，每筆連回來源。 */
export async function ReviewList({
  items,
  detail,
}: Readonly<{ items: ReviewItem[]; detail: (item: ReviewItem) => string }>) {
  const t = await tr();
  const lt = t;
  const tSource = await tr("source");
  if (items.length === 0) {
    return (
      <TableCard title={t("reports.review")}>
        <EmptyState icon={CircleCheck} message={t("review.empty")} />
      </TableCard>
    );
  }
  const groups = REVIEW_ORDER.map((code) => ({ code, items: items.filter((i) => i.code === code) })).filter(
    (g) => g.items.length > 0,
  );
  const unknown = items.filter((i) => !REVIEW_ORDER.includes(i.code));
  if (unknown.length > 0) groups.push({ code: unknown[0].code, items: unknown });

  return (
    <div className="grid gap-4">
      {groups.map((g) => {
        const severity = g.items[0].severity;
        const total = g.items.reduce((s, i) => s + (i.amount ?? 0), 0);
        const key = `review.codes.${g.code}`;
        return (
          <TableCard
            key={g.code}
            title={
              <span className="flex flex-wrap items-center gap-2">
                <StatusTag tone={SEVERITY_TONE[severity]}>{t(`review.severity.${severity}`)}</StatusTag>
                <span>{lt.has(`${key}.title`) ? lt(`${key}.title`) : g.code}</span>
              </span>
            }
            action={t("review.groupSummary", { count: g.items.length, amount: Math.round(total) })}
          >
            {lt.has(`${key}.description`) ? (
              <p className="border-b px-4 py-2 text-xs text-muted-foreground">{lt(`${key}.description`, { count: g.items.length })}</p>
            ) : null}
            <div className="min-w-0 overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">{t("review.columns.date")}</TableHead>
                    <TableHead className="w-24">{t("review.columns.ledger")}</TableHead>
                    <TableHead>{t("review.columns.detail")}</TableHead>
                    <TableHead className="w-36 text-right">{t("review.columns.amount")}</TableHead>
                    <TableHead className="w-28">{t("review.columns.source")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.items.slice(0, 200).map((item, i) => {
                    const href = sourceHref(item.sourceType, item.sourceId);
                    return (
                      <TableRow key={`${item.sourceType}:${item.sourceId}:${i}`} className="hover:bg-transparent">
                        <TableCell className="tabular-nums text-muted-foreground">{item.date ?? "—"}</TableCell>
                        <TableCell className="text-muted-foreground">{t(`review.ledger.${item.ledger}`)}</TableCell>
                        <TableCell className="max-w-96 truncate">{detail(item) || "—"}</TableCell>
                        <TableCell className="text-right">
                          {item.amount === null ? "—" : <Amount value={item.amount} kind="neutral" />}
                        </TableCell>
                        <TableCell>
                          {href ? (
                            <Link href={href} className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline">
                              {tSource(item.sourceType)}
                              {item.sourceId === null ? null : <span className="tabular-nums">#{item.sourceId}</span>}
                              <ArrowUpRight className="size-3" />
                            </Link>
                          ) : (
                            <span className="text-xs text-muted-foreground">{tSource(item.sourceType)}</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {g.items.length > 200 ? (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                {t("review.truncated", { shown: 200, count: g.items.length })}
              </p>
            ) : null}
          </TableCard>
        );
      })}
    </div>
  );
}

function NoteSection({ n, title, children }: Readonly<{ n: number; title: string; children: React.ReactNode }>) {
  return (
    <section className="grid gap-2 break-inside-avoid">
      <h3 className="text-sm font-semibold">
        <span className="mr-1 tabular-nums">{n}.</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

function SimpleTable({
  headers,
  rows,
  total,
  empty,
}: Readonly<{
  headers: { label: string; right?: boolean }[];
  /** 每列一個穩定的 key；cells 跟 headers 一一對應 */
  rows: { key: string | number; cells: React.ReactNode[] }[];
  total?: React.ReactNode[];
  empty: string;
}>) {
  const cellsOf = (cells: React.ReactNode[]) =>
    headers.map((h, j) => (
      <TableCell key={h.label} className={h.right ? "text-right" : undefined}>
        {cells[j]}
      </TableCell>
    ));
  return (
    <TableCard>
      <div className="min-w-0 overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              {headers.map((h) => (
                <TableHead key={h.label} className={h.right ? "text-right" : undefined}>
                  {h.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={headers.length} message={empty} />
            ) : (
              rows.map((row) => (
                <TableRow key={row.key} className="hover:bg-transparent">
                  {cellsOf(row.cells)}
                </TableRow>
              ))
            )}
            {total && rows.length > 0 ? (
              <TableRow className={rowClass("total")}>{cellsOf(total)}</TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </TableCard>
  );
}

/** 附註：台灣財報附註的骨架，數字從分錄來，文字是範本（給會計師改）。 */
export async function NotesView({ data }: Readonly<{ data: NotesData }>) {
  const t = await tr("notes");
  const locale = await getLocale();
  const money = (v: number) => <Amount value={v} kind="neutral" />;
  const unknown = t("unknown");
  const month = new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2000, data.fiscalYearStartMonth - 1, 1));

  return (
    <div className="grid gap-6">
      <NoteSection n={1} title={t("history.title")}>
        <p className="text-sm leading-relaxed">{t("history.body", { org: data.orgName })}</p>
      </NoteSection>

      <NoteSection n={2} title={t("policies.title")}>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">{t("policies.framework")}</dt>
          <dd>{t("policies.frameworkBody", { framework: data.framework })}</dd>
          <dt className="text-muted-foreground">{t("policies.currency")}</dt>
          <dd>{t("policies.currencyBody", { currency: data.functionalCurrency })}</dd>
          <dt className="text-muted-foreground">{t("policies.basis")}</dt>
          <dd>{t("policies.basisBody")}</dd>
          <dt className="text-muted-foreground">{t("policies.fiscalYear")}</dt>
          <dd>{t("policies.fiscalYearBody", { month })}</dd>
          <dt className="text-muted-foreground">{t("policies.fx")}</dt>
          <dd>{t("policies.fxBody", { currency: data.functionalCurrency })}</dd>
          <dt className="text-muted-foreground">{t("policies.ppe")}</dt>
          <dd>{t("policies.ppeBody")}</dd>
          <dt className="text-muted-foreground">{t("policies.revenue")}</dt>
          <dd>{t("policies.revenueBody")}</dd>
        </dl>
      </NoteSection>

      <NoteSection n={3} title={t("cash.title", { date: data.asOf })}>
        <SimpleTable
          headers={[
            { label: t("cash.account") },
            { label: t("cash.currency") },
            { label: t("cash.fxBalance"), right: true },
            { label: t("cash.balance", { currency: data.functionalCurrency }), right: true },
          ]}
          rows={data.cash.map((c) => ({
            key: c.bankAccountId,
            cells: [
              c.name,
              <span key="c" className="tabular-nums">{c.currency}</span>,
              c.fxBalance === null ? "—" : <Amount key="f" value={c.fxBalance} currency={c.currency} kind="neutral" />,
              money(c.balance),
            ],
          }))}
          total={[t("total"), "", "", money(data.cashTotal)]}
          empty={t("cash.empty")}
        />
      </NoteSection>

      <NoteSection n={4} title={t("receivables.title")}>
        <SimpleTable
          headers={[{ label: t("receivables.party") }, { label: t("receivables.balance"), right: true }]}
          rows={data.receivables.map((r) => ({ key: r.partyId ?? "none", cells: [r.name ?? unknown, money(r.balance)] }))}
          total={[t("total"), money(data.receivablesTotal)]}
          empty={t("receivables.empty")}
        />
      </NoteSection>

      <NoteSection n={5} title={t("employees.title")}>
        <SimpleTable
          headers={[{ label: t("employees.employee") }, { label: t("employees.balance"), right: true }]}
          rows={data.employeeAdvances.map((r) => ({ key: r.employeeId ?? "none", cells: [r.name ?? unknown, money(r.balance)] }))}
          total={[t("total"), money(data.employeeAdvancesTotal)]}
          empty={t("employees.empty")}
        />
      </NoteSection>

      <NoteSection n={6} title={t("shareholder.title")}>
        <p className="text-sm leading-relaxed">
          {t("shareholder.body", {
            direction: data.shareholderBalance >= 0 ? "owed" : "receivable",
            amount: Math.abs(Math.round(data.shareholderBalance)).toLocaleString(locale),
            date: data.asOf,
          })}
        </p>
        {data.ledger === "government" ? (
          <p className="text-xs text-muted-foreground">{t("shareholder.governmentNote", { count: data.shareholderEntries })}</p>
        ) : null}
      </NoteSection>

      <NoteSection n={7} title={t("ppe.title")}>
        <SimpleTable
          headers={[
            { label: t("ppe.name") },
            { label: t("ppe.acquiredOn") },
            { label: t("ppe.life"), right: true },
            { label: t("ppe.cost"), right: true },
            { label: t("ppe.accumulated"), right: true },
            { label: t("ppe.net"), right: true },
          ]}
          rows={data.fixedAssets.map((a) => ({
            key: a.id,
            cells: [
              <span key="n">
                {a.name}
                {a.disposedOn ? <span className="ml-1 text-xs text-muted-foreground">{t("ppe.disposed", { date: a.disposedOn })}</span> : null}
              </span>,
              <span key="d" className="tabular-nums">{a.acquiredOn}</span>,
              <span key="l" className="tabular-nums">{t("ppe.months", { count: a.usefulLifeMonths })}</span>,
              money(a.cost),
              money(a.accumulated),
              money(a.net),
            ],
          }))}
          total={[
            t("total"),
            "",
            "",
            money(data.fixedAssetTotals.cost),
            money(data.fixedAssetTotals.accumulated),
            money(data.fixedAssetTotals.net),
          ]}
          empty={t("ppe.empty")}
        />
      </NoteSection>
    </div>
  );
}

/** 還沒有任何交易時的初始畫面。 */
export async function StatementsEmpty() {
  const t = await tr("empty");
  return (
    <TableCard>
      <EmptyState icon={Inbox} message={t("message")}>
        <Link href="/dashboard/transactions" className="text-sm text-primary hover:underline">
          {t("cta")}
        </Link>
      </EmptyState>
    </TableCard>
  );
}
