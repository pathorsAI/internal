import { pgTable, check, bigint, text, boolean, char, numeric, timestamp, date, unique, integer, foreignKey, index } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const categories = pgTable("categories", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "categories_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	name: text().notNull(),
	kind: text().notNull(),
	pnlSection: text("pnl_section"),
	isActive: boolean("is_active").default(true).notNull(),
}, (table) => [
	check("chk_category_kind", sql`kind = ANY (ARRAY['income'::text, 'cogs'::text, 'expense'::text, 'non_operating'::text, 'transfer'::text, 'equity'::text])`),
]);

export const bankAccounts = pgTable("bank_accounts", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "bank_accounts_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	name: text().notNull(),
	kind: text().notNull(),
	currency: char({ length: 3 }).notNull(),
	openingBalance: numeric("opening_balance", { precision: 18, scale:  2 }).default('0').notNull(),
	defaultBook: text("default_book").default('both').notNull(),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("chk_bankacct_book", sql`default_book = ANY (ARRAY['both'::text, 'internal'::text, 'external'::text])`),
]);

export const invoices = pgTable("invoices", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "invoices_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
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
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "employees_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	name: text().notNull(),
	nationalId: text("national_id"),
	employmentType: text("employment_type").default('full_time').notNull(),
	hasLaborInsurance: boolean("has_labor_insurance").default(true).notNull(),
	hasHealthInsurance: boolean("has_health_insurance").default(true).notNull(),
	hasPension: boolean("has_pension").default(true).notNull(),
	baseSalary: numeric("base_salary", { precision: 18, scale:  2 }),
	startDate: date("start_date"),
	endDate: date("end_date"),
	isActive: boolean("is_active").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("chk_emp_type", sql`employment_type = ANY (ARRAY['full_time'::text, 'part_time'::text, 'freelancer'::text, 'contractor'::text])`),
]);

export const payrollRuns = pgTable("payroll_runs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payroll_runs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
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
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payslips_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
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
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payslip_items_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
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
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "payroll_item_types_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	name: text().notNull(),
	direction: text().notNull(),
	isTaxable: boolean("is_taxable").notNull(),
	isStatutory: boolean("is_statutory").default(false).notNull(),
	note: text(),
}, (table) => [
	check("chk_pit_direction", sql`direction = ANY (ARRAY['earning'::text, 'deduction'::text])`),
]);

export const suppliers = pgTable("suppliers", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "suppliers_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	name: text().notNull(),
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
]);

export const transactions = pgTable("transactions", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "transactions_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	txnDate: date("txn_date").notNull(),
	party: text(),
	description: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	categoryId: bigint("category_id", { mode: "number" }),
	counterpartyTaxId: text("counterparty_tax_id"),
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
	supplierId: bigint("supplier_id", { mode: "number" }),
}, (table) => [
	index("idx_txn_book").using("btree", table.book.asc().nullsLast().op("text_ops")),
	index("idx_txn_category").using("btree", table.categoryId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_date").using("btree", table.txnDate.asc().nullsLast().op("date_ops")),
	index("idx_txn_from").using("btree", table.fromAccountId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_supplier").using("btree", table.supplierId.asc().nullsLast().op("int8_ops")),
	index("idx_txn_to").using("btree", table.toAccountId.asc().nullsLast().op("int8_ops")),
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
			columns: [table.supplierId],
			foreignColumns: [suppliers.id],
			name: "transactions_supplier_id_fkey"
		}),
	check("chk_txn_book", sql`book = ANY (ARRAY['both'::text, 'internal'::text, 'external'::text])`),
	check("chk_txn_accounts", sql`(from_account_id IS NOT NULL) OR (to_account_id IS NOT NULL)`),
]);

export const accountReconciliations = pgTable("account_reconciliations", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "account_reconciliations_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
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
