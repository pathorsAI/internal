import type { Dictionary } from "./dictionary";

/** 固定支出（/dashboard/recurring-expenses）。Discord 訊息本身是 zh-TW 固定文字，不在這裡。 */
const recurringExpenses = {
  list: {
    title: { "zh-TW": "固定支出", en: "Recurring expenses" },
    description: {
      "zh-TW": "公司定期付給廠商的費用（GCP、Neon、LiveKit…）。接上 Discord 後，扣款前會提醒、每月會發上個月的回顧。",
      en: "What the company pays vendors on a schedule (GCP, Neon, LiveKit…). With Discord connected, the team gets a reminder before each charge and a monthly recap.",
    },
    readOnlyNote: {
      "zh-TW": "只有組織的擁有者或管理員可以新增或修改固定支出。",
      en: "Only organization owners and admins can add or change recurring expenses.",
    },
    rowDescription: { "zh-TW": "固定支出", en: "Recurring expense" },
    columns: {
      name: { "zh-TW": "名稱", en: "Name" },
      schedule: { "zh-TW": "扣款", en: "Charged" },
      paymentMethod: { "zh-TW": "付款方式", en: "Payment method" },
      expected: { "zh-TW": "預估金額", en: "Expected" },
      status: { "zh-TW": "狀態", en: "Status" },
    },
    empty: { "zh-TW": "尚無固定支出", en: "No recurring expenses yet" },
    nextCharge: { "zh-TW": "下次 {date}", en: "Next {date}" },
  },
  schedule: {
    fixed: { "zh-TW": "固定日期", en: "Fixed date" },
    usage: { "zh-TW": "用量計費 / 自動儲值", en: "Usage-based / auto top-up" },
  },
  interval: {
    monthly: { "zh-TW": "每月", en: "Monthly" },
    yearly: { "zh-TW": "每年", en: "Yearly" },
    quarterly: { "zh-TW": "每季", en: "Quarterly" },
    everyNMonths: { "zh-TW": "每 {months} 個月", en: "Every {months} months" },
  },
  status: {
    active: { "zh-TW": "啟用", en: "Active" },
    inactive: { "zh-TW": "停用", en: "Inactive" },
  },
  form: {
    trigger: { "zh-TW": "新增固定支出", en: "Add recurring expense" },
    title: { "zh-TW": "新增固定支出", en: "Add recurring expense" },
    description: {
      "zh-TW": "登記一家定期扣款的廠商，以及預期用哪個付款方式（哪張卡）扣。",
      en: "Register a vendor that charges on a schedule, and which payment method (card) it should hit.",
    },
    name: {
      label: { "zh-TW": "名稱", en: "Name" },
      placeholder: { "zh-TW": "例：Google Cloud", en: "e.g. Google Cloud" },
    },
    party: { "zh-TW": "廠商", en: "Vendor" },
    matchPattern: {
      label: { "zh-TW": "比對關鍵字", en: "Match keywords" },
      placeholder: { "zh-TW": "例：google*cloud|gcp（留空用名稱）", en: "e.g. google*cloud|gcp (blank = use the name)" },
      help: {
        "zh-TW": "交易的對象名稱或說明含有任一段（| 分隔、不分大小寫）就算這筆固定支出的扣款。",
        en: "A transaction counts toward this expense when its counterparty or description contains any part (| separated, case-insensitive).",
      },
    },
    paymentMethod: {
      label: { "zh-TW": "付款方式", en: "Payment method" },
      none: { "zh-TW": "不指定", en: "Not set" },
      inactive: { "zh-TW": "（停用）", en: " (inactive)" },
      help: {
        "zh-TW": "卡別、末四碼與卡費從哪個帳戶扣，都在「廠商計費 › 付款方式」設定。",
        en: "Card brand, last 4 and the account the card bill is paid from are set under Vendor billing › Payment methods.",
      },
    },
    schedule: { "zh-TW": "扣款方式", en: "Charged on" },
    anchorDate: {
      label: { "zh-TW": "扣款日（任一次已知的）", en: "A known charge date" },
      help: {
        "zh-TW": "固定日期扣款必填。之後每隔幾個月同一天扣（遇到小月壓到月底）。",
        en: "Required for fixed-date charges. It repeats on the same day every interval (clamped to month end).",
      },
    },
    intervalMonths: { "zh-TW": "每隔幾個月扣一次", en: "Months between charges" },
    expectedAmount: { "zh-TW": "預估金額", en: "Expected amount" },
    currency: { "zh-TW": "幣別", en: "Currency" },
    billingUrl: {
      label: { "zh-TW": "廠商帳單頁", en: "Vendor billing page" },
      placeholder: { "zh-TW": "https://…", en: "https://…" },
    },
    status: { "zh-TW": "狀態", en: "Status" },
    note: {
      label: { "zh-TW": "備註", en: "Note" },
      placeholder: { "zh-TW": "選填", en: "Optional" },
    },
    submit: { "zh-TW": "儲存", en: "Save" },
    submitting: { "zh-TW": "儲存中…", en: "Saving…" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    saveChanges: { "zh-TW": "儲存變更", en: "Save changes" },
    toast: {
      added: { "zh-TW": "已新增固定支出", en: "Recurring expense added" },
      updated: { "zh-TW": "已更新", en: "Updated" },
    },
  },
} satisfies Dictionary;

export default recurringExpenses;
