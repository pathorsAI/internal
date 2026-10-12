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
    titleA: { "zh-TW": "你負責決定，", en: "You decide." },
    titleB: { "zh-TW": "AI 負責記帳。", en: "Your AI books it." },
    lede: {
      "zh-TW": "不用再自己 key 帳、對帳。AI 把帳記好，拿不準的才來問你。",
      en: "No more keying in and reconciling by hand. Your AI keeps the books and only asks you when it\u2019s unsure.",
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
    heading: { "zh-TW": "這些狀況，你應該不陌生", en: "You already know how this goes wrong" },
    lede: {
      "zh-TW": "以前這些都要等會計幫你做好。現在小團隊自己用 AI，就收得掉。",
      en: "These used to wait for the accountant. A small team can now clear them with its own AI.",
    },
    driftTitle: { "zh-TW": "帳總是忘了記", en: "Entries never get made on time" },
    driftBody: {
      "zh-TW": "錢進錢出的當下沒記，月底才翻對帳單一筆一筆補，補到一半已經不知道哪幾筆記過了。",
      en: "Money moves and nobody writes it down. At month end you rebuild it from the bank statement, line by line, unsure which ones you already entered.",
    },
    unbilledTitle: { "zh-TW": "合約走到哪一期，沒人說得清", en: "Nobody knows where each contract stands" },
    unbilledBody: {
      "zh-TW": "哪個案子簽了、哪一期該請款、哪一期已經請了，散在信件和試算表裡，問一次就要翻半小時。",
      en: "Which projects are signed, which stage is due, which one is already billed — it is scattered across email and spreadsheets, and every answer takes half an hour of digging.",
    },
    unknownTitle: { "zh-TW": "收款日期對不起來", en: "Payment dates never line up" },
    unknownBody: {
      "zh-TW": "客戶說已經匯了，帳上卻找不到；哪筆款項對到哪張發票、哪一期，每次都要人工一筆一筆比。",
      en: "The client says they paid and the books cannot find it. Matching each payment to its invoice and stage is done by hand, every time.",
    },
  },

  books: {
    badge: { "zh-TW": "兩份 Excel 對不起來", en: "Two spreadsheets that never agree" },
    heading: { "zh-TW": "內外帳記一次，兩邊自動對齊", en: "Enter it once. Both books agree." },
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
    badge: { "zh-TW": "做完了，卻忘了請款", en: "Work shipped, never billed" },
    heading: { "zh-TW": "項目款項一鍵追蹤", en: "Every project\u2019s payments, tracked at a glance" },
    lede: {
      "zh-TW": "每個案子分幾期、哪一期該請、哪一期還沒收，一頁看完，每一列都寫著下一步。",
      en: "How many stages each project has, which one is due, which is still unpaid — one page, with the next step on every row.",
    },
    shotLabel: { "zh-TW": "請款看板", en: "Billing board" },
    shotAlt: {
      "zh-TW": "請款看板，上方是彙總卡片，下方每一筆請款項目都附著下一步",
      en: "The billing board, with summary cards and every billing item alongside its next step",
    },
  },

  flow: {
    heading: { "zh-TW": "狀態自己往前走，沒有項目會卡住", en: "Statuses move on their own. Nothing gets stuck." },
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
    heading: { "zh-TW": "分期合約和月費訂閱，排在同一張清單", en: "Staged contracts and monthly subscriptions, one list" },
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
    badge: { "zh-TW": "提醒放在系統裡，沒人會去看", en: "Reminders nobody opens" },
    heading: { "zh-TW": "該請款、該催款，手機自己提醒你", en: "Your phone tells you when to bill and when to chase" },
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
    badge: { "zh-TW": "每季重做一份試算表", en: "Rebuilding the spreadsheet every quarter" },
    heading: { "zh-TW": "花費分布一看便知", en: "See where the money goes at a glance" },
    lede: {
      "zh-TW": "錢花去哪些廠商、哪些分類，每月收支和帳戶餘額的走勢，打開就是最新的，不用再自己拉表。",
      en: "Which vendors and categories the money goes to, plus monthly cash flow and balance trends — current the moment you open it, no spreadsheet to rebuild.",
    },
    overviewLabel: { "zh-TW": "總覽", en: "Overview" },
    overviewAlt: {
      "zh-TW": "總覽頁：各帳戶餘額、每月現金流與餘額走勢",
      en: "Overview page showing balances per account, monthly cash flow and the balance trend",
    },
    spendLead: {
      "zh-TW": "支出去向，",
      en: "Where spending goes,",
    },
    spendBody: {
      "zh-TW": "前八大廠商或分類排給你看，點一下就篩出那些交易。",
      en: "the top eight vendors or categories, one click away from the transactions behind them.",
    },
    balancesLead: { "zh-TW": "每個帳戶還剩多少，一眼看完。", en: "Every account, every currency, at a glance." },
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
    ageingLead: { "zh-TW": "誰拖款最久，", en: "Who has owed you longest," },
    ageingBody: {
      "zh-TW": "照客戶排好給你，不只看金額大小。",
      en: "client by client — not just how much.",
    },
    coverageLead: { "zh-TW": "簽了約卻沒排請款，", en: "A signed contract with no billing schedule" },
    coverageBody: {
      "zh-TW": "系統會把它抓出來，這筆錢就不會忘了要。",
      en: "gets flagged, so that money is never forgotten.",
    },
  },

  assistant: {
    badge: { "zh-TW": "每個月手動 key 對帳單", en: "Typing in the bank statement by hand" },
    heading: {
      "zh-TW": "對帳單丟給 AI，它問清楚再入帳",
      en: "Hand the statement to your AI. It asks, then books it.",
    },
    lede: {
      "zh-TW": "不用等我們串接你的銀行。你每個月本來就拿得到對帳單，丟給你自己的 AI，它會直接把交易寫進來。",
      en: "No need to wait for a bank integration. You already get a statement every month — hand it to your own AI and it writes the transactions straight in.",
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
    heading: { "zh-TW": "每個月其他的麻煩，也一起收掉", en: "The rest of the monthly mess, handled too" },
    lede: {
      "zh-TW": "記帳不只有帳本和發票。這些小事，每一件都曾經吃掉一個下午。",
      en: "Bookkeeping is not only ledgers and invoices. Each of these used to eat an afternoon.",
    },
    partiesTitle: { "zh-TW": "同一家客戶不再有三種寫法", en: "One client, one spelling" },
    partiesBody: {
      "zh-TW": "每一個往來對象都是一筆正式資料，名字不會被重複輸入，也不會出現兩種寫法。",
      en: "Everyone you deal with is a proper record, so a name is never typed twice or spelled two ways.",
    },
    advancesTitle: { "zh-TW": "誰代墊了多少，一筆不漏", en: "Who fronted what, never lost" },
    advancesBody: {
      "zh-TW": "有人先自掏腰包付了。記下公司欠他多少，好好結清。",
      en: "Someone paid out of their own pocket. Track what the company owes them and settle it properly.",
    },
    reconciliationTitle: { "zh-TW": "跟銀行對帳，差額一目了然", en: "Bank reconciliation, differences in plain sight" },
    reconciliationBody: {
      "zh-TW": "把銀行的紀錄跟你記的對起來，差額直接寫下來，不要用猜的。",
      en: "Match what the bank says against what you recorded, and write down the difference instead of arguing with it.",
    },
    payrollTitle: { "zh-TW": "薪資從試算到薪資單一次走完", en: "Payroll from calculation to payslip in one pass" },
    payrollBody: {
      "zh-TW": "接上 Simpany，試算、寫入、送記帳士、寄薪資單一路完成，發薪直接入內帳。",
      en: "Connected to Simpany: calculate, file, hand off to the accountant and send payslips in one pass, with pay runs posted to the internal books.",
    },
    recurringTitle: { "zh-TW": "固定扣款不再嚇一跳", en: "No surprise auto-debits" },
    recurringBody: {
      "zh-TW": "訂閱、月租這類固定支出先登記好，扣款前在 Discord 提醒你，每月再回顧一次有沒有漏扣、扣錯帳戶。",
      en: "Log recurring costs once. Discord reminds you before each debit, and a monthly recap flags anything missed or charged to the wrong account.",
    },
    cloudBillingTitle: { "zh-TW": "雲端帳單自動對上帳", en: "Cloud bills match themselves" },
    cloudBillingBody: {
      "zh-TW": "Azure、GCP 的帳單自動抓進來，對到是哪張卡、哪筆交易付的。",
      en: "Azure and GCP invoices come in on their own and get matched to the card and the transaction that paid them.",
    },
    einvoiceTitle: { "zh-TW": "電子發票自動同步", en: "E-invoices sync themselves" },
    einvoiceBody: {
      "zh-TW": "接上 Simpany，開出的電子發票每天早上自動同步回來，綁到對應的請款項目。",
      en: "Connect Simpany and every invoice you issue syncs back each morning, tied to the billing item it belongs to.",
    },
    wiseTitle: { "zh-TW": "Wise 餘額每天自動更新", en: "Wise balances, updated daily" },
    wiseBody: {
      "zh-TW": "Wise 帳戶唯讀接上，每天早上把餘額和交易同步進來。",
      en: "Connect Wise read-only and every morning its balances and transactions are pulled in.",
    },
    filesTitle: { "zh-TW": "單據跟著交易走，不用翻抽屜", en: "Receipts live on the entry, not in a drawer" },
    filesBody: {
      "zh-TW": "把收據或合約上傳，掛在它對應的那筆交易上。不用再翻鞋盒。",
      en: "Upload the receipt or the contract and attach it to the entry it justifies. No shoebox.",
    },
    orgsTitle: { "zh-TW": "好幾家公司，一個帳號切換", en: "Several companies, one login" },
    orgsBody: {
      "zh-TW": "一套系統管好幾家公司，彼此只看得到自己的數字，切換只要一個點擊。",
      en: "Run several companies from one install. Each one only ever sees its own numbers, and you switch with a click.",
    },
    currencyTitle: { "zh-TW": "美金帳不會被記成台幣", en: "USD never gets booked as TWD" },
    currencyBody: {
      "zh-TW": "美金帳戶就只收美金的交易，系統會擋掉記錯幣別的那一筆。報表按幣別分開加總，不會偷偷幫你換算。",
      en: "A USD account only takes USD transactions — the wrong currency is rejected, not quietly converted. Reports total each currency separately.",
    },
    languagesTitle: { "zh-TW": "中英文一鍵切換", en: "Chinese or English, one click" },
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
