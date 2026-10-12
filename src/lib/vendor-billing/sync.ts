import { and, eq, inArray, isNull, max, notInArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  paymentMethods,
  vendorBillingAccounts,
  vendorBillingResources,
  vendorCostLines,
  vendorInvoices,
} from "@/db/schema";
import {
  AzureApiError,
  AzureAuthError,
  azureBillingAccountId,
  discoverAzureProfiles,
  subscriptionResourceStatus,
  subscriptionsForProfile,
  withAzureClient,
  type ParsedAzureInvoice,
  type ParsedPaymentMethod,
} from "@/lib/integrations/azure";
import {
  GcpApiError,
  GcpAuthError,
  monthlyInvoicesFromCosts,
  withGcpClient,
  type GcpClient,
  type GcpMonthlyInvoice,
  type GcpProjectBilling,
  type GcpProjectInfo,
} from "@/lib/integrations/gcp";
import { updateConfig } from "@/lib/integrations/store";
import { planCardSync, type ExistingPaymentMethod } from "./card-dedupe";
import { reconcileVendorInvoices, type ReconcileResult } from "./reconcile";
import {
  filterAllowlisted,
  matchExportTables,
  parseAzureScope,
  parseGcpScope,
  type BigQueryExport,
  type GcpDiscoveredAccount,
} from "./scope";
import {
  aggregateCostLines,
  azureCostResource,
  firstOfMonth,
  monthChunks,
  syncWindowStart,
  taipeiToday,
  yyyymm,
  type CostLineInput,
} from "./sync-plan";

/**
 * Azure / GCP 計費資料 → 本組織的 vendor_* 表，然後跑一次對帳。
 *
 * - 只碰設定頁勾選的範圍（Azure config.billingProfileIds、GCP config.billingAccountIds）；
 *   範圍是空的就什麼都不做（scopeEmpty = true），也不打外部 API 以外的東西。
 * - 計費帳號以 (org, provider, external_id) upsert；勾選了但平台上找不到 → missing，不刪。
 * - 資源以 (帳號, external_id) upsert；這次沒出現的 → missing。updated_at 只在狀態改變時更新
 *   （「最近變成 missing」的提醒靠它）。
 * - 付款卡（只有 Azure 讀得到）以 (org, 'azure', payment method id) upsert；沒有的話先收編唯一一張
 *   資料相同的手動卡（card-dedupe.ts）。帳號的付款方式只在「沒設」或「原本就是同步來的」時才改，
 *   不覆寫人工指定的。
 * - 發票以 (org, source, external_ref) upsert，只更新金額 / 狀態 / 日期，不動對帳欄位。
 * - 費用明細以 (帳號, 月, 資源, 服務, source) upsert，覆寫金額。純分析，不進帳本。
 * 外部錯誤：憑證被拒 → 整合標 needs_reauth（由 withAzureClient / withGcpClient 處理）並往外丟；
 * 單一步驟的其他錯誤（例如費用查詢 429）記在 warnings，其他步驟照跑。
 */

type Db = ReturnType<typeof getDb>;
type Provider = "azure" | "gcp";

export type CloudSyncResult = {
  provider: Provider;
  /** 範圍沒勾任何東西 → 什麼都沒同步。 */
  scopeEmpty: boolean;
  accounts: { synced: number; created: number; missing: number };
  resources: { synced: number; created: number; missing: number };
  paymentMethods: number;
  invoices: { synced: number; created: number };
  costLines: number;
  reconcile: ReconcileResult | null;
  warnings: string[];
};

function emptyResult(provider: Provider): CloudSyncResult {
  return {
    provider,
    scopeEmpty: false,
    accounts: { synced: 0, created: 0, missing: 0 },
    resources: { synced: 0, created: 0, missing: 0 },
    paymentMethods: 0,
    invoices: { synced: 0, created: 0 },
    costLines: 0,
    reconcile: null,
    warnings: [],
  };
}

/** 「帳單 12（新 3）」：有新的才加括號。 */
function countWithNew(label: string, total: number, created: number): string {
  const suffix = created ? "（新 " + created + "）" : "";
  return `${label} ${total}${suffix}`;
}

function reconcileSummary(r: ReconcileResult): string {
  const parts = [`自動綁定 ${r.matched}`, `建議 ${r.suggested}`];
  if (r.created) parts.push(`新建交易 ${r.created}`);
  return `對帳：${parts.join("、")}`;
}

