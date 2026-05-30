import { relations } from "drizzle-orm/relations";
import { categories, transactions, bankAccounts, invoices, payrollRuns, payslips, employees, payslipItems, payrollItemTypes } from "./schema";

export const transactionsRelations = relations(transactions, ({one, many}) => ({
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
	payslips: many(payslips),
}));

export const categoriesRelations = relations(categories, ({many}) => ({
	transactions: many(transactions),
}));

export const bankAccountsRelations = relations(bankAccounts, ({many}) => ({
	transactions_fromAccountId: many(transactions, {
		relationName: "transactions_fromAccountId_bankAccounts_id"
	}),
	transactions_toAccountId: many(transactions, {
		relationName: "transactions_toAccountId_bankAccounts_id"
	}),
}));

export const invoicesRelations = relations(invoices, ({many}) => ({
	transactions: many(transactions),
}));

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