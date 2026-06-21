import { pgTable, check, bigint, text, boolean, char, numeric, timestamp, date, unique, integer, foreignKey, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const categories = pgTable("categories", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "categories_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
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
}, (table) => [
	check("chk_invoice_direction", sql`direction = ANY (ARRAY['issued'::text, 'received'::text])`),
	check("chk_invoice_status", sql`status = ANY (ARRAY['valid'::text, 'void'::text, 'allowance'::text])`),
]);

export const employees = pgTable("employees", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "employees_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
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
}, (table) => [
	check("chk_emp_type", sql`employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'freelancer'::text, 'contractor'::text])`),
]);

export const payrollRuns = pgTable("payroll_runs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payroll_runs_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	periodYear: integer("period_year").notNull(),
	periodMonth: integer("period_month").notNull(),
	payDate: date("pay_date"),
	status: text().default('draft').notNull(),
	note: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("uq_run_period").on(table.periodYear, table.periodMonth),
	check("chk_run_status", sql`status = ANY (ARRAY['draft'::text, 'finalized'::text, 'paid'::text])`),
]);

export const payslips = pgTable("payslips", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payslips_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
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
	organizationId: text("organization_id"),
	txnDate: date("txn_date").notNull(),
	description: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	categoryId: bigint("category_id", { mode: "number" }),
	amount: numeric({ precision: 18, scale:  2 }).notNull(),
	currency: char({ length: 3 }).notNull(),
	originalAmount: numeric("original_amount", { precision: 18, scale:  2 }),
	originalCurrency: char("original_currency", { length: 3 }),
	fxRate: numeric("fx_rate", { precision: 18, scale:  8 }),
	amountTwd: numeric("amount_twd", { precision: 18, scale:  2 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	fromAccountId: bigint("from_account_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	toAccountId: bigint("to_account_id", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	transferGroupId: bigint("transfer_group_id", { mode: "number" }),
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
}, (table) => [
	index("idx_txn_book").using("btree", table.book.asc().nullsLast().op("text_ops")),
	index("idx_txn_category").using("btree", table.categoryId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_date").using("btree", table.txnDate.asc().nullsLast().op("date_ops")),
	index("idx_txn_from").using("btree", table.fromAccountId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_supplier").using("btree", table.partyId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_to").using("btree", table.toAccountId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_settle").using("btree", table.settleEmployeeId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_related").using("btree", table.relatedToId.asc().nullsLast().op("int8_ops")),
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
	organizationId: text("organization_id"),
	docType: text("doc_type").notNull(),
	r2Key: text("r2_key").notNull(),
	fileName: text("file_name"),
	contentType: text("content_type"),
	sizeBytes: bigint("size_bytes", { mode: "number" }),
	transactionId: bigint("transaction_id", { mode: "number" }),
	invoiceId: bigint("invoice_id", { mode: "number" }),
	periodLabel: text("period_label"),
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

// ---- 客戶營運（專案 / 訂閱 / 合約 / 應收帳款）----

export const projects = pgTable("projects", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "projects_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
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

export const contracts = pgTable("contracts", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "contracts_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	customerPartyId: bigint("customer_party_id", { mode: "number" }).notNull(),
	projectId: bigint("project_id", { mode: "number" }),
	title: text().notNull(),
	amount: numeric({ precision: 18, scale: 2 }),
	currency: char({ length: 3 }).default('TWD').notNull(),
	startDate: date("start_date"),
	endDate: date("end_date"),
	status: text().default('active').notNull(),
	note: text(),
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

export const receivables = pgTable("receivables", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "receivables_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	customerPartyId: bigint("customer_party_id", { mode: "number" }).notNull(),
	contractId: bigint("contract_id", { mode: "number" }),
	subscriptionId: bigint("subscription_id", { mode: "number" }),
	projectId: bigint("project_id", { mode: "number" }),
	description: text(),
	amount: numeric({ precision: 18, scale: 2 }).notNull(),
	currency: char({ length: 3 }).default('TWD').notNull(),
	dueDate: date("due_date"),
	status: text().default('open').notNull(),
	paidTransactionId: bigint("paid_transaction_id", { mode: "number" }),
	paidAt: date("paid_at"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({
			columns: [table.customerPartyId],
			foreignColumns: [parties.id],
			name: "receivables_customer_party_id_fkey"
		}),
	foreignKey({
			columns: [table.contractId],
			foreignColumns: [contracts.id],
			name: "receivables_contract_id_fkey"
		}),
	foreignKey({
			columns: [table.subscriptionId],
			foreignColumns: [subscriptions.id],
			name: "receivables_subscription_id_fkey"
		}),
	foreignKey({
			columns: [table.projectId],
			foreignColumns: [projects.id],
			name: "receivables_project_id_fkey"
		}),
	foreignKey({
			columns: [table.paidTransactionId],
			foreignColumns: [transactions.id],
			name: "receivables_paid_transaction_id_fkey"
		}),
	check("chk_receivable_status", sql`status = ANY (ARRAY['open'::text, 'paid'::text, 'void'::text])`),
]);

export const links = pgTable("links", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "links_id_seq", startWith: 1, increment: 1, minValue: 1, cache: 1 }),
	organizationId: text("organization_id"),
	title: text().notNull(),
	url: text().notNull(),
	note: text(),
	partyId: bigint("party_id", { mode: "number" }),
	projectId: bigint("project_id", { mode: "number" }),
	contractId: bigint("contract_id", { mode: "number" }),
	subscriptionId: bigint("subscription_id", { mode: "number" }),
	receivableId: bigint("receivable_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	foreignKey({ columns: [table.partyId], foreignColumns: [parties.id], name: "links_party_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.projectId], foreignColumns: [projects.id], name: "links_project_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.contractId], foreignColumns: [contracts.id], name: "links_contract_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.subscriptionId], foreignColumns: [subscriptions.id], name: "links_subscription_id_fkey" }).onDelete("set null"),
	foreignKey({ columns: [table.receivableId], foreignColumns: [receivables.id], name: "links_receivable_id_fkey" }).onDelete("set null"),
]);
