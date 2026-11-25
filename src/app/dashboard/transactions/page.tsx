import { Fragment } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BookBadge } from "@/components/book-badge";
import { StatusTag } from "@/components/ds/status-dot";
import { TableCard } from "@/components/table-card";
import { EmptyState } from "@/components/empty-state";
import { ReceiptText } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listTransactions,
  countTransactions,
  getAuditMeta,
  listDocumentsForTransactions,
  listBankAccounts,
  listCategories,
  listParties,
  listEmployees,
  listProjects,
  listContractOptions,
  listTransactionMonths,
  type Book,
  type TxnDocument,
  type AuditMeta,
} from "@/db/queries";
import { PaginationNav } from "@/components/pagination-nav";
import type { ContractOption } from "./contract-combobox";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewTransactionDialog } from "./new-transaction-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteTransaction } from "@/db/mutations";
import { RowDialog } from "@/components/row-dialog";
import { EditTransactionForm } from "./edit-transaction-form";
import { TransactionFilters } from "./transaction-filters";
import { Amount, amountKind } from "@/components/amount";
import { conversionCurrencies, externalSingleLegSide } from "@/lib/external-transfer";
import { requireOrg } from "@/lib/session";
import { formatAccountShort } from "@/lib/employee-accounts";
import { getTranslations } from "next-intl/server";
import { PartyAvatar } from "@/components/party-avatar";
import { parseIdsParam } from "@/lib/ids-param";
import { getDb } from "@/db";
import { countPendingLinks, pendingLinkIdsAmong } from "@/lib/linking/pending";

export const dynamic = "force-dynamic";

type TxnRow = Awaited<ReturnType<typeof listTransactions>>[number];
type Opt = { id: number; name: string };
type AccountOpt = { id: number; name: string; currency: string };

// 依年月分組（rows 已照日期新到舊排序，保留順序）
function groupByMonth(rows: TxnRow[]) {
  const map = new Map<string, TxnRow[]>();
  for (const t of rows) {
    const ym = t.txnDate.slice(0, 7);
    const arr = map.get(ym) ?? [];
    arr.push(t);
    map.set(ym, arr);
  }
  return [...map.entries()].map(([ym, items]) => {
    const [y, m] = ym.split("-");
    return { ym, year: y, month: m, rows: items };
  });
}