/** 一行 zh-TW 摘要（自動同步的 lastAutoSync、操作紀錄、web toast 共用）。 */
export function summarizeCloudSync(r: CloudSyncResult): string {
  if (r.scopeEmpty) return "尚未勾選要同步的計費範圍，略過";
  const parts = [
    countWithNew("計費帳號", r.accounts.synced, r.accounts.created),
    countWithNew("資源", r.resources.synced, r.resources.created),
  ];
  const missing = r.accounts.missing + r.resources.missing;
  if (missing > 0) parts.push(`平台上找不到 ${missing}`);
  if (r.provider === "azure") parts.push(`付款卡 ${r.paymentMethods}`);
  parts.push(countWithNew("帳單", r.invoices.synced, r.invoices.created));
  if (r.costLines > 0) parts.push(`費用明細 ${r.costLines} 列`);
  if (r.reconcile) parts.push(reconcileSummary(r.reconcile));
  if (r.warnings.length > 0) parts.push(`警告：${r.warnings.join("；")}`);
  return parts.join("、");
}

const isAuthError = (e: unknown) => e instanceof AzureAuthError || e instanceof GcpAuthError;
const isApiError = (e: unknown) => e instanceof AzureApiError || e instanceof GcpApiError;

/** 單一步驟的軟失敗：憑證錯往外丟（整個同步要停），其他外部錯誤記成警告。 */
async function soft<T>(warnings: string[], label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isAuthError(e) || !isApiError(e)) throw e;
    warnings.push(`${label}：${(e as Error).message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// 共用的 upsert
// ---------------------------------------------------------------------------

async function upsertSyncedAccount(
  db: Db,
  orgId: string,
  provider: Provider,
  externalId: string,
  displayName: string,
  status: "active" | "closed",
  metaPatch: Record<string, unknown>,
): Promise<{ id: number; created: boolean; lastInvoiceDate: string | null }> {
  const [row] = await db
    .insert(vendorBillingAccounts)
    .values({
      organizationId: orgId,
      provider,
      externalId,
      displayName,
      source: "synced",
      status,
      lastSeenAt: sql`now()`,
      meta: metaPatch,
    })
    .onConflictDoUpdate({
      target: [vendorBillingAccounts.organizationId, vendorBillingAccounts.provider, vendorBillingAccounts.externalId],
      targetWhere: sql`external_id IS NOT NULL`,
      set: {
        displayName,
        source: "synced",
        status,
        lastSeenAt: sql`now()`,
        meta: sql`${vendorBillingAccounts.meta} || ${JSON.stringify(metaPatch)}::jsonb`,
        deletedAt: null,
        // updated_at 只在狀態改變時動（「最近變成 missing / closed」靠它）
        updatedAt: sql`CASE WHEN ${vendorBillingAccounts.status} IS DISTINCT FROM excluded.status THEN now() ELSE ${vendorBillingAccounts.updatedAt} END`,
      },
    })
    .returning({ id: vendorBillingAccounts.id, created: sql<boolean>`(xmax = 0)` });
  const [last] = await db
    .select({ d: max(vendorInvoices.invoiceDate) })
    .from(vendorInvoices)
    .where(and(eq(vendorInvoices.organizationId, orgId), eq(vendorInvoices.billingAccountId, row.id)));
  return { id: row.id, created: Boolean(row.created), lastInvoiceDate: last?.d ?? null };
}

/** 勾選了、但這次平台上沒出現的帳號 → missing（只在狀態改變時更新 updated_at）。 */
async function markAccountsMissing(db: Db, orgId: string, provider: Provider, externalIds: string[]): Promise<number> {
  if (externalIds.length === 0) return 0;
  const rows = await db
    .update(vendorBillingAccounts)
    .set({ status: "missing", updatedAt: sql`now()` })
    .where(
      and(
        eq(vendorBillingAccounts.organizationId, orgId),
        eq(vendorBillingAccounts.provider, provider),
        inArray(vendorBillingAccounts.externalId, externalIds),
        eq(vendorBillingAccounts.source, "synced"),
        isNull(vendorBillingAccounts.deletedAt),
        sql`${vendorBillingAccounts.status} <> 'missing'`,
      ),
    )
    .returning({ id: vendorBillingAccounts.id });
  return rows.length;
}

type ResourceInput = {
  kind: "azure_subscription" | "gcp_project";
  externalId: string;
  name: string | null;
  labels: Record<string, string>;
  status: "active" | "missing";
};

async function upsertResources(
  db: Db,
  orgId: string,
  billingAccountId: number,
  items: ResourceInput[],
): Promise<{ synced: number; created: number; missing: number }> {
  let created = 0;
  if (items.length > 0) {
    const rows = await db
      .insert(vendorBillingResources)
      .values(
        items.map((r) => ({
          organizationId: orgId,
          billingAccountId,
          kind: r.kind,
          externalId: r.externalId,
          name: r.name,
          labels: r.labels,
          status: r.status,
          lastSeenAt: sql`now()`,
        })),
      )
      .onConflictDoUpdate({
        target: [vendorBillingResources.billingAccountId, vendorBillingResources.externalId],
        set: {
          kind: sql`excluded.kind`,
          name: sql`COALESCE(excluded.name, ${vendorBillingResources.name})`,
          labels: sql`excluded.labels`,
          status: sql`excluded.status`,
          lastSeenAt: sql`now()`,
          updatedAt: sql`CASE WHEN ${vendorBillingResources.status} IS DISTINCT FROM excluded.status THEN now() ELSE ${vendorBillingResources.updatedAt} END`,
        },
      })
      .returning({ created: sql<boolean>`(xmax = 0)` });
    created = rows.filter((r) => r.created).length;
  }
  const seen = items.map((r) => r.externalId);
  const missing = await db
    .update(vendorBillingResources)
    .set({ status: "missing", updatedAt: sql`now()` })
    .where(
      and(
        eq(vendorBillingResources.organizationId, orgId),
        eq(vendorBillingResources.billingAccountId, billingAccountId),
        eq(vendorBillingResources.status, "active"),
        seen.length > 0 ? notInArray(vendorBillingResources.externalId, seen) : undefined,
      ),
    )
    .returning({ id: vendorBillingResources.id });
  return { synced: items.length, created, missing: missing.length };
}

type InvoiceInput = {
  externalRef: string;
  invoiceDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  amount: number;
  currency: string;
  status: string | null;
  meta: Record<string, unknown>;
};

async function upsertInvoices(
  db: Db,
  orgId: string,
  billingAccountId: number,
  source: "azure_invoice" | "gcp_bigquery",
  items: InvoiceInput[],
): Promise<{ synced: number; created: number }> {
  if (items.length === 0) return { synced: 0, created: 0 };
  // 同一批裡同鍵只取最後一筆（ON CONFLICT 不能在同一句更新同一列兩次）
  const unique = [...new Map(items.map((i) => [i.externalRef, i])).values()];
  const rows = await db
    .insert(vendorInvoices)
    .values(
      unique.map((i) => ({
        organizationId: orgId,
        billingAccountId,
        externalRef: i.externalRef,
        source,
        periodStart: i.periodStart,
        periodEnd: i.periodEnd,
        invoiceDate: i.invoiceDate,
        amount: i.amount.toFixed(2),
        currency: i.currency,
        status: i.status,
        meta: i.meta,
      })),
    )
    .onConflictDoUpdate({
      target: [vendorInvoices.organizationId, vendorInvoices.source, vendorInvoices.externalRef],
      set: {
        periodStart: sql`excluded.period_start`,
        periodEnd: sql`excluded.period_end`,
        invoiceDate: sql`excluded.invoice_date`,
        amount: sql`excluded.amount`,
        currency: sql`excluded.currency`,
        status: sql`excluded.status`,
        meta: sql`${vendorInvoices.meta} || excluded.meta`,
        updatedAt: sql`now()`,
      },
      // 防呆：別的帳號的同鍵發票不去動它
      setWhere: sql`${vendorInvoices.billingAccountId} = excluded.billing_account_id`,
    })
    .returning({ created: sql<boolean>`(xmax = 0)` });
  return { synced: unique.length, created: rows.filter((r) => r.created).length };
}

const COST_CHUNK = 500;

async function upsertCostLines(
  db: Db,
  orgId: string,
  billingAccountId: number,
  source: "azure_cost" | "gcp_bigquery",
  lines: CostLineInput[],
): Promise<number> {
  const rows = aggregateCostLines(lines);
  for (let i = 0; i < rows.length; i += COST_CHUNK) {
    await db
      .insert(vendorCostLines)
      .values(
        rows.slice(i, i + COST_CHUNK).map((r) => ({
          organizationId: orgId,
          billingAccountId,
          month: r.month,
          resourceExternalId: r.resourceExternalId,
          resourceName: r.resourceName,
          service: r.service,
          amount: r.amount.toFixed(4),
          currency: r.currency,
          source,
        })),
      )
      .onConflictDoUpdate({
        target: [
          vendorCostLines.billingAccountId,
          vendorCostLines.month,
          vendorCostLines.resourceExternalId,
          vendorCostLines.service,
          vendorCostLines.source,
        ],
        set: {
          amount: sql`excluded.amount`,
          currency: sql`excluded.currency`,
          resourceName: sql`excluded.resource_name`,
          updatedAt: sql`now()`,
        },
      });
  }
  return rows.length;
}

// ---------------------------------------------------------------------------
// Azure
// ---------------------------------------------------------------------------

async function upsertAzureCard(db: Db, orgId: string, pm: ParsedPaymentMethod): Promise<number> {
  const [row] = await db
    .insert(paymentMethods)
    .values({
      organizationId: orgId,
      kind: pm.kind,
      label: pm.label,
      brand: pm.brand,
      last4: pm.last4,
      expiryMonth: pm.expiryMonth,
      expiryYear: pm.expiryYear,
      holderName: pm.holderName,
      source: "azure",
      externalRef: pm.externalRef,
    })
    .onConflictDoUpdate({
      target: [paymentMethods.organizationId, paymentMethods.source, paymentMethods.externalRef],
      targetWhere: sql`external_ref IS NOT NULL`,
      // 名稱可能被人改過，不覆寫；卡的事實（卡別、末四碼、到期、持卡人）以 Azure 為準
      set: {
        kind: pm.kind,
        brand: pm.brand,
        last4: pm.last4,
        expiryMonth: pm.expiryMonth,
        expiryYear: pm.expiryYear,
        holderName: pm.holderName,
        deletedAt: null,
        updatedAt: sql`now()`,
      },
    })
    .returning({ id: paymentMethods.id });
  return row.id;
}

/** 收編人工建立的同一張卡：改成同步來源並填上 Azure id；名稱、扣款帳戶、備註保留。 */
async function adoptManualCard(db: Db, orgId: string, id: number, pm: ParsedPaymentMethod): Promise<number> {
  await db
    .update(paymentMethods)
    .set({
      source: "azure",
      externalRef: pm.externalRef,
      brand: pm.brand,
      holderName: pm.holderName,
      updatedAt: sql`now()`,
    })
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.organizationId, orgId), isNull(paymentMethods.externalRef)));
  return id;
}

async function loadOrgPaymentMethods(db: Db, orgId: string): Promise<ExistingPaymentMethod[]> {
  return db
    .select({
      id: paymentMethods.id,
      kind: paymentMethods.kind,
      source: paymentMethods.source,
      externalRef: paymentMethods.externalRef,
      brand: paymentMethods.brand,
      last4: paymentMethods.last4,
      expiryMonth: paymentMethods.expiryMonth,
      expiryYear: paymentMethods.expiryYear,
    })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.organizationId, orgId), isNull(paymentMethods.deletedAt)));
}

/** 帳號的付款方式只在「沒設」或「原本就不是手動指定」時改。 */
async function linkAccountPaymentMethod(db: Db, orgId: string, billingAccountId: number, pmId: number): Promise<void> {
  await db
    .update(vendorBillingAccounts)
    .set({ paymentMethodId: pmId, updatedAt: sql`${vendorBillingAccounts.updatedAt}` })
    .where(
      and(
        eq(vendorBillingAccounts.id, billingAccountId),
        eq(vendorBillingAccounts.organizationId, orgId),
        sql`(${vendorBillingAccounts.paymentMethodId} IS NULL OR NOT EXISTS (
          SELECT 1 FROM payment_methods pm
          WHERE pm.id = ${vendorBillingAccounts.paymentMethodId} AND pm.source = 'manual' AND pm.deleted_at IS NULL
        ))`,
      ),
    );
}

/** 「多張卡資料相同」的提醒存在帳號 meta（有衝突就寫、解了就清掉）。 */
async function setCardConflict(db: Db, orgId: string, billingAccountId: number, label: string | null): Promise<void> {
  await db
    .update(vendorBillingAccounts)
    .set({
      meta: sql`${vendorBillingAccounts.meta} || ${JSON.stringify({ paymentMethodConflict: label })}::jsonb`,
    })
    .where(and(eq(vendorBillingAccounts.id, billingAccountId), eq(vendorBillingAccounts.organizationId, orgId)));
}

/**
 * 付款卡同步（見 card-dedupe.ts）：同 Azure id → 更新；否則收編唯一一張相同的手動卡；
 * 沒有就新建；多張相同 → 不新建、不綁，記下衝突給頁面提醒。
 * 帳號優先綁 status = active 的那張。
 */
async function syncAzurePaymentMethods(
  db: Db,
  orgId: string,
  billingAccountId: number,
  links: ParsedPaymentMethod[],
): Promise<number> {
  if (links.length === 0) return 0;
  const existing = await loadOrgPaymentMethods(db, orgId);
  const resolved: { id: number; active: boolean }[] = [];
  let conflict: string | null = null;
  for (const pm of links) {
    const plan = planCardSync(pm, existing);
    if (plan.action === "conflict") {
      conflict = pm.label;
      continue;
    }
    const id = plan.action === "adopt" ? await adoptManualCard(db, orgId, plan.id, pm) : await upsertAzureCard(db, orgId, pm);
    // 同一次同步裡後面的卡要看到最新狀態（收編過的卡不能再被收編一次）
    const known = existing.find((e) => e.id === id);
    if (known) Object.assign(known, { source: "azure", externalRef: pm.externalRef });
    else existing.push({ id, kind: pm.kind, source: "azure", externalRef: pm.externalRef, brand: pm.brand, last4: pm.last4, expiryMonth: pm.expiryMonth, expiryYear: pm.expiryYear });
    resolved.push({ id, active: (pm.status ?? "").toLowerCase() === "active" });
  }
  await setCardConflict(db, orgId, billingAccountId, conflict);
  const pick = resolved.find((r) => r.active) ?? resolved[0];
  if (pick && conflict === null) await linkAccountPaymentMethod(db, orgId, billingAccountId, pick.id);
  return links.length;
}

function azureInvoiceInput(i: ParsedAzureInvoice): InvoiceInput {
  return {
    externalRef: i.externalRef,
    invoiceDate: i.invoiceDate,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    amount: i.amount,
    currency: i.currency,
    status: i.status,
    meta: { amountDue: i.amountDue, invoiceType: i.invoiceType },
  };
}

export async function syncAzureBilling(orgId: string, now: Date = new Date()): Promise<CloudSyncResult> {
  const db = getDb();
  const today = taipeiToday(now);
  const r = emptyResult("azure");

  await withAzureClient(orgId, async (client, row) => {
    const scope = parseAzureScope(row.config);
    const ba = azureBillingAccountId(row.config);
    if (!ba) throw new Error("Azure 整合沒有 billing account ID，請到 設定 › 整合 重新連接並填寫");
    const profiles = await discoverAzureProfiles(client, ba);
    await updateConfig(orgId, "azure", { discovered: profiles, discoveredAt: new Date().toISOString() });
    if (scope.billingProfileIds.length === 0) {
      r.scopeEmpty = true;
      return;
    }
    const selected = filterAllowlisted(profiles, scope.billingProfileIds);
    const found = new Set(selected.map((p) => p.id));
    r.accounts.missing += await markAccountsMissing(
      db,
      orgId,
      "azure",
      scope.billingProfileIds.filter((id) => !found.has(id)),
    );

    for (const p of selected) {
      const acct = await upsertSyncedAccount(db, orgId, "azure", p.id, p.displayName, "active", {
        billingAccountId: p.billingAccountId,
        billingAccountName: p.billingAccountName,
      });
      r.accounts.synced++;
      if (acct.created) r.accounts.created++;

      const subs = subscriptionsForProfile(
        (await soft(r.warnings, `${p.displayName} subscriptions`, () => client.listBillingSubscriptions(ba, p.id))) ?? [],
        p.id,
      );
      const res = await upsertResources(
        db,
        orgId,
        acct.id,
        subs.map((x): ResourceInput => ({
          kind: "azure_subscription",
          externalId: x.subscriptionId.toLowerCase(),
          name: x.displayName,
          labels: x.status ? { status: x.status } : ({} as Record<string, string>),
          status: subscriptionResourceStatus(x.status),
        })),
      );
      r.resources.synced += res.synced;
      r.resources.created += res.created;
      r.resources.missing += res.missing;

      const links = await soft(r.warnings, `${p.displayName} 付款卡`, () => client.listPaymentMethodLinks(ba, p.id));
      if (links) r.paymentMethods += await syncAzurePaymentMethods(db, orgId, acct.id, links);

      const from = syncWindowStart(acct.lastInvoiceDate, today);
      const invoices = await soft(r.warnings, `${p.displayName} 發票`, () => client.listInvoices(ba, p.id, from, today));
      if (invoices) {
        const up = await upsertInvoices(db, orgId, acct.id, "azure_invoice", invoices.map(azureInvoiceInput));
        r.invoices.synced += up.synced;
        r.invoices.created += up.created;
      }

      const lines: CostLineInput[] = [];
      for (const chunk of monthChunks(from, today)) {
        const rows = await soft(r.warnings, `${p.displayName} 費用 ${chunk.from}～${chunk.to}`, () =>
          client.queryCosts(ba, p.id, chunk.from, chunk.to),
        );
        for (const c of rows ?? []) {
          const res2 = azureCostResource(c.subscriptionName, c.subscriptionId, subs);
          lines.push({ month: c.month, ...res2, service: c.service, amount: c.amount, currency: c.currency });
        }
      }
      r.costLines += await upsertCostLines(db, orgId, acct.id, "azure_cost", lines);
    }
  });

  if (!r.scopeEmpty) r.reconcile = await reconcileVendorInvoices(orgId, { today });
  return r;
}

// ---------------------------------------------------------------------------
// GCP
// ---------------------------------------------------------------------------

/** 一次同步最多補幾個專案的名稱 / labels（Workers 的 subrequest 有上限）。 */
const MAX_PROJECT_LOOKUPS = 60;

function gcpInvoiceInput(i: GcpMonthlyInvoice): InvoiceInput {
  return {
    externalRef: i.externalRef,
    invoiceDate: i.invoiceDate,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    amount: i.amount,
    currency: i.currency,
    status: null,
    meta: { derivedFrom: "bigquery_export" },
  };
}

type GcpRun = {
  db: Db;
  orgId: string;
  client: GcpClient;
  r: CloudSyncResult;
  today: string;
  currentMonth: string;
  /** 這次已經補過幾個專案名稱（上限 MAX_PROJECT_LOOKUPS）。 */
  lookups: number;
};

type GcpSyncedAccount = { id: string; accountRowId: number; from: string };

/** 一個專案 → 資源列：名稱 / labels 盡量補（有上限、403 忽略），生命週期不是 ACTIVE 的視為不在了。 */
async function gcpProjectResource(run: GcpRun, p: GcpProjectBilling): Promise<ResourceInput> {
  let info: GcpProjectInfo | null = null;
  if (run.lookups < MAX_PROJECT_LOOKUPS) {
    run.lookups++;
    info = await soft(run.r.warnings, `專案 ${p.projectId}`, () => run.client.getProject(p.projectId));
  }
  const lifecycle = info?.lifecycleState ?? null;
  const labels: Record<string, string> = { ...info?.labels };
  if (!p.billingEnabled) labels.billingEnabled = "false";
  return {
    kind: "gcp_project",
    externalId: p.projectId,
    name: info?.name ?? null,
    labels,
    status: lifecycle && lifecycle !== "ACTIVE" ? "missing" : "active",
  };
}

async function syncGcpProjects(run: GcpRun, accountRowId: number, acc: GcpDiscoveredAccount): Promise<void> {
  const projects = await soft(run.r.warnings, `${acc.displayName} 專案`, () => run.client.listProjects(acc.id));
  if (!projects) return;
  const items: ResourceInput[] = [];
  for (const p of projects) items.push(await gcpProjectResource(run, p));
  const res = await upsertResources(run.db, run.orgId, accountRowId, items);
  run.r.resources.synced += res.synced;
  run.r.resources.created += res.created;
  run.r.resources.missing += res.missing;
}

/** 一個勾選的 billing account；平台上找不到回 null（呼叫端標 missing）。 */
async function syncGcpAccount(
  run: GcpRun,
  discovered: GcpDiscoveredAccount[],
  id: string,
): Promise<GcpSyncedAccount | null> {
  const acc = discovered.find((d) => d.id === id) ?? (await run.client.getBillingAccount(id));
  if (!acc) return null;
  const meta: Record<string, unknown> = {
    masterBillingAccount: acc.masterBillingAccount,
    currency: acc.currencyCode,
    reseller: Boolean(acc.masterBillingAccount),
  };
  const acct = await upsertSyncedAccount(run.db, run.orgId, "gcp", acc.id, acc.displayName, acc.open ? "active" : "closed", meta);
  run.r.accounts.synced++;
  if (acct.created) run.r.accounts.created++;
  await syncGcpProjects(run, acct.id, acc);
  return { id: acc.id, accountRowId: acct.id, from: syncWindowStart(acct.lastInvoiceDate, run.today) };
}

/** 一個帳號的 export 表 → 費用明細 + 已結束月份的月帳。 */
async function syncGcpAccountCosts(run: GcpRun, bq: BigQueryExport, table: string, a: GcpSyncedAccount): Promise<void> {
  const rows = await soft(run.r.warnings, `${a.id} 費用`, () =>
    run.client.queryCosts(bq.projectId, bq.dataset, table, a.id, yyyymm(firstOfMonth(a.from))),
  );
  if (!rows) return;
  run.r.costLines += await upsertCostLines(
    run.db,
    run.orgId,
    a.accountRowId,
    "gcp_bigquery",
    rows.map((c) => ({
      month: c.month,
      resourceExternalId: c.projectId,
      resourceName: c.projectName,
      service: c.service,
      amount: c.amount,
      currency: c.currency,
    })),
  );
  const up = await upsertInvoices(
    run.db,
    run.orgId,
    a.accountRowId,
    "gcp_bigquery",
    monthlyInvoicesFromCosts(a.id, rows, run.currentMonth).map(gcpInvoiceInput),
  );
  run.r.invoices.synced += up.synced;
  run.r.invoices.created += up.created;
}

/** 費用（選填）：每個勾選的帳號找自己的 export 表。 */
async function syncGcpCosts(run: GcpRun, bq: BigQueryExport, synced: GcpSyncedAccount[]): Promise<void> {
  const tables = await soft(run.r.warnings, `BigQuery ${bq.projectId}.${bq.dataset}`, () =>
    run.client.listTables(bq.projectId, bq.dataset),
  );
  if (!tables) return;
  const tableOf = matchExportTables(
    tables,
    synced.map((x) => x.id),
  );
  for (const a of synced) {
    const table = tableOf.get(a.id);
    if (table) await syncGcpAccountCosts(run, bq, table, a);
    else run.r.warnings.push(`${a.id}：${bq.dataset} 裡沒有它的 export 表`);
  }
}

export async function syncGcpBilling(orgId: string, now: Date = new Date()): Promise<CloudSyncResult> {
  const today = taipeiToday(now);
  const r = emptyResult("gcp");

  await withGcpClient(orgId, async (client, row) => {
    const scope = parseGcpScope(row.config);
    const discovered = await client.listBillingAccounts();
    await updateConfig(orgId, "gcp", { discovered, discoveredAt: new Date().toISOString() });
    if (scope.billingAccountIds.length === 0) {
      r.scopeEmpty = true;
      return;
    }
    const run: GcpRun = { db: getDb(), orgId, client, r, today, currentMonth: firstOfMonth(today), lookups: 0 };
    const missingIds: string[] = [];
    const synced: GcpSyncedAccount[] = [];
    for (const id of scope.billingAccountIds) {
      const a = await syncGcpAccount(run, discovered, id);
      if (a) synced.push(a);
      else missingIds.push(id);
    }
    r.accounts.missing += await markAccountsMissing(run.db, orgId, "gcp", missingIds);
    if (scope.bigQueryExport && synced.length > 0) await syncGcpCosts(run, scope.bigQueryExport, synced);
  });

  if (!r.scopeEmpty) r.reconcile = await reconcileVendorInvoices(orgId, { today });
  return r;
}

export function syncCloudBilling(orgId: string, provider: Provider, now?: Date): Promise<CloudSyncResult> {
  return provider === "azure" ? syncAzureBilling(orgId, now) : syncGcpBilling(orgId, now);
}
