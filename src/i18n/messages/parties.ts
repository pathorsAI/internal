import type { Dictionary } from "./dictionary";

const parties = {
  title: { "zh-TW": "交易對象", en: "Counterparties" },
  description: { "zh-TW": "往來的廠商、客戶、機關；收款＝對方付我們、付款＝我們付對方，依幣別分開加總", en: "Vendors, clients, and agencies you deal with. Received = they pay us, paid = we pay them, totaled separately per currency" },
  label: {
    vendor: { "zh-TW": "廠商", en: "Vendor" },
    customer: { "zh-TW": "客戶", en: "Client" },
    gov: { "zh-TW": "政府機關", en: "Government agency" },
    other: { "zh-TW": "其他", en: "Other" },
  },
  columns: {
    name: { "zh-TW": "名稱", en: "Name" },
    type: { "zh-TW": "類型", en: "Type" },
    taxId: { "zh-TW": "統編", en: "Tax ID" },
    txnCount: { "zh-TW": "交易數", en: "Transactions" },
    received: { "zh-TW": "收款", en: "Received" },
    paid: { "zh-TW": "付款", en: "Paid" },
  },
  empty: { "zh-TW": "尚無交易對象", en: "No counterparties yet" },
  emptyHint: { "zh-TW": "點右上角新增", en: "Add one from the top right" },
  rowDialogDescription: { "zh-TW": "交易對象", en: "Counterparty" },
  accountOption: { "zh-TW": "{name}（{currency}）", en: "{name} ({currency})" },
  new: {
    trigger: { "zh-TW": "新增交易對象", en: "Add counterparty" },
    title: { "zh-TW": "新增交易對象", en: "Add counterparty" },
    description: { "zh-TW": "往來的廠商、客戶或機關", en: "A vendor, client, or agency you deal with" },
  },
  form: {
    name: { "zh-TW": "名稱", en: "Name" },
    namePlaceholder: { "zh-TW": "例：AWS、美國客戶、健保署", en: "e.g. AWS, US client, tax office" },
    type: { "zh-TW": "類型", en: "Type" },
    taxId: { "zh-TW": "統一編號", en: "Tax ID" },
    taxIdPlaceholder: { "zh-TW": "選填", en: "Optional" },
    defaultCurrency: { "zh-TW": "預設幣別", en: "Default currency" },
    defaultAccount: { "zh-TW": "預設帳戶", en: "Default account" },
    defaultAccountPlaceholder: { "zh-TW": "— 未指定 —", en: "— Not set —" },
    typicalAmount: { "zh-TW": "慣常金額", en: "Typical amount" },
    typicalAmountPlaceholder: { "zh-TW": "選填", en: "Optional" },
    contact: { "zh-TW": "聯絡資訊", en: "Contact info" },
    contactPlaceholder: { "zh-TW": "選填", en: "Optional" },
    note: { "zh-TW": "備註", en: "Note" },
    notePlaceholder: { "zh-TW": "選填", en: "Optional" },
    isActive: { "zh-TW": "啟用", en: "Active" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    save: { "zh-TW": "儲存", en: "Save" },
    saving: { "zh-TW": "儲存中…", en: "Saving…" },
    saveChanges: { "zh-TW": "儲存變更", en: "Save changes" },
  },
  toast: {
    created: { "zh-TW": "已新增交易對象", en: "Counterparty added" },
    updated: { "zh-TW": "已更新", en: "Updated" },
  },
} satisfies Dictionary;

export default parties;
