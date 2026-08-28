import type { Dictionary } from "./dictionary";

/**
 * 法律文件（/privacy、/terms）的「外框」文案：標題、導言、metadata、頁首頁尾的連結，
 * 以及尚未經律師審閱的提示。
 *
 * 條文本體**不在這裡**。那是逐條的長文，含 <strong>、<code>、表格與清單，硬塞進字典
 * 會變成一堆切碎的 key，反而讀不出法律文件原本的樣子；所以兩個語系各寫一份完整的
 * JSX（src/app/privacy/content-*.tsx、src/app/terms/content-*.tsx），由 page.tsx 依
 * 語系挑一份。改條文時兩份都要改 —— 這是刻意的：法律文本兩種語言各自成立，不是模板
 * 代入的產物。
 *
 * eyebrow 兩個語系都是英文（Privacy Policy / Terms of Service），跟改版前一致：它是
 * 版面上的分類小標，不是句子。
 */
const legal = {
  /** LegalDoc 外框共用的字串。 */
  chrome: {
    updated: {
      "zh-TW": "最後更新日期：{date}",
      en: "Last updated: {date}",
    },
    /**
     * `<b>` 由 LegalDoc 換成 <strong>。整段寫成一則而不是拆「粗體句 + 其餘」，是為了
     * 讓句距跟著語系走：中文的句號後面不留空白，英文要留一個。
     */
    draftNotice: {
      "zh-TW":
        "<b>本文件尚未經律師審閱。</b>內容是依系統實際行為逐條寫成的，力求準確，但用字未必符合法律文書慣例。正式版本會在律師檢視後更新於本頁。",
      en: "<b>This document has not been reviewed by a lawyer.</b> It was written clause by clause from how the system actually behaves and aims to be accurate, but its wording may not follow the conventions of legal drafting. The formal version will be published on this page once a lawyer has reviewed it.",
    },
    company: {
      "zh-TW": "派斯科技股份有限公司",
      en: "Pathors Technology Co., Ltd.",
    },
    home: { "zh-TW": "回首頁", en: "Back to home" },
  },

  privacy: {
    eyebrow: { "zh-TW": "Privacy Policy", en: "Privacy Policy" },
    title: { "zh-TW": "隱私權政策", en: "Privacy Policy" },
    lede: {
      "zh-TW":
        "這份政策說明 Internal 收集哪些資料、為什麼收集、交給誰處理、保存多久，以及你可以要求我們做什麼。",
      en: "This policy explains what data Internal collects, why it collects it, who it is handed to for processing, how long it is kept, and what you can ask us to do.",
    },
    metaTitle: { "zh-TW": "隱私權政策 — Internal", en: "Privacy Policy — Internal" },
    metaDescription: {
      "zh-TW":
        "Internal 收集哪些資料、用途、受託處理者、第三方 AI 客戶端的存取與撤銷方式、保存期限與你的權利。",
      en: "What data Internal collects, what it is used for, the processors it is handed to, how third-party AI clients get access and how to revoke it, retention periods, and your rights.",
    },
  },

  terms: {
    eyebrow: { "zh-TW": "Terms of Service", en: "Terms of Service" },
    title: { "zh-TW": "服務條款", en: "Terms of Service" },
    lede: {
      "zh-TW": "這份條款規範你使用 Internal 的權利與義務。開始使用本服務，即表示你同意以下內容。",
      en: "These terms govern your rights and obligations when using Internal. By starting to use the Service, you agree to what follows.",
    },
    metaTitle: { "zh-TW": "服務條款 — Internal", en: "Terms of Service — Internal" },
    metaDescription: {
      "zh-TW":
        "使用 Internal 的條款：服務內容、帳號與工作空間的權責、可接受使用、內容歸屬、費用、免責與責任限制、終止與準據法。",
      en: "The terms for using Internal: what the service is, responsibilities for accounts and workspaces, acceptable use, ownership of content, fees, disclaimers and limitation of liability, termination, and governing law.",
    },
  },
} satisfies Dictionary;

export default legal;
