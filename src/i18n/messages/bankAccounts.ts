import type { Dictionary } from "./dictionary";

const bankAccounts = {
  title: { "zh-TW": "銀行帳戶", en: "Bank accounts" },
  description: { "zh-TW": "現金與銀行帳戶", en: "Cash and bank accounts" },
  columns: {
    name: { "zh-TW": "名稱", en: "Name" },
    type: { "zh-TW": "類型", en: "Type" },
    currency: { "zh-TW": "幣別", en: "Currency" },
    status: { "zh-TW": "狀態", en: "Status" },
    openingBalance: { "zh-TW": "期初餘額", en: "Opening balance" },
    currentBalance: { "zh-TW": "目前餘額", en: "Current balance" },
  },
  empty: { "zh-TW": "尚無帳戶", en: "No accounts yet" },
  rowDialogDescription: { "zh-TW": "銀行帳戶", en: "Bank account" },
  physical: { "zh-TW": "實體", en: "Physical" },
  virtual: { "zh-TW": "虛擬", en: "Virtual" },
  active: { "zh-TW": "啟用", en: "Active" },
  inactive: { "zh-TW": "停用", en: "Inactive" },
  kind: {
    bank: { "zh-TW": "銀行", en: "Bank" },
    wise: { "zh-TW": "Wise / 虛擬", en: "Wise / virtual" },
    cash: { "zh-TW": "現金", en: "Cash" },
  },
  new: {
    trigger: { "zh-TW": "新增帳戶", en: "Add account" },
    title: { "zh-TW": "新增銀行帳戶", en: "Add bank account" },
    description: { "zh-TW": "銀行、Wise / 虛擬帳戶或現金", en: "A bank, Wise / virtual account, or cash" },
  },
  form: {
    name: { "zh-TW": "名稱", en: "Name" },
    namePlaceholder: { "zh-TW": "例：永豐銀行、Wise USD", en: "e.g. SinoPac Bank, Wise USD" },
    type: { "zh-TW": "類型", en: "Type" },
    currency: { "zh-TW": "幣別", en: "Currency" },
    openingBalance: { "zh-TW": "期初餘額", en: "Opening balance" },
    isActive: { "zh-TW": "啟用", en: "Active" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    save: { "zh-TW": "儲存", en: "Save" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
    saveChanges: { "zh-TW": "儲存變更", en: "Save changes" },
  },
  toast: {
    created: { "zh-TW": "已新增帳戶", en: "Account added" },
    updated: { "zh-TW": "已更新", en: "Updated" },
  },
} satisfies Dictionary;

export default bankAccounts;