function TransactionRow({
  t,
  typeLabel,
  editDialogTitle,
  editDialogDescription,
  uncategorizedLabel,
  needsReviewLabel,
  needsReviewHint,
  pendingLink,
  pendingLinkLabel,
  pendingLinkHint,
  conversionLabel,
  categories,
  parties,
  employees,
  accounts,
  projects,
  contracts,
  docs,
  audit,
  partyAvatarVersion,
}: Readonly<{
  t: TxnRow;
  typeLabel: Record<string, string>;
  editDialogTitle: string;
  editDialogDescription: string;
  uncategorizedLabel: string;
  needsReviewLabel: string;
  /** 待確認 chip 的說明；{source} 會換成來源（wise）。 */
  needsReviewHint: (source: string) => string;
  /** 待連結（review_reason 待處理）：顯示一個連到待連結頁的標記 */
  pendingLink: boolean;
  pendingLinkLabel: string;
  pendingLinkHint: string;
  /** 外部同步的單腳轉帳（Wise 換匯）的類型標籤，例如「換匯 USD → THB」。 */
  conversionLabel: (c: { from: string; to: string } | null) => string;
  categories: Opt[];
  parties: Opt[];
  employees: Opt[];
  accounts: AccountOpt[];
  projects: Opt[];
  contracts: ContractOption[];
  docs: TxnDocument[];
  audit?: AuditMeta;
  /** 交易對象的頭像版本（null = 沒有頭像，顯示首字） */
  partyAvatarVersion: string | null;
}>) {
  // 表格上「最後更新」的操作人：改過就顯示最後修改人，沒改過就顯示建立人
  const updater = audit?.updatedBy ?? audit?.createdBy ?? null;
  const singleLeg = externalSingleLegSide(t) !== null;
  const typeText = singleLeg
    ? conversionLabel(conversionCurrencies(t.externalMeta, t.currency))
    : (typeLabel[t.type] ?? t.type);
  return (
    <RowDialog
      variant="sheet"
      rowId={t.id}
      title={editDialogTitle}
      description={editDialogDescription}
      cells={
        <>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {formatDate(t.txnDate)}
          </TableCell>
          <TableCell>
            <div className="flex min-w-0 flex-col gap-1">
              {t.partyId != null && t.partyName ? (
                <span className="flex min-w-0 items-center gap-1.5">
                  <PartyAvatar
                    name={t.partyName}
                    partyId={t.partyId}
                    avatarVersion={partyAvatarVersion}
                    size="sm"
                  />
                  <span className="truncate font-medium">{t.partyName}</span>
                </span>
              ) : (
                <span className="truncate font-medium">{t.settleName ?? "—"}</span>
              )}
              {t.settleToAccountLast5 ? (
                <span className="truncate text-xs text-muted-foreground">
                  →{" "}
                  {formatAccountShort({
                    bankName: t.settleToBankName,
                    label: null,
                    bankCode: null,
                    accountLast5: t.settleToAccountLast5,
                  })}
                </span>
              ) : null}
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate text-xs text-muted-foreground">{typeText}</span>
                {t.needsReview ? (
                  <span title={needsReviewHint(t.externalSource ?? "—")}>
                    <StatusTag tone="warning">{needsReviewLabel}</StatusTag>
                  </span>
                ) : null}
                {pendingLink ? (
                  <Link href="/dashboard/links" title={pendingLinkHint}>
                    <StatusTag tone="primary">{pendingLinkLabel}</StatusTag>
                  </Link>
                ) : null}
              </div>
            </div>
          </TableCell>
          <TableCell>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="truncate">{t.description ?? "—"}</span>
              {/* 銀行自己的備註原文（對帳單／Wise），跟人寫的說明分開顯示 */}
              {t.bankMemo ? (
                <span className="truncate text-xs text-muted-foreground" title={t.bankMemo}>
                  {t.bankMemo}
                </span>
              ) : null}
            </div>
          </TableCell>
          <TableCell className="truncate text-muted-foreground">
            {t.categoryName ?? uncategorizedLabel}
          </TableCell>
          <TableCell className="overflow-hidden">
            <BookBadge book={t.book} />
          </TableCell>
          <TableCell className="truncate text-xs text-muted-foreground">
            {[t.fromAccount, t.toAccount].filter(Boolean).join(" → ") || "—"}
          </TableCell>
          <TableCell className="text-xs text-subtle-foreground">
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{formatDateTime(t.updatedAt)}</span>
              {updater ? <span className="truncate">{updater}</span> : null}
            </div>
          </TableCell>
          <TableCell className="text-right font-medium">
            <Amount value={t.amount} currency={t.currency} kind={amountKind(t.type)} />
          </TableCell>
        </>
      }
    >
      <EditTransactionForm
        txn={{
          id: t.id,
          type: t.type,
          txnDate: t.txnDate,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          categoryId: t.categoryId,
          book: t.book,
          billedToCompanyTaxId: t.billedToCompanyTaxId,
          partyName: t.partyName,
          settleName: t.settleName,
          fromAccountId: t.fromAccountId,
          toAccountId: t.toAccountId,
          externalSource: t.externalSource,
          conversionText: singleLeg ? typeText : null,
          projectId: t.projectId,
          contractId: t.contractId,
          bankMemo: t.bankMemo,
          bankRef: t.bankRef,
        }}
        categories={categories}
        parties={parties}
        employees={employees}
        accounts={accounts}
        projects={projects}
        contracts={contracts}
        docs={docs}
        audit={audit}
        footer={<DeleteButton action={deleteTransaction} id={t.id} />}
      />
    </RowDialog>
  );
}

const PAGE_SIZE = 50;

/** 網址上的 id 篩選（?category= / ?account= / ?party=）：不是數字就當沒篩。 */
function idParam(v: string | undefined): number | undefined {
  return v && Number.isFinite(Number(v)) ? Number(v) : undefined;
}

/** 同 idParam，另外接受 none（未分類 / 未指定對象；報表「支出分析」連過來的）。 */
function idOrNoneParam(v: string | undefined): number | "none" | undefined {
  return v === "none" ? "none" : idParam(v);
}

/** 解析網址上的篩選參數，得出列表查詢條件與要帶回網址的值。 */
function parseTransactionFilters(params: {
  book?: string;
  category?: string;
  account?: string;
  period?: string;
  page?: string;
  review?: string;
  party?: string;
  ids?: string | string[];
  link?: string;
  q?: string;
}) {
  const { book, category, account, period, page: pageParam, review, party, ids: idsParam, link, q: qParam } = params;
  const active = (["internal", "external", "both"].includes(book ?? "") ? book : undefined) as
    | Book
    | undefined;
  const categoryId = idOrNoneParam(category);
  const accountId = idParam(account);
  const partyId = idOrNoneParam(party);
  const page = Math.max(1, Math.trunc(Number(pageParam)) || 1);
  const needsReview = review === "1" ? true : undefined;
  const ids = parseIdsParam(idsParam) ?? undefined;
  const idsQuery = ids?.join(",");
  const pendingLink = link === "pending" ? true : undefined;
  const linkQuery = pendingLink ? "pending" : undefined;
  const q = qParam?.trim() || undefined;
  const filters = { book: active, categoryId, accountId, partyId, period, needsReview, ids, pendingLink, q };
  return { active, partyId, page, needsReview, ids, idsQuery, pendingLink, linkQuery, q, filters };
}

