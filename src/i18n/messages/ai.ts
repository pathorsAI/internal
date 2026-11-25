import type { Dictionary } from "./dictionary";

/** 站內 AI 助理：/dashboard/ai、首頁輸入框、⌘K、外部 agent logo 列。 */
const ai = {
  title: { "zh-TW": "AI 助理", en: "AI assistant" },
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
    rules: { "zh-TW": "規則", en: "Rules" },
    channel: {
      line: { "zh-TW": "LINE", en: "LINE" },
      whatsapp: { "zh-TW": "WhatsApp", en: "WhatsApp" },
    },
  },
  chat: {
    emptyTitle: { "zh-TW": "想查什麼、記什麼，直接說", en: "Ask anything about the books" },
    emptyBody: {
      "zh-TW": "查詢會直接回答；新增、修改、刪除會先給你確認。",
      en: "Lookups are answered right away. Anything that changes data asks you first.",
    },
    readOnly: {
      "zh-TW": "你的角色可以查詢，以及提交自己的代墊；其他新增或修改要請管理者處理。",
      en: "Your role can look things up and submit your own advances. Other changes need an owner or admin.",
    },
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
    undone: { "zh-TW": "已復原", en: "Undone" },
  },
  options: {
    label: { "zh-TW": "快速回覆", en: "Quick replies" },
  },
  rules: {
    title: { "zh-TW": "AI 規則", en: "AI rules" },
    metaTitle: { "zh-TW": "AI 規則 · Internal", en: "AI rules · Internal" },
    columns: {
      text: { "zh-TW": "原話", en: "What was said" },
      effect: { "zh-TW": "條件 → 動作", en: "When → then" },
      scope: { "zh-TW": "範圍", en: "Scope" },
      createdBy: { "zh-TW": "誰教的", en: "Taught by" },
      source: { "zh-TW": "從哪裡", en: "From" },
      applyCount: { "zh-TW": "套用次數", en: "Applied" },
      lastApplied: { "zh-TW": "最後套用", en: "Last applied" },
      actions: { "zh-TW": "動作", en: "Actions" },
    },
    scope: {
      org: { "zh-TW": "組織", en: "Organization" },
      user: { "zh-TW": "個人", en: "Just me" },
    },
    source: {
      web: { "zh-TW": "網頁", en: "Web" },
      line: { "zh-TW": "LINE", en: "LINE" },
      whatsapp: { "zh-TW": "WhatsApp", en: "WhatsApp" },
      mcp: { "zh-TW": "MCP", en: "MCP" },
    },
    kind: {
      category: { "zh-TW": "分類", en: "Category" },
      advance_default: { "zh-TW": "代墊預設", en: "Advance default" },
      note: { "zh-TW": "備註", en: "Note" },
    },
    disabled: { "zh-TW": "已停用", en: "Off" },
    disable: { "zh-TW": "停用", en: "Turn off" },
    enable: { "zh-TW": "啟用", en: "Turn on" },
    updateFailed: { "zh-TW": "更新失敗", en: "Couldn't update" },
    deleteTitle: { "zh-TW": "刪除這條規則？", en: "Delete this rule?" },
    deleteDescription: { "zh-TW": "AI 之後不會再照這條規則做，已經記好的交易不受影響。", en: "The assistant stops following it. Entries already recorded are not changed." },
    empty: {
      "zh-TW": "還沒有規則，在對話裡說「以後 Google Workspace 都歸軟體工具」就會記下來。",
      en: "No rules yet. Tell the assistant something like “always file Google Workspace under Software”.",
    },
  },
} satisfies Dictionary;

export default ai;
