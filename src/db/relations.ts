import { relations } from "drizzle-orm/relations";
import { payrollRuns, payslips, employees, transactions, payslipItems, payrollItemTypes, bankAccounts, suppliers, categories, invoices, accountReconciliations } from "./schema";

export const payslipsRelations = relations(payslips, ({one, many}) => ({
	payrollRun: one(payrollRuns, {
		fields: [payslips.payrollRunId],
		references: [payrollRuns.id]
	}),
	employee: one(employees, {
		fields: [payslips.employeeId],
		references: [employees.id]
	}),
	transaction: one(transactions, {
		fields: [payslips.paidTransactionId],
		references: [transactions.id]
	}),
	payslipItems: many(payslipItems),
}));

export const payrollRunsRelations = relations(payrollRuns, ({many}) => ({
	payslips: many(payslips),
}));

export const employeesRelations = relations(employees, ({many}) => ({
	payslips: many(payslips),
}));

export const transactionsRelations = relations(transactions, ({one, many}) => ({
	payslips: many(payslips),
	category: one(categories, {
		fields: [transactions.categoryId],
		references: [categories.id]
	}),
	bankAccount_fromAccountId: one(bankAccounts, {
		fields: [transactions.fromAccountId],
		references: [bankAccounts.id],
		relationName: "transactions_fromAccountId_bankAccounts_id"
	}),
	bankAccount_toAccountId: one(bankAccounts, {
		fields: [transactions.toAccountId],
		references: [bankAccounts.id],
		relationName: "transactions_toAccountId_bankAccounts_id"
	}),
	invoice: one(invoices, {
		fields: [transactions.invoiceId],
		references: [invoices.id]
	}),
	supplier: one(suppliers, {
		fields: [transactions.supplierId],
		references: [suppliers.id]
	}),
}));

export const payslipItemsRelations = relations(payslipItems, ({one}) => ({
	payslip: one(payslips, {
		fields: [payslipItems.payslipId],
		references: [payslips.id]
	}),
	payrollItemType: one(payrollItemTypes, {
		fields: [payslipItems.itemTypeId],
		references: [payrollItemTypes.id]
	}),
}));

export const payrollItemTypesRelations = relations(payrollItemTypes, ({many}) => ({
	payslipItems: many(payslipItems),
}));

export const suppliersRelations = relations(suppliers, ({one, many}) => ({
	bankAccount: one(bankAccounts, {
		fields: [suppliers.defaultAccountId],
		references: [bankAccounts.id]
	}),
	transactions: many(transactions),
}));

export const bankAccountsRelations = relations(bankAccounts, ({many}) => ({
	suppliers: many(suppliers),
	transactions_fromAccountId: many(transactions, {
		relationName: "transactions_fromAccountId_bankAccounts_id"
	}),
	transactions_toAccountId: many(transactions, {
		relationName: "transactions_toAccountId_bankAccounts_id"
	}),
	accountReconciliations: many(accountReconciliations),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	transactions: many(transactions),
}));

export const invoicesRelations = relations(invoices, ({many}) => ({
	transactions: many(transactions),
}));

export const accountReconciliationsRelations = relations(accountReconciliations, ({one}) => ({
	bankAccount: one(bankAccounts, {
		fields: [accountReconciliations.accountId],
		references: [bankAccounts.id]
	}),
}));