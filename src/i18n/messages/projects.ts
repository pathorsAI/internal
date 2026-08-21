import type { Dictionary } from "./dictionary";

const projects = {
  status: {
    active: { "zh-TW": "進行中", en: "Active" },
    archived: { "zh-TW": "封存", en: "Archived" },
  },
  list: {
    title: { "zh-TW": "專案", en: "Projects" },
    description: { "zh-TW": "每個專案的收支由交易上的「專案」欄位彙總（P&L）", en: "Each project's income and expense are aggregated from the \"Project\" field on transactions (P&L)" },
    newButton: { "zh-TW": "新增專案", en: "Add project" },
    rowDescription: { "zh-TW": "專案", en: "Project" },
    columns: {
      project: { "zh-TW": "專案", en: "Project" },
      customer: { "zh-TW": "客戶", en: "Client" },
      status: { "zh-TW": "狀態", en: "Status" },
      income: { "zh-TW": "收入", en: "Income" },
      expense: { "zh-TW": "支出", en: "Expense" },
      net: { "zh-TW": "淨額", en: "Net" },
    },
    empty: { "zh-TW": "尚無專案，點右上角新增", en: "No projects yet — add one from the top right" },
  },
  newDialog: {
    trigger: { "zh-TW": "新增專案", en: "Add project" },
    title: { "zh-TW": "新增專案", en: "Add project" },
    description: { "zh-TW": "專案的收支由交易上的「專案」欄位彙總", en: "A project's income and expense are aggregated from the \"Project\" field on transactions" },
    name: {
      label: { "zh-TW": "專案名稱", en: "Project name" },
      placeholder: { "zh-TW": "例：官網改版、A 客戶系統", en: "e.g. Website redesign, Client A system" },
    },
    status: { "zh-TW": "狀態", en: "Status" },
    descriptionField: {
      label: { "zh-TW": "說明", en: "Description" },
      placeholder: { "zh-TW": "選填", en: "Optional" },
    },
    submit: { "zh-TW": "儲存", en: "Save" },
    submitting: { "zh-TW": "儲存中…", en: "Saving…" },
    toast: {
      added: { "zh-TW": "已新增專案", en: "Project added" },
    },
  },
  editForm: {
    cancel: { "zh-TW": "取消", en: "Cancel" },
    submit: { "zh-TW": "儲存變更", en: "Save changes" },
    submitting: { "zh-TW": "儲存中…", en: "Saving…" },
    toast: {
      updated: { "zh-TW": "已更新", en: "Updated" },
    },
  },
} satisfies Dictionary;

export default projects;