/** 網址 query：拿掉 undefined 的鍵（鍵的順序照傳入的物件，覆寫既有鍵不會改變順序）。 */
function definedQuery(entries: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).filter((e): e is [string, string] => e[1] !== undefined),
  );
}

const NOTICE_LINK_CLASS = "text-muted-foreground underline-offset-2 hover:underline";

/** 「待確認」提示列：切換只看自動匯入、待確認的列。query 是其餘要保留的篩選。 */
async function ReviewNotice({
  reviewCount,
  needsReview,
  query,
}: Readonly<{ reviewCount: number; needsReview: boolean; query: Record<string, string | undefined> }>) {
  const tr = await getTranslations("transactions");
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusTag tone="warning">{tr("review.count", { count: reviewCount })}</StatusTag>
      <Link
        className={NOTICE_LINK_CLASS}
        href={{
          pathname: "/dashboard/transactions",
          query: definedQuery({ ...query, review: needsReview ? undefined : "1" }),
        }}
      >
        {needsReview ? tr("review.showAll") : tr("review.showOnly")}
      </Link>
    </div>
  );
}

/** 「待連結」提示列：切換只看待連結的列，另附連到待連結頁。query 是其餘要保留的篩選。 */
async function PendingLinkNotice({
  pendingLinkCount,
  pendingLink,
  query,
}: Readonly<{ pendingLinkCount: number; pendingLink: boolean; query: Record<string, string | undefined> }>) {
  const tl = await getTranslations("links");
  return (
    <div className="flex items-center gap-2 text-sm">
      <StatusTag tone="primary">{tl("count", { count: pendingLinkCount })}</StatusTag>
      <Link
        className={NOTICE_LINK_CLASS}
        href={{
          pathname: "/dashboard/transactions",
          query: definedQuery({ ...query, link: pendingLink ? undefined : "pending" }),
        }}
      >
        {pendingLink ? tl("transactions.showAll") : tl("transactions.showOnly")}
      </Link>
      <Link className={NOTICE_LINK_CLASS} href="/dashboard/links">
        {tl("transactions.open")}
      </Link>
    </div>
  );
}

