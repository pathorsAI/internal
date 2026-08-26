import type { Dictionary } from "./dictionary";

/**
 * 公開 landing page（`/`）的文案。
 *
 * key 依照 LANDING_HTML 的區塊 id 分群（hero / books / billing / …），模板裡以
 * `{{hero.lede}}` 這種佔位符引用，由 src/app/landing-template.ts 代入並逐一 escape。
 *
 * 兩條規則，改文案時請跟著守：
 *  1. **這裡不放 HTML 標記。** 句子中間有 `<b>` 或 `<br>` 的，拆成 `…Lead` / `…Body`
 *     兩個 key，標記留在模板裡 —— 值一律會被 escape，寫進來的標籤只會變成字面文字。
 *  2. **中文是「寫」的，不是翻的。** 英文那側是有語氣的行銷文案，中文照台灣人講話的
 *     方式重寫，用語跟系統內其他 namespace 對齊（內外帳／請款／對帳／發票）。
 *
 * 專有名詞不翻：Internal、MCP、Apache 2.0、GitHub、PostgreSQL、Google。
 * demo 裡的虛構公司名（Verdant Biosciences 等）與檔名、金額同理，留在模板裡。
 */
const landing = {
  meta: {
    title: { "zh-TW": "你的 AI 也接得進來的總帳", en: "A Ledger Your AI Can Plug Into" },
    description: {
      "zh-TW": "台幣帳、美金帳、內帳、外帳 —— 一筆交易只記一次，兩邊自己對得起來。它是一台 MCP 伺服器：你自己的 AI 讀得到帳本，也能把每個月的對帳單直接寫進來。",
      en: "A TWD account, a USD account, the internal books, the external books — enter a transaction once and both sides stay in step. It is an MCP server too, so your own AI can read the ledger and write the month\u2019s statement straight into it.",
    },
  },

  cta: {
    login: { "zh-TW": "登入", en: "Log in" },
    openApp: { "zh-TW": "進入系統", en: "Open app" },
  },

  nav: {
    howItWorks: { "zh-TW": "怎麼運作", en: "How it works" },
    assistant: { "zh-TW": "接上你的 AI", en: "Your AI" },
    billing: { "zh-TW": "請款", en: "Billing" },
  },

  hero: {
    badge: { "zh-TW": "開源 · Apache 2.0", en: "Open source · Apache 2.0" },
    titleA: { "zh-TW": "你負責決定，", en: "You decide." },
    titleB: { "zh-TW": "AI 負責記帳。", en: "Your AI books it." },
    lede: {
      "zh-TW": "一本總帳裝下所有帳戶 —— 台幣、美金、內帳、外帳。透過 MCP，你自己的 AI 讀得到也寫得進去；拿不準的帳，它會先問你再寫。",
      en: "One ledger holds every account — TWD, USD, the internal books, the external books. Over MCP your own AI reads it and writes to it, and asks you before committing anything it is unsure about.",
    },
    secondary: { "zh-TW": "看看怎麼運作", en: "See how it works" },
    trustSelfHost: { "zh-TW": "雲端直接用，或自己架", en: "Hosted, or run it yourself" },
    trustFree: { "zh-TW": "自架永遠免費", en: "Free forever if you self-host" },
  },

  demo: {
    heading: { "zh-TW": "同樣三筆交易，兩種記法", en: "The same three transactions, kept two ways" },
    tablistLabel: { "zh-TW": "記帳方式", en: "Bookkeeping approach" },
    tabOne: { "zh-TW": "一本總帳", en: "One ledger" },
    tabTwo: { "zh-TW": "兩份試算表", en: "Two spreadsheets" },
    srcTag: { "zh-TW": "一筆輸入", en: "One entry" },
    srcDesc: {
      "zh-TW": "Verdant Biosciences — 數據儀表板加購",
      en: "Verdant Biosciences — data dashboard add-on",
    },
    srcChip: { "zh-TW": "內外帳都算", en: "Both books" },
    internalBook: { "zh-TW": "內帳", en: "Internal book" },
    externalBook: { "zh-TW": "外帳", en: "External book" },
    inSync: { "zh-TW": "一致", en: "in sync" },
    rowPayroll: { "zh-TW": "當月薪資發放", en: "Monthly payroll run" },
    rowSaas: { "zh-TW": "團隊軟體訂閱", en: "Team software subscriptions" },
    verdictOkChip: { "zh-TW": "對得起來", en: "Agreeing" },
    verdictOkText: {
      "zh-TW": "一筆輸入，標記為內外帳都算。改一次，兩本帳一起跟著改。",
      en: "One entry, marked as belonging to both. Change it once and both books change with it.",
    },
    verdictBadChip: { "zh-TW": "差了 NT$20,000", en: "Off by NT$20,000" },
    verdictBadText: {
      "zh-TW": "有人改了其中一份，另一份沒人記得改。",
      en: "Someone corrected one file. Nobody corrected the other.",
    },
  },

  problems: {
    heading: { "zh-TW": "這些狀況你應該不陌生", en: "You already know how this goes wrong" },
    lede: {
      "zh-TW": "每一家自己記帳的小公司，都會遇到這三件事。",
      en: "Three things that happen to every small company that keeps its own books.",
    },
    driftTitle: { "zh-TW": "兩份檔案對不起來了", en: "The two files stopped matching" },
    driftBody: {
      "zh-TW": "有人在其中一邊改了數字，另一邊忘了改。等到三月才發現，早就想不起來哪一個才是對的。",
      en: "Someone fixed a number in one place and not the other. You find out in March, when it is far too late to remember which one was right.",
    },
    unbilledTitle: { "zh-TW": "請款單根本沒寄出去", en: "The invoice never went out" },
    unbilledBody: {
      "zh-TW": "東西五月就交付了，請款卻拖到八月，還是客戶先來問才想起來。中間那三個月沒有人在看。",
      en: "The work shipped in May. The invoice went out in August, after the client asked about it. Nobody was watching the gap in between.",
    },
    unknownTitle: { "zh-TW": "沒人說得出來還有多少錢沒收", en: "Nobody can say what you are owed" },
    unknownBody: {
      "zh-TW": "除非打開四個檔案、一個一個篩選再手動加總 —— 而且每算一次答案都不太一樣。",
      en: "Not without opening four files, filtering each one and adding it up by hand — and getting a slightly different answer every time.",
    },
  },

  books: {
    badge: { "zh-TW": "內外帳", en: "Dual books" },
    heading: { "zh-TW": "標記一次，之後它自己歸位。", en: "Mark it once. It files itself." },
    lede: {
      "zh-TW": "每一筆交易都標明它屬於哪本帳：內帳、外帳，或兩本都算。兩邊看的是同一批資料，所以不可能各走各的。",
      en: "Every transaction says which books it belongs to — internal, external, or both. The two views read from the same rows, so they cannot drift apart.",
    },
    payrollLead: { "zh-TW": "薪資只留在內帳。", en: "Salaries stay internal." },
    payrollBody: {
      "zh-TW": "標成內帳的薪資發放不會出現在外帳，你不用刪掉它，也不用另外留一份。",
      en: "A pay run marked internal never appears in the external view. You do not delete it, and you do not keep a second copy of it.",
    },
    incomeLead: { "zh-TW": "客戶收入刻意算兩次。", en: "Client income counts twice, on purpose." },
    incomeBody: {
      "zh-TW": "兩本帳都要認的收入只輸入一次，兩邊都會出現。",
      en: "Revenue that belongs in both books is entered once and shows up in both.",
    },
    currencyLead: { "zh-TW": "兩種幣別，兩組合計。", en: "Two currencies, two totals." },
    currencyBody: {
      "zh-TW": "台幣和美金分開加總，系統不會自己幫你假設一個匯率。",
      en: "New Taiwan dollars and US dollars are added up separately. Nothing invents an exchange rate for you.",
    },
    shotLabel: { "zh-TW": "內外帳", en: "Dual books" },
    shotAlt: {
      "zh-TW": "交易列表，每一筆都標示屬於內帳、外帳或兩者",
      en: "The ledger listing transactions, each marked as internal, external or both",
    },
  },

  billing: {
    badge: { "zh-TW": "請款看板", en: "Billing board" },
    heading: { "zh-TW": "該收的錢，一頁看完", en: "One page for everything you are owed" },
    lede: {
      "zh-TW": "誰該請款、誰已經請了、誰還沒付 —— 每一列都直接寫著下一步要做什麼。",
      en: "Who should be billed, who has been billed, and who still has not paid — with the next thing to do sitting on every row.",
    },
    shotLabel: { "zh-TW": "請款看板", en: "Billing board" },
    shotAlt: {
      "zh-TW": "請款看板，上方是彙總卡片，下方每一筆請款項目都附著下一步",
      en: "The billing board, with summary cards and every billing item alongside its next step",
    },
  },

  flow: {
    heading: { "zh-TW": "不會有卡在中間沒人管的項目", en: "Nothing sits in limbo" },
    lede: {
      "zh-TW": "日期到了、款項進來了，項目就自己往前走。狀態不用手動改，也就不會默默錯掉。",
      en: "An item moves forward on its own as dates pass and payments arrive. You never set a status by hand, so it is never quietly wrong.",
    },
    upcoming: { "zh-TW": "未到期", en: "Upcoming" },
    due: { "zh-TW": "該請款", en: "Time to bill" },
    billed: { "zh-TW": "已請款", en: "Billed" },
    partial: { "zh-TW": "部分收款", en: "Part paid" },
    paid: { "zh-TW": "已收款", en: "Paid" },
    overdueChip: { "zh-TW": "逾期未收", en: "Overdue" },
    overdueBody: {
      "zh-TW": "過了期限還沒收到錢。它會離開這條流程，另外算在一張卡片上，讓你不可能忽略。",
      en: "Past the deadline and still not paid. It leaves the queue and gets counted on its own card, where you cannot miss it.",
    },
  },

  merge: {
    heading: { "zh-TW": "兩種收錢方式，同一份清單", en: "Two kinds of money, one list" },
    lede: {
      "zh-TW": "合約簽一次、分期請款；訂閱則是每個月收一次，收到停約為止。但對星期二早上的你來說，它們就是同一件事，所以放在同一份清單裡。",
      en: "A contract is signed once and billed in stages. A subscription bills every month, forever. On a Tuesday morning they are the same job, so they share the same list.",
    },
    contract: { "zh-TW": "合約", en: "Contract" },
    contractNote: { "zh-TW": "· 分期請款", en: "· billed in stages" },
    subscription: { "zh-TW": "訂閱", en: "Subscription" },
    subscriptionNote: { "zh-TW": "· 每個月", en: "· every month" },
    outHeading: { "zh-TW": "依到期日排序", en: "Due, in date order" },
    rowKickoff: { "zh-TW": "第一期 — 開發啟動", en: "Phase 1 — build kickoff" },
    rowOps: { "zh-TW": "平台維運", en: "Platform operations" },
    rowPos: { "zh-TW": "POS 維護", en: "POS maintenance" },
    rowInterim: { "zh-TW": "期中款 30%", en: "Interim payment 30%" },
  },

  reminders: {
    badge: { "zh-TW": "提醒", en: "Reminders" },
    heading: { "zh-TW": "找得到你的提醒", en: "Nagging that reaches you" },
    lede: {
      "zh-TW": "只在系統裡跳的提醒，要有人打開系統才有用。這裡的提醒會直接寫進 Google 日曆 —— 早上九點就跟你的會議一起出現在手機上。",
      en: "A reminder inside the app only works if someone opens the app. These go into a Google Calendar instead — so they turn up on your phone at nine in the morning, next to your meetings.",
    },
    sub: {
      "zh-TW": "日曆只要接一次。案子的日期改了，提醒也跟著改，背後不需要另外養一支服務。",
      en: "Connect the calendar once. Dates move when the work moves. There is nothing to keep running in the background.",
    },
    month: { "zh-TW": "2026 年 8 月", en: "August 2026" },
    billLead: { "zh-TW": "該請款了。", en: "Send the bill." },
    billBody: { "zh-TW": "合約某一期到了應請款日。", en: "The date a stage of a contract comes due." },
    chaseLead: { "zh-TW": "該催款了。", en: "Chase the payment." },
    chaseBody: { "zh-TW": "你給客戶的付款期限。", en: "The deadline you gave the client." },
    invoiceLead: { "zh-TW": "該開發票了。", en: "Issue the invoice." },
    invoiceBody: {
      "zh-TW": "營業稅期結束，但發票還沒開完。",
      en: "The end of a tax period you still owe paperwork for.",
    },
  },

  reports: {
    badge: { "zh-TW": "總覽與報表", en: "Overview & reports" },
    heading: { "zh-TW": "錢在哪裡，誰又拖著沒付", en: "Where the money is, and who is late" },
    lede: {
      "zh-TW": "這兩個你每天都在問的問題，兩頁就答完，不用每一季重做一份試算表。",
      en: "Two questions you ask constantly, answered on two pages instead of in a spreadsheet you rebuild every quarter.",
    },
    overviewLabel: { "zh-TW": "總覽", en: "Overview" },
    overviewAlt: {
      "zh-TW": "總覽頁：各帳戶餘額、每月現金流與餘額走勢",
      en: "Overview page showing balances per account, monthly cash flow and the balance trend",
    },
    balancesLead: { "zh-TW": "每個帳戶、每種幣別。", en: "Every account, every currency." },
    balancesBody: {
      "zh-TW": "餘額並排列出、不換算，你看到的數字就是銀行裡的數字。",
      en: "Balances sit side by side, unconverted, so the number you read is the number in the bank.",
    },
    cashflowLead: { "zh-TW": "收進來的和付出去的，", en: "Money in against money out," },
    cashflowBody: {
      "zh-TW": "一個月一個月對照，後面還有走勢。",
      en: "month by month, with the trend behind it.",
    },
    reportsLabel: { "zh-TW": "報表", en: "Reports" },
    reportsAlt: {
      "zh-TW": "報表頁：應收帳齡、營業稅期與合約完整性",
      en: "Reports page with receivables ageing, tax periods and contract coverage",
    },
    ageingLead: { "zh-TW": "這筆錢欠多久了，", en: "How old the debt is," },
    ageingBody: {
      "zh-TW": "一個客戶一個客戶看 —— 不是只看金額多大。",
      en: "per client — not just how big it is.",
    },
    coverageLead: { "zh-TW": "談好卻從沒請款的工作。", en: "Work you agreed to but never billed for." },
    coverageBody: {
      "zh-TW": "簽了約卻沒排請款期別，那筆錢你就會忘記去要。",
      en: "A signed contract nobody scheduled is money you will forget to ask for.",
    },
  },

  assistant: {
    badge: { "zh-TW": "AI 助理 · MCP", en: "AI assistant · MCP" },
    heading: {
      "zh-TW": "不用等我們串接你的銀行",
      en: "You do not have to wait for a bank integration",
    },
    lede: {
      "zh-TW": "大部分記帳工具在拼銀行 API。但你每個月本來就拿得到一份對帳單 —— 把它丟給你自己的 AI，它會直接把交易寫進來。",
      en: "Most bookkeeping tools are racing to integrate with banks. But you already get a statement every month — hand it to your own AI and it writes the transactions straight in.",
    },
    sub: {
      "zh-TW": "關鍵是它會問。哪幾筆只進內帳、哪幾筆外帳也要認、分類拿不準的，它會先跟你確認再寫，而不是猜完就送出。",
      en: "The point is that it asks. Which entries belong only to the internal books, which the external books must own, which category is ambiguous — it checks with you before writing, instead of guessing and committing.",
    },
    audit: {
      "zh-TW": "每一筆經由 AI 的寫入都會留下稽核紀錄，員工個資送出前會遮罩。",
      en: "Every write through the AI lands in the audit log, and employee personal data is masked before it leaves.",
    },
    termTitle: { "zh-TW": "助理", en: "Assistant" },
    termYou: { "zh-TW": "你", en: "you" },
    termBot: { "zh-TW": "助理", en: "assistant" },
    termAsk: {
      "zh-TW": "這是上個月的對帳單，幫我入帳",
      en: "Here is last month\u2019s statement, book it for me",
    },
    termRead: {
      "zh-TW": "讀到 23 筆…有 3 筆我不確定",
      en: "23 transactions read… 3 of them I am not sure about",
    },
    termItem: {
      "zh-TW": "「顧問費 NT$45,000」",
      en: "\u201CConsulting fee, NT$45,000\u201D",
    },
    termWhich: {
      "zh-TW": "—— 只進內帳，還是外帳也認？",
      en: "— internal books only, or do the external books take it too?",
    },
    termAnswer: { "zh-TW": "外帳也要", en: "Yes, external too" },
    termDone: {
      "zh-TW": "好，23 筆都寫進去了",
      en: "Done. All 23 written in.",
    },
  },

  more: {
    heading: { "zh-TW": "一個月剩下的那些事", en: "The rest of the month" },
    lede: {
      "zh-TW": "記帳不是只有帳本和發票。這些是讓它撐得下去的其他部分。",
      en: "Bookkeeping is not only ledgers and invoices. These are the parts that make it survivable.",
    },
    partiesTitle: { "zh-TW": "客戶與廠商", en: "Clients and suppliers" },
    partiesBody: {
      "zh-TW": "每一個往來對象都是一筆正式資料，名字不會被重複輸入，也不會出現兩種寫法。",
      en: "Everyone you deal with is a proper record, so a name is never typed twice or spelled two ways.",
    },
    advancesTitle: { "zh-TW": "同事先代墊的錢", en: "Money people fronted" },
    advancesBody: {
      "zh-TW": "有人先自掏腰包付了。記下公司欠他多少，好好結清。",
      en: "Someone paid out of their own pocket. Track what the company owes them and settle it properly.",
    },
    reconciliationTitle: { "zh-TW": "跟銀行對帳", en: "Checking against the bank" },
    reconciliationBody: {
      "zh-TW": "把銀行的紀錄跟你記的對起來，差額直接寫下來，不要用猜的。",
      en: "Match what the bank says against what you recorded, and write down the difference instead of arguing with it.",
    },
    payrollTitle: { "zh-TW": "薪資", en: "Payroll" },
    payrollBody: {
      "zh-TW": "員工、薪資項目與每月發放，直接入到薪資該待的內帳。",
      en: "Staff, pay items and pay runs, posting straight into the internal books where salaries belong.",
    },
    filesTitle: { "zh-TW": "單據留底", en: "Receipts on file" },
    filesBody: {
      "zh-TW": "把收據或合約上傳，掛在它對應的那筆交易上。不用再翻鞋盒。",
      en: "Upload the receipt or the contract and attach it to the entry it justifies. No shoebox.",
    },
    orgsTitle: { "zh-TW": "不只一家公司", en: "More than one company" },
    orgsBody: {
      "zh-TW": "一套系統管好幾家公司，彼此只看得到自己的數字，切換只要一個點擊。",
      en: "Run several companies from one install. Each one only ever sees its own numbers, and you switch with a click.",
    },
    currencyTitle: { "zh-TW": "多幣別帳戶", en: "Accounts in more than one currency" },
    currencyBody: {
      "zh-TW": "美金帳戶就只收美金的交易，系統會擋掉記錯幣別的那一筆。報表按幣別分開加總，不會偷偷幫你換算。",
      en: "A USD account only takes USD transactions — the wrong currency is rejected, not quietly converted. Reports total each currency separately.",
    },
    languagesTitle: { "zh-TW": "中英文介面", en: "Chinese and English" },
    languagesBody: {
      "zh-TW": "整套跟著切換，連錯誤訊息都是。網址不變，書籤照樣能用。",
      en: "The whole thing switches, error messages included. The address never changes, so bookmarks keep working.",
    },
  },

  finale: {
    heading: { "zh-TW": "別再自己對兩份檔案了", en: "Stop reconciling your own files" },
    body: {
      "zh-TW": "這是我們拿來經營自己公司的工具 —— 不是通用型的會計套裝軟體，也沒打算變成那種東西。如果你也在記內外兩本帳、也在自己追請款，它應該會合用。",
      en: "It is the tool we run our own company on — not a general-purpose accounting suite, and not trying to be. If you keep two sets of books and chase your own invoices, it will probably fit.",
    },
    github: { "zh-TW": "到 GitHub 取得", en: "Get it on GitHub" },
    selfHost: { "zh-TW": "想自己架？", en: "Prefer to run it yourself?" },
    setupGuide: { "zh-TW": "看架設指南", en: "Read the setup guide" },
    // 句號跟著語系走：中文要全形。留在字典裡而不是寫死在模板，就是為了這個。
    stop: { "zh-TW": "。", en: "." },
  },

  footer: {
    privacy: { "zh-TW": "隱私權政策", en: "Privacy" },
    terms: { "zh-TW": "服務條款", en: "Terms" },
  },
} satisfies Dictionary;

export default landing;
