import type { Dictionary } from "./dictionary";

/** 站內 AI 助理：/dashboard/ai、首頁輸入框、⌘K、外部 agent logo 列。 */
const ai = {
  title: { "zh-TW": "AI 助理", en: "AI assistant" },
  description: { "zh-TW": "用一句話查帳、記帳", en: "Look up and record entries in plain words" },
  metaTitle: { "zh-TW": "AI 助理 · Internal", en: "AI assistant · Internal" },
  prompt: {
    heading: { "zh-TW": "今天要處理什麼帳？", en: "What do you need to do today?" },
    placeholder: { "zh-TW": "問帳務、記一筆、查誰還沒付款…", en: "Ask about the books, record an entry, see who hasn't paid…" },
    submit: { "zh-TW": "送出", en: "Send" },
    shortcut: { "zh-TW": "開啟 AI 助理", en: "Open AI assistant" },
    suggestions: {
      unbilled: { "zh-TW": "這個月還沒請款的客戶", en: "Customers not billed this month" },
      topSpend: { "zh-TW": "上月支出前五名", en: "Top 5 expenses last month" },
      record: { "zh-TW": "記一筆支出", en: "Record an expense" },
    },
  },
  onboard: {
    label: { "zh-TW": "把你的 AI agent 接上 internal", en: "Connect your AI agent to internal" },
    tooltip: { "zh-TW": "複製設定提示詞，貼到你的 AI 工具", en: "Copies a setup prompt for your AI tool" },
    copied: { "zh-TW": "已複製，貼到 Claude Code、Cursor 或 ChatGPT", en: "Copied. Paste it into Claude Code, Cursor or ChatGPT" },
    copyFailed: { "zh-TW": "無法複製，請到 MCP 設定頁手動設定", en: "Couldn't copy. Set it up from the MCP settings page" },
    dismiss: { "zh-TW": "不再顯示", en: "Dismiss" },
  },
  history: {
    title: { "zh-TW": "對話", en: "Chats" },
    new: { "zh-TW": "新對話", en: "New chat" },
    empty: { "zh-TW": "還沒有對話", en: "No chats yet" },
    open: { "zh-TW": "對話紀錄", en: "Chat history" },
    delete: { "zh-TW": "刪除對話", en: "Delete chat" },
    deleteConfirm: { "zh-TW": "刪除「{title}」？刪了就找不回來。", en: "Delete “{title}”? This can't be undone." },
    deleted: { "zh-TW": "已刪除對話", en: "Chat deleted" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    untitled: { "zh-TW": "未命名對話", en: "Untitled chat" },
  },
  chat: {
    emptyTitle: { "zh-TW": "想查什麼、記什麼，直接說", en: "Ask anything about the books" },
    emptyBody: {
      "zh-TW": "查詢會直接回答；新增、修改、刪除會先給你確認。",
      en: "Lookups are answered right away. Anything that changes data asks you first.",
    },
    readOnly: { "zh-TW": "你的角色只能查詢，不能新增或修改。", en: "Your role can look things up but not change data." },
    stop: { "zh-TW": "停止", en: "Stop" },
    thinking: { "zh-TW": "思考中", en: "Thinking" },
    you: { "zh-TW": "你", en: "You" },
    tools: { "zh-TW": "查了 {count} 項資料", en: "{count, plural, one {Used # tool} other {Used # tools}}" },
    toolFailed: { "zh-TW": "失敗", en: "failed" },
    errors: {
      not_configured: {
        "zh-TW": "AI 助理還沒設定好（缺 OPENROUTER_API_KEY），請管理員設定後再試。",
        en: "The AI assistant isn't set up yet (OPENROUTER_API_KEY is missing). Ask an admin.",
      },
      model_failed: { "zh-TW": "模型暫時沒有回應，請再試一次。", en: "The model didn't respond. Try again." },
      not_found: { "zh-TW": "找不到這段對話或這張確認卡。", en: "This chat or confirmation no longer exists." },
      bad_request: { "zh-TW": "這個請求無法處理。", en: "This request couldn't be handled." },
      too_many_rounds: {
        "zh-TW": "這題查了太多步還沒結束，換個問法或拆小一點再問。",
        en: "This took too many steps. Try asking in smaller pieces.",
      },
      internal: { "zh-TW": "出了點問題，請再試一次。", en: "Something went wrong. Try again." },
      network: { "zh-TW": "連線中斷，請再試一次。", en: "Connection lost. Try again." },
    },
  },
  confirm: {
    write: { "zh-TW": "要執行這項變更嗎？", en: "Make this change?" },
    danger: { "zh-TW": "這項變更無法復原", en: "This can't be undone" },
    approve: { "zh-TW": "確認", en: "Confirm" },
    approveDanger: { "zh-TW": "確認刪除", en: "Confirm" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    done: { "zh-TW": "已執行", en: "Done" },
    cancelled: { "zh-TW": "已取消", en: "Cancelled" },
    failed: { "zh-TW": "執行失敗", en: "Failed" },
    running: { "zh-TW": "執行中", en: "Running" },
    details: { "zh-TW": "參數", en: "Details" },
  },
} satisfies Dictionary;

export default ai;