export default async function TransactionsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    book?: string;
    category?: string;
    account?: string;
    period?: string;
    page?: string;
    /** review=1：只看自動匯入、待確認的列。 */
    review?: string;
    /** 交易對象 id（總覽「支出去向」點進來的） */
    party?: string;
    /** ids=1,2,3：只看這幾筆（Discord 通知連到這裡）。 */
    ids?: string | string[];
    /** link=pending：只看待連結（還沒確定屬於哪一筆請款 / 訂閱 / 合約，或對象待確認）。 */
    link?: string;
    /** 文字搜尋：說明、銀行備註、銀行參考號、對象名稱。 */
    q?: string;
  }>;
}>) {
  const { orgId } = await requireOrg();
  const tr = await getTranslations("transactions");
  const tl = await getTranslations("links");
  const typeLabel: Record<string, string> = {
    expense: tr("type.expense"),
    income: tr("type.income"),
    advance: tr("type.advance"),
    reimbursement: tr("type.reimbursement"),
    transfer: tr("type.transfer"),
  };
  // table-fixed 下，欄寬由表頭決定，各月份共用同一組欄寬 → 金額欄永遠對齊
  const COLUMNS: { label: string; width: string; align?: "right" }[] = [
    { label: tr("columns.date"), width: "w-24" },
    { label: tr("columns.counterparty"), width: "w-52" },
    { label: tr("columns.description"), width: "" },
    { label: tr("columns.category"), width: "w-28" },
    { label: tr("columns.book"), width: "w-32" },
    { label: tr("columns.account"), width: "w-36" },
    { label: tr("columns.lastUpdated"), width: "w-32" },
    { label: tr("columns.amount"), width: "w-32", align: "right" },
  ];
  const params = await searchParams;
  const { book, category, account, period, review, party } = params;
  const { active, partyId, page, needsReview, ids, idsQuery, pendingLink, linkQuery, q, filters } =
    parseTransactionFilters(params);
  const db = getDb();
  const [rows, total, accounts, categories, parties, employees, projects, contracts, months, reviewCount, pendingLinkCount] =
    await Promise.all([
      listTransactions(orgId, filters, PAGE_SIZE, (page - 1) * PAGE_SIZE),
      countTransactions(orgId, filters),
      listBankAccounts(orgId),
      listCategories(orgId),
      listParties(orgId),
      listEmployees(orgId),
      listProjects(orgId),
      listContractOptions(orgId),
      listTransactionMonths(orgId),
      countTransactions(orgId, { needsReview: true }),
      countPendingLinks(db, orgId),
    ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [docsMap, auditMap, pendingLinkIds] = await Promise.all([
    listDocumentsForTransactions(orgId, rows.map((r) => r.id)),
    getAuditMeta(orgId, "transaction", rows.map((r) => r.id)),
    pendingLinkIdsAmong(db, orgId, rows.map((r) => r.id)),
  ]);
  const partyOpts = parties.map((s) => ({ id: s.id, name: s.name }));
  const avatarByParty = new Map(parties.map((s) => [s.id, s.avatarVersion]));
  const employeeOpts = employees.map((e) => ({ id: e.id, name: e.name }));
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const projectOpts = projects.map((p) => ({ id: p.id, name: p.name }));
  // 合約下拉的顯示字串：標題（客戶），避免同名合約難以分辨
  const contractOpts: ContractOption[] = contracts.map((c) => ({
    id: c.id,
    label: c.customerName ? `${c.title} (${c.customerName})` : c.title,
  }));
  const groups = groupByMonth(rows);

  return (
    <>
      <PageHeader title={tr("page.title")}>
        <NewTransactionDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          categories={categories}
          parties={parties.map((s) => ({ id: s.id, name: s.name }))}
          employees={employees.map((e) => ({ id: e.id, name: e.name }))}
          projects={projectOpts}
          contracts={contractOpts}
        />
      </PageHeader>

      <TransactionFilters
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        accounts={accountOpts}
        parties={partyOpts}
        months={months}
        book={active}
        category={category}
        account={account}
        party={partyId === undefined ? undefined : String(partyId)}
        period={period}
        q={q}
      />

      {reviewCount > 0 || needsReview ? (
        <ReviewNotice
          reviewCount={reviewCount}
          needsReview={needsReview === true}
          query={{ book, category, account, party, period, review: undefined, ids: idsQuery, link: linkQuery, q }}
        />
      ) : null}

      {pendingLinkCount > 0 || pendingLink ? (
        <PendingLinkNotice
          pendingLinkCount={pendingLinkCount}
          pendingLink={pendingLink === true}
          query={{ book, category, account, party, period, review, ids: idsQuery, link: undefined, q }}
        />
      ) : null}

      {ids ? (
        <div className="flex items-center gap-2 text-sm">
          <StatusTag tone="primary">{tr("selected.notice", { count: total })}</StatusTag>
          <Link
            className="text-muted-foreground underline-offset-2 hover:underline"
            href="/dashboard/transactions"
          >
            {tr("selected.clear")}
          </Link>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <TableCard>
          <EmptyState
            icon={ReceiptText}
            message={total === 0 ? tr("empty.noData") : tr("empty.noPageData")}
          />
        </TableCard>
      ) : (
        <TableCard>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c.label}
                    className={cn(c.width, c.align === "right" && "text-right")}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.ym}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={COLUMNS.length}
                      className="h-8 bg-muted/30 py-1 text-xs text-muted-foreground"
                    >
                      <span className="font-medium">
                        {tr("table.monthLabel", { year: g.year, month: g.month })}
                      </span>
                      <span className="ml-2 text-subtle-foreground">
                        {tr("table.rowsCount", { count: g.rows.length })}
                      </span>
                    </TableCell>
                  </TableRow>
                  {g.rows.map((t) => (
                    <TransactionRow
                      key={t.id}
                      t={t}
                      typeLabel={typeLabel}
                      editDialogTitle={tr("editDialog.title")}
                      editDialogDescription={tr("editDialog.description")}
                      uncategorizedLabel={tr("table.uncategorized")}
                      needsReviewLabel={tr("table.needsReview")}
                      needsReviewHint={(source) => tr("table.needsReviewHint", { source })}
                      pendingLink={pendingLinkIds.has(t.id)}
                      pendingLinkLabel={tl("transactions.badge")}
                      pendingLinkHint={tl("transactions.badgeHint")}
                      conversionLabel={(c) =>
                        c ? tr("type.conversion", c) : tr("type.conversionPlain")
                      }
                      categories={categories}
                      parties={partyOpts}
                      employees={employeeOpts}
                      accounts={accountOpts}
                      projects={projectOpts}
                      contracts={contractOpts}
                      docs={docsMap.get(t.id) ?? []}
                      audit={auditMap.get(t.id)}
                      partyAvatarVersion={t.partyId == null ? null : (avatarByParty.get(t.partyId) ?? null)}
                    />
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}

      <PaginationNav
        page={page}
        totalPages={totalPages}
        total={total}
        basePath="/dashboard/transactions"
        params={{ book, category, account, party, period, review, ids: idsQuery, link: linkQuery, q }}
      />
    </>
  );
}
