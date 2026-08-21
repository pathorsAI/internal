import type { Dictionary } from "./dictionary";

const accountantNotices = {
  title: { "zh-TW": "待通知會計師", en: "Accountant notices" },
  description: { "zh-TW": "電子發票會計師會自動看到;這裡是其他發票（三聯式等），要主動告訴會計師的清單", en: "The accountant automatically sees e-invoices; this is the list of other invoices (paper triplicate etc.) you need to flag to them" },
  columns: {
    date: { "zh-TW": "日期", en: "Date" },
    party: { "zh-TW": "對象", en: "Party" },
    summary: { "zh-TW": "摘要", en: "Summary" },
    amount: { "zh-TW": "金額", en: "Amount" },
    document: { "zh-TW": "憑證", en: "Document" },
    notifiedAt: { "zh-TW": "通知時間", en: "Notified at" },
    action: { "zh-TW": "動作", en: "Action" },
  },
  emptyDone: { "zh-TW": "尚無已通知紀錄", en: "No notified records yet" },
  emptyPending: { "zh-TW": "沒有待通知的其他發票", en: "No other invoices pending notice" },
  noAttachment: { "zh-TW": "（無附檔）", en: "(No attachment)" },
  view: { "zh-TW": "檢視", en: "View" },
  pending: {
    title: { "zh-TW": "待通知", en: "Pending" },
    action: { "zh-TW": "告訴會計師後，按「標記已通知」", en: "After telling the accountant, click \"Mark notified\"" },
  },
  done: {
    title: { "zh-TW": "已通知", en: "Notified" },
  },
  button: {
    markDone: { "zh-TW": "標記已通知", en: "Mark notified" },
    undo: { "zh-TW": "取消", en: "Undo" },
  },
  toast: {
    markedDone: { "zh-TW": "已標記為已通知", en: "Marked as notified" },
    markedUndone: { "zh-TW": "已改回待通知", en: "Reverted to pending" },
    failed: { "zh-TW": "操作失敗", en: "Action failed" },
  },
} satisfies Dictionary;

export default accountantNotices;
