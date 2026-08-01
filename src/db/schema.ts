import { pgTable, check, bigint, text, boolean, char, numeric, timestamp, date, unique, integer, foreignKey, index, uniqueIndex } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const categories = pgTable("categories", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "categories_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	name: text().notNull(),
	kind: text().notNull(),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	check("chk_category_kind", sql`kind = ANY (ARRAY['income'::text, 'cogs'::text, 'expense'::text, 'non_operating'::text, 'transfer'::text, 'equity'::text])`),
]);

export const bankAccounts = pgTable("bank_accounts", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "bank_accounts_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	name: text().notNull(),
	kind: text().notNull(),
	currency: char({ length: 3 }).notNull(),
	openingBalance: numeric("opening_balance", { precision: 18, scale:  2 }).default('0').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const invoices = pgTable("invoices", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "invoices_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	direction: text().notNull(),
	invoiceNumber: text("invoice_number"),
	invoiceDate: date("invoice_date"),
	counterpartyName: text("counterparty_name"),
	counterpartyTaxId: text("counterparty_tax_id"),
	amountNet: numeric("amount_net", { precision: 18, scale:  2 }),
	tax: numeric({ precision: 18, scale:  2 }),
	amountGross: numeric("amount_gross", { precision: 18, scale:  2 }),
	currency: char({ length: 3 }).default('TWD').notNull(),
	status: text().default('valid').notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// 對象／來源綁定（選填，migrations/0017）。counterparty_name 純文字保留不動，
	// 歷史資料與手 key 仍可用；有綁 party_id 時以 parties.name 為準。
	// FK 在 DB 端建立，這裡只放欄位避免與 parties / contracts 的宣告順序衝突。
	partyId: bigint("party_id", { mode: "number" }),
	contractId: bigint("contract_id", { mode: "number" }),
	billingItemId: bigint("billing_item_id", { mode: "number" }),
}, (table) => [
	index("idx_invoice_party").using("btree", table.partyId.asc().nullsLast().op("int8_ops")),
	index("idx_invoice_billing_item").using("btree", table.billingItemId.asc().nullsLast().op("int8_ops")),
	check("chk_invoice_direction", sql`direction = ANY (ARRAY['issued'::text, 'received'::text])`),
	check("chk_invoice_status", sql`status = ANY (ARRAY['valid'::text, 'void'::text, 'allowance'::text])`),
]);

export const employees = pgTable("employees", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "employees_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	name: text().notNull(),
	nationalId: text("national_id"),
	employmentType: text("employment_type").default('full_time').notNull(),
	hasLaborInsurance: boolean("has_labor_insurance").default(true).notNull(),
	hasHealthInsurance: boolean("has_health_insurance").default(true).notNull(),
	hasPension: boolean("has_pension").default(true).notNull(),
	baseSalary: numeric("base_salary", { precision: 18, scale:  2 }),
	// 勞健保投保薪資（記錄保多少，先不試算保費）；是否有勞退看 hasPension
	laborInsuredSalary: numeric("labor_insured_salary", { precision: 18, scale: 2 }),
	healthInsuredSalary: numeric("health_insured_salary", { precision: 18, scale: 2 }),
	salaryAccount: text("salary_account"),
	startDate: date("start_date"),
	endDate: date("end_date"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// 基本聯絡資訊（migrations/0015）
	workEmail: text("work_email"),
	personalEmail: text("personal_email"),
	phone: text(),
	note: text(),
	// 選填綁定登入使用者（"user".id）。NULL = 純名冊紀錄，不強制 1:1。
	// FK 與 (org, user) 唯一索引在 DB 端（migrations/0015）建立，避免跨檔宣告順序衝突。
	userId: text("user_id"),
}, (table) => [
	check("chk_emp_type", sql`employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'freelancer'::text, 'contractor'::text])`),
]);

export const payrollRuns = pgTable("payroll_runs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payroll_runs_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	periodYear: integer("period_year").notNull(),
	periodMonth: integer("period_month").notNull(),
	payDate: date("pay_date"),
	status: text().default('draft').notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("uq_run_period").on(table.organizationId, table.periodYear, table.periodMonth),
	check("chk_run_status", sql`status = ANY (ARRAY['draft'::text, 'finalized'::text, 'paid'::text])`),
]);

