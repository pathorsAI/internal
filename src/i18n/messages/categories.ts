import type { Dictionary } from "./dictionary";

const categories = {
  title: { "zh-TW": "分類", en: "Categories" },
  description: { "zh-TW": "收入 / 成本 / 費用 科目，用於交易分類與損益表", en: "Income / cost of sales / expense accounts, used to categorize transactions and build the P&L" },
  tabs: {
    income: {
      label: { "zh-TW": "收入分類", en: "Income categories" },
      add: { "zh-TW": "新增收入", en: "Add income" },
    },
    cogs: {
      label: { "zh-TW": "成本分類", en: "Cost of sales categories" },
      add: { "zh-TW": "新增成本", en: "Add cost of sales" },
    },
    expense: {
      label: { "zh-TW": "費用分類", en: "Expense categories" },
      add: { "zh-TW": "新增費用", en: "Add expense" },
    },
  },
  count: { "zh-TW": "{count} 個分類", en: "{count} categories" },
  empty: { "zh-TW": "尚無分類", en: "No categories yet" },
  emptyHint: { "zh-TW": "點右上角新增", en: "Add one from the top right" },
  editAria: { "zh-TW": "編輯", en: "Edit" },
  add: { "zh-TW": "新增", en: "Add" },
  dialog: {
    editTitle: { "zh-TW": "編輯分類", en: "Edit category" },
    addTitle: { "zh-TW": "新增分類", en: "Add category" },
    name: { "zh-TW": "名稱", en: "Name" },
    namePlaceholder: { "zh-TW": "例：租金費用", en: "e.g. Rent expense" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    save: { "zh-TW": "儲存", en: "Save" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
  },
  toast: {
    added: { "zh-TW": "已新增分類", en: "Category added" },
    updated: { "zh-TW": "已更新分類", en: "Category updated" },
  },
} satisfies Dictionary;

export default categories;
