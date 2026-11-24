import type { Dictionary } from "./dictionary";

const projects = {
  // projects.status 欄位本身只剩「封存」這個手動 override；畫面上顯示的是 derivedStatus
  status: {
    active: { "zh-TW": "不封存（依合約與訂閱推導）", en: "Not archived (derived from contracts & subscriptions)" },
    archived: { "zh-TW": "封存", en: "Archived" },
  },
  derivedStatus: {
    active: { "zh-TW": "進行中", en: "Active" },
    completed: { "zh-TW": "已完成", en: "Completed" },
    empty: { "zh-TW": "尚無合約", en: "No contracts" },
    archived: { "zh-TW": "封存", en: "Archived" },
  },
  choice: {
    new: { "zh-TW": "新專案（同合約名）", en: "New project (same name as contract)" },
    none: { "zh-TW": "不歸屬專案", en: "No project" },
    placeholder: { "zh-TW": "搜尋或選擇專案", en: "Search or pick a project" },
    empty: { "zh-TW": "找不到這個專案", en: "No matching project" },
  },
  readyToClose: {
    hint: { "zh-TW": "合約都已完成，可結案", en: "All contracts done — ready to close" },
    archive: { "zh-TW": "封存", en: "Archive" },
    archiving: { "zh-TW": "封存中…", en: "Archiving…" },
    toast: {
      archived: { "zh-TW": "已封存「{name}」", en: "Archived \"{name}\"" },
    },
  },
  unassigned: {
    title: { "zh-TW": "未歸類的合約", en: "Contracts without a project" },
    count: { "zh-TW": "{count} 張", en: "{count}" },
    description: {
      "zh-TW": "這些合約還沒歸到任何專案，收支不會算進專案損益。逐筆選一個專案，或建立同名專案。",
      en: "These contracts aren't in any project yet, so their income and expense don't count toward project P&L. Pick a project for each, or create one with the same name.",
    },
    columns: {
      contract: { "zh-TW": "合約", en: "Contract" },
      customer: { "zh-TW": "客戶", en: "Client" },
      status: { "zh-TW": "狀態", en: "Status" },
      amount: { "zh-TW": "金額", en: "Amount" },
      project: { "zh-TW": "歸入專案", en: "Assign to project" },
    },
    createSameName: { "zh-TW": "建立同名專案", en: "Create project with same name" },
    assign: { "zh-TW": "歸入", en: "Assign" },
    assigning: { "zh-TW": "處理中…", en: "Saving…" },
    pickFirst: { "zh-TW": "先選一個專案", en: "Pick a project first" },
    toast: {
      assigned: { "zh-TW": "已歸入專案", en: "Assigned to project" },
    },
  },
  list: {
    title: { "zh-TW": "專案", en: "Projects" },
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
    children: { "zh-TW": "{contracts} 張合約 · {subscriptions} 個訂閱", en: "{contracts} contracts · {subscriptions} subscriptions" },
    empty: { "zh-TW": "尚無專案，點右上角新增", en: "No projects yet — add one from the top right" },
  },
  newDialog: {
    trigger: { "zh-TW": "新增專案", en: "Add project" },
    title: { "zh-TW": "新增專案", en: "Add project" },
    description: {
      "zh-TW": "專案的狀態與收支由底下的合約與訂閱彙總；建合約時也可以直接建同名專案",
      en: "A project's status and P&L come from its contracts and subscriptions; you can also create a same-name project when adding a contract",
    },
    name: {
      label: { "zh-TW": "專案名稱", en: "Project name" },
      placeholder: { "zh-TW": "例：官網改版、A 客戶系統", en: "e.g. Website redesign, Client A system" },
    },
    status: { "zh-TW": "封存", en: "Archive" },
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