export const payslips = pgTable("payslips", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payslips_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	payrollRunId: bigint("payroll_run_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	employeeId: bigint("employee_id", { mode: "number" }).notNull(),
	taxableTotal: numeric("taxable_total", { precision: 18, scale:  2 }).default('0').notNull(),
	nontaxableTotal: numeric("nontaxable_total", { precision: 18, scale:  2 }).default('0').notNull(),
	deductionTotal: numeric("deduction_total", { precision: 18, scale:  2 }).default('0').notNull(),
	netPay: numeric("net_pay", { precision: 18, scale:  2 }).default('0').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	paidTransactionId: bigint("paid_transaction_id", { mode: "number" }),
	note: text(),
}, (table) => [
	foreignKey({
			columns: [table.payrollRunId],
			foreignColumns: [payrollRuns.id],
			name: "payslips_payroll_run_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.employeeId],
			foreignColumns: [employees.id],
			name: "payslips_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.paidTransactionId],
			foreignColumns: [transactions.id],
			name: "payslips_paid_transaction_id_fkey"
		}),
	unique("uq_payslip").on(table.payrollRunId, table.employeeId),
]);

export const payslipItems = pgTable("payslip_items", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payslip_items_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	payslipId: bigint("payslip_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	itemTypeId: bigint("item_type_id", { mode: "number" }),
	name: text().notNull(),
	direction: text().notNull(),
	isTaxable: boolean("is_taxable").notNull(),
	amount: numeric({ precision: 18, scale:  2 }).notNull(),
	hours: numeric({ precision: 8, scale:  2 }),
}, (table) => [
	foreignKey({
			columns: [table.payslipId],
			foreignColumns: [payslips.id],
			name: "payslip_items_payslip_id_fkey"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.itemTypeId],
			foreignColumns: [payrollItemTypes.id],
			name: "payslip_items_item_type_id_fkey"
		}),
	check("chk_psitem_direction", sql`direction = ANY (ARRAY['earning'::text, 'deduction'::text])`),
]);

export const payrollItemTypes = pgTable("payroll_item_types", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payroll_item_types_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	name: text().notNull(),
	direction: text().notNull(),
	isTaxable: boolean("is_taxable").notNull(),
	isStatutory: boolean("is_statutory").default(false).notNull(),
	note: text(),
}, (table) => [
	check("chk_pit_direction", sql`direction = ANY (ARRAY['earning'::text, 'deduction'::text])`),
]);

export const parties = pgTable("parties", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "suppliers_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	name: text().notNull(),
	label: text().default('vendor').notNull(),
	taxId: text("tax_id"),
	defaultCurrency: char("default_currency", { length: 3 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	defaultAccountId: bigint("default_account_id", { mode: "number" }),
	typicalAmount: numeric("typical_amount", { precision: 18, scale:  2 }),
	contact: text(),
	note: text(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.defaultAccountId],
			foreignColumns: [bankAccounts.id],
			name: "suppliers_default_account_id_fkey"
		}),
	check("chk_supplier_type", sql`label = ANY (ARRAY['vendor'::text, 'customer'::text, 'gov'::text, 'other'::text])`),
	unique("parties_name_key").on(table.organizationId, table.name),
]);

export const transactions = pgTable("transactions", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "transactions_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	txnDate: date("txn_date").notNull(),
	description: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	categoryId: bigint("category_id", { mode: "number" }),
	amount: numeric({ precision: 18, scale:  2 }).notNull(),
	currency: char({ length: 3 }).notNull(),
	amountTwd: numeric("amount_twd", { precision: 18, scale:  2 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fromAccountId: bigint("from_account_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	toAccountId: bigint("to_account_id", { mode: "number" }),
	book: text().default('both').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	invoiceId: bigint("invoice_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	billedToCompanyTaxId: boolean("billed_to_company_tax_id").default(false).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	partyId: bigint("party_id", { mode: "number" }),
	settleEmployeeId: bigint("settle_employee_id", { mode: "number" }),
	relatedToId: bigint("related_to_id", { mode: "number" }),
	type: text().default('expense').notNull(),
	// 專案標籤：vendor ≠ project，交易同時帶 party_id（廠商/客戶）與 project_id（專案）。
	// FK 在 DB 端（migrations/0003）建立，這裡只放欄位避免與 projects 的宣告順序衝突。
	projectId: bigint("project_id", { mode: "number" }),
	// 合約綁定（選填）：收款進度用 income 交易追蹤已收/未收；expense/advance 僅算成本。
	// FK 在 DB 端（migrations/0009）建立，這裡只放欄位避免宣告順序衝突。
	contractId: bigint("contract_id", { mode: "number" }),
	// 訂閱綁定（選填）：把週期性收款掛到某張 subscription 的「某一期」，對帳哪期已收/未收。
	// subscriptionPeriod = 該期起始日。FK 在 DB 端（migrations/0013）建立，這裡只放欄位。
	subscriptionId: bigint("subscription_id", { mode: "number" }),
	subscriptionPeriod: date("subscription_period"),
	// 請款項目綁定（選填）：把 income 交易掛到某一筆 billing_items，讓該期「已收多少」
	// 自動算出來。FK 在 DB 端（migrations/0017）建立，這裡只放欄位避免宣告順序衝突。
	billingItemId: bigint("billing_item_id", { mode: "number" }),
}, (table) => [
	index("idx_txn_book").using("btree", table.book.asc().nullsLast().op("text_ops")),
	index("idx_txn_category").using("btree", table.categoryId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_date").using("btree", table.txnDate.asc().nullsLast().op("date_ops")),
	index("idx_txn_from").using("btree", table.fromAccountId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_supplier").using("btree", table.partyId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_to").using("btree", table.toAccountId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_settle").using("btree", table.settleEmployeeId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_related").using("btree", table.relatedToId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_subscription").using("btree", table.subscriptionId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_billing_item").using("btree", table.billingItemId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.categoryId],
			foreignColumns: [categories.id],
			name: "transactions_category_id_fkey"
		}),
	foreignKey({
			columns: [table.fromAccountId],
			foreignColumns: [bankAccounts.id],
			name: "transactions_from_account_id_fkey"
		}),
	foreignKey({
			columns: [table.toAccountId],
			foreignColumns: [bankAccounts.id],
			name: "transactions_to_account_id_fkey"
		}),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "transactions_invoice_id_fkey"
		}),
	foreignKey({
			columns: [table.partyId],
			foreignColumns: [parties.id],
			name: "transactions_supplier_id_fkey"
		}),
	foreignKey({
			columns: [table.settleEmployeeId],
			foreignColumns: [employees.id],
			name: "transactions_settle_employee_id_fkey"
		}),
	foreignKey({
			columns: [table.relatedToId],
			foreignColumns: [table.id],
			name: "transactions_related_to_id_fkey"
		}),
	check("chk_txn_book", sql`book = ANY (ARRAY['both'::text, 'internal'::text, 'external'::text])`),
	check("chk_txn_type", sql`type = ANY (ARRAY['expense'::text, 'income'::text, 'advance'::text, 'reimbursement'::text, 'transfer'::text])`),
]);

export const accountReconciliations = pgTable("account_reconciliations", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "account_reconciliations_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	accountId: bigint("account_id", { mode: "number" }).notNull(),
	asOfDate: date("as_of_date").notNull(),
	statementBalance: numeric("statement_balance", { precision: 18, scale:  2 }).notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.accountId],
			foreignColumns: [bankAccounts.id],
			name: "account_reconciliations_account_id_fkey"
		}),
	unique("uq_recon_account_date").on(table.accountId, table.asOfDate),
]);

export const documents = pgTable("documents", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "documents_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	docType: text("doc_type").notNull(),
	r2Key: text("r2_key").notNull(),
	fileName: text("file_name"),
	contentType: text("content_type"),
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	transactionId: bigint("transaction_id", { mode: "number" }),
	invoiceId: bigint("invoice_id", { mode: "number" }),
	note: text(),
	// 發票細分：電子發票(electronic)會計師會自動看到;其他發票(paper，三聯式等)要主動通知
	invoiceKind: text("invoice_kind"),
	// 其他發票主動通知會計師的時間（null = 尚未通知）
	accountantNotifiedAt: timestamp("accountant_notified_at", { withTimezone: true, mode: 'string' }),
	uploadedAt: timestamp("uploaded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_doc_txn").using("btree", table.transactionId.asc().nullsLast().op("int8_ops")),
	index("idx_doc_invoice").using("btree", table.invoiceId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.transactionId],
			foreignColumns: [transactions.id],
			name: "documents_transaction_id_fkey"
		}).onDelete("set null"),
	foreignKey({
			columns: [table.invoiceId],
			foreignColumns: [invoices.id],
			name: "documents_invoice_id_fkey"
		}).onDelete("set null"),
	unique("documents_r2_key_key").on(table.r2Key),
	check("chk_doc_type", sql`doc_type = ANY (ARRAY['receipt'::text, 'invoice'::text, 'vat_return_401'::text, 'withholding'::text, 'payroll'::text, 'contract'::text, 'other'::text])`),
	check("chk_doc_invoice_kind", sql`invoice_kind IS NULL OR invoice_kind = ANY (ARRAY['electronic'::text, 'paper'::text])`),
]);

// ---- 客戶營運（專案 / 訂閱 / 合約）----

export const projects = pgTable("projects", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "projects_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	name: text().notNull(),
	clientPartyId: bigint("client_party_id", { mode: "number" }),
	status: text().default('active').notNull(),
	description: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.clientPartyId],
			foreignColumns: [parties.id],
			name: "projects_client_party_id_fkey"
		}),
	check("chk_project_status", sql`status = ANY (ARRAY['active'::text, 'archived'::text])`),
]);

export const subscriptions = pgTable("subscriptions", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "subscriptions_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	customerPartyId: bigint("customer_party_id", { mode: "number" }).notNull(),
	projectId: bigint("project_id", { mode: "number" }),
	name: text().notNull(),
	amount: numeric({ precision: 18, scale: 2 }).notNull(),
	currency: char({ length: 3 }).default('TWD').notNull(),
	intervalMonths: integer("interval_months").default(1).notNull(),
	startDate: date("start_date").notNull(),
	endDate: date("end_date"),
	status: text().default('active').notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.customerPartyId],
			foreignColumns: [parties.id],
			name: "subscriptions_customer_party_id_fkey"
		}),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "subscriptions_project_id_fkey"
		}),
	check("chk_subscription_status", sql`status = ANY (ARRAY['active'::text, 'paused'::text, 'ended'::text])`),
]);

// 每期「應收金額」覆寫：同一張訂閱不同期別可有不同應收（如過渡期只收 2 個月）。
// 沒有覆寫的期別退回 subscriptions.amount。FK 在 DB 端（migrations/0014）建立。
export const subscriptionPeriods = pgTable("subscription_periods", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "subscription_periods_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	subscriptionId: bigint("subscription_id", { mode: "number" }).notNull(),
	periodStart: date("period_start").notNull(),
	// NULL = 沒有覆寫，退回 subscriptions.amount。0017 起本表也用來記「該期實際請款/
	// 開發票日」，那種列不見得有金額覆寫，故放寬為可 NULL。
	expectedAmount: numeric("expected_amount", { precision: 18, scale: 2 }),
	// 該期的實際動作（migrations/0017）：訂閱期別本身是即時算出來的，不物化成資料列，
	// 只有「人做了什麼」需要落地。
	dueDate: date("due_date"),
	billedOn: date("billed_on"),
	invoicedOn: date("invoiced_on"),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_subscription_period_sub").using("btree", table.subscriptionId.asc().nullsLast().op("int8_ops")),
	uniqueIndex("uq_subscription_period").on(table.subscriptionId, table.periodStart).where(sql`deleted_at IS NULL`),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "subscription_periods_subscription_id_fkey"
		}),
]);

export const contracts = pgTable("contracts", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "contracts_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
	organizationId: text("organization_id"),
	customerPartyId: bigint("customer_party_id", { mode: "number" }).notNull(),
	projectId: bigint("project_id", { mode: "number" }),
	title: text().notNull(),
	amount: numeric({ precision: 18, scale: 2 }),
	currency: char({ length: 3 }).default('TWD').notNull(),
	startDate: date("start_date"),
	endDate: date("end_date"),
	// 簽約日：合約成立的日期，與 start_date（服務期間起日）刻意分開 —— 常常先簽約、
	// 過一陣子才開始執行。migrations/0017。
	signedDate: date("signed_date"),
	// 付款條件：請款後幾天應收到款（月結 30 天 → 30）。NULL = 未約定，逾期改以
	// 該期的應請款日判斷。
	paymentTermsDays: integer("payment_terms_days"),
	status: text().default('active').notNull(),
	note: text(),
	fileUrl: text("file_url"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.customerPartyId],
			foreignColumns: [parties.id],
			name: "contracts_customer_party_id_fkey"
		}),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "contracts_project_id_fkey"
		}),
	check("chk_contract_status", sql`status = ANY (ARRAY['draft'::text, 'active'::text, 'completed'::text, 'cancelled'::text])`),
]);

// ---- 請款項目（migrations/0017）：一次性合約分期 / 專案里程碑 / 臨時請款。
// 0010_drop_receivables 指示日後的日期化應收要做成 contracts 的子表而非平行帳本；
// 本表遵守該精神，但因為也要涵蓋專案里程碑與無合約的臨時請款，故 contract_id 與
// project_id 皆可為 NULL，真正的不變式是「一定有客戶」（customer_party_id NOT NULL），
// 因為看板是以客戶為中心。
//
// 訂閱的期別不進本表 —— 它由 start_date + interval_months 即時算出（見 queries.ts
// 的 computeSubscriptionSchedule），物化會造成兩份狀態漂移。看板在 query 層合併。
export const billingItems = pgTable("billing_items", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "billing_items_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	customerPartyId: bigint("customer_party_id", { mode: "number" }).notNull(),
	contractId: bigint("contract_id", { mode: "number" }),
	projectId: bigint("project_id", { mode: "number" }),
	// 這一期的名稱，例如「簽約金」「期中款」「尾款」
	title: text().notNull(),
	amount: numeric({ precision: 18, scale: 2 }).notNull(),
	currency: char({ length: 3 }).default('TWD').notNull(),
	dueDate: date("due_date"),           // 應請款日
	billedOn: date("billed_on"),         // 實際請款日
	paidOn: date("paid_on"),             // 收款日（人工註記；實收金額以綁定的交易為準）
	invoicedOn: date("invoiced_on"),     // 開發票日
	needsInvoice: boolean("needs_invoice").default(true).notNull(),
	status: text().default('scheduled').notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	deletedAt: timestamp("deleted_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_billing_item_org_due").using("btree", table.organizationId.asc().nullsLast().op("text_ops"), table.dueDate.asc().nullsLast().op("date_ops")).where(sql`deleted_at IS NULL`),
	index("idx_billing_item_contract").using("btree", table.contractId.asc().nullsLast().op("int8_ops")),
	index("idx_billing_item_project").using("btree", table.projectId.asc().nullsLast().op("int8_ops")),
	index("idx_billing_item_customer").using("btree", table.customerPartyId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.customerPartyId],
			foreignColumns: [parties.id],
			name: "billing_items_customer_party_id_fkey"
		}),
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [contracts.id],
			name: "billing_items_contract_id_fkey"
		}),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "billing_items_project_id_fkey"
		}),
	check("chk_billing_item_status", sql`status = ANY (ARRAY['scheduled'::text, 'billed'::text, 'paid'::text, 'cancelled'::text])`),
]);

// ---- 操作紀錄（audit log）：org 內誰對哪個 entity 做了 create/update/delete，
// web 與 OAuth MCP 都記錄，用來追查亂紀錄 / 亂刪除。----
export const activityLog = pgTable("activity_log", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "activity_log_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	actorUserId: text("actor_user_id"),
	actorEmail: text("actor_email"),
	actorName: text("actor_name"),
	channel: text().default('web').notNull(),
	action: text().notNull(),
	entityType: text("entity_type").notNull(),
	entityId: bigint("entity_id", { mode: "number" }),
	summary: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("idx_activity_org_time").using("btree", table.organizationId.asc().nullsLast(), table.createdAt.desc()),
	check("chk_activity_channel", sql`channel = ANY (ARRAY['web'::text, 'mcp'::text])`),
	check("chk_activity_action", sql`action = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text, 'read'::text])`),
]);

// ---- Google 日曆同步（migrations/0018）。
// 事件寫進 Google 之後提醒由 Google 自己發，所以本專案沒有、也不需要 cron。----

// 每個組織一本專屬子日曆。OAuth token 存在 better-auth 的 account 表
// （provider id = 'google-calendar'），這裡不重複存。
export const calendarSettings = pgTable("calendar_settings", {
	organizationId: text("organization_id").primaryKey(),
	googleCalendarId: text("google_calendar_id"),
	// 用誰的授權推事件；該成員取消授權後同步會失敗，需重新連結。
	ownerUserId: text("owner_user_id"),
	reminderDays: integer("reminder_days").default(3).notNull(),
	enabled: boolean().default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("chk_calendar_reminder_days", sql`reminder_days >= 0 AND reminder_days <= 60`),
]);

// ERP 的一列 ↔ Google 事件的對應，讓同步是冪等的（改日期 patch 同一顆事件，
// 不會每同步一次就多一顆）。content_hash 用來略過沒變動的列。
export const calendarEventLinks = pgTable("calendar_event_links", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "calendar_event_links_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id").notNull(),
	// 對應 BillingRow.key：'bi:<id>' 或 'sub:<id>:<periodStart>'
	itemKey: text("item_key").notNull(),
	kind: text().notNull(),
	googleEventId: text("google_event_id").notNull(),
	contentHash: text("content_hash").notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("uq_calendar_event").on(table.organizationId, table.itemKey, table.kind),
	index("idx_calendar_event_org").using("btree", table.organizationId.asc().nullsLast().op("text_ops")),
	check("chk_calendar_event_kind", sql`kind = ANY (ARRAY['due'::text, 'payment'::text, 'invoice'::text])`),
]);
