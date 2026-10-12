import type { Dictionary } from "./dictionary";

const auth = {
  login: {
    title: { "zh-TW": "登入內部管理系統", en: "Sign in to the internal admin system" },
    signInWithGoogle: { "zh-TW": "使用 Google 登入", en: "Sign in with Google" },
    or: { "zh-TW": "或", en: "or" },
    email: {
      label: { "zh-TW": "Email", en: "Email" },
      placeholder: { "zh-TW": "you@company.com", en: "you@company.com" },
      continue: { "zh-TW": "繼續", en: "Continue" },
      checking: { "zh-TW": "確認中…", en: "Checking…" },
    },
    password: {
      label: { "zh-TW": "密碼", en: "Password" },
      change: { "zh-TW": "更改", en: "Change" },
      ssoUnavailable: {
        "zh-TW": "目前無法確認單一登入，請用密碼登入",
        en: "Couldn't check single sign-on right now. Sign in with your password.",
      },
      submit: { "zh-TW": "登入", en: "Sign in" },
      submitting: { "zh-TW": "登入中…", en: "Signing in…" },
      forgot: { "zh-TW": "忘記密碼？", en: "Forgot password?" },
      signup: { "zh-TW": "第一次使用？建立帳號", en: "New here? Create an account" },
    },
    // 網址上帶 ?error= / ?notice= 回到登入頁時的說明，見 src/app/login/login-notice.ts。
    notice: {
      ssoRequired: {
        "zh-TW": "這個 email 的網域已設定公司單一登入（SSO），不能用 Google 或 email 自行註冊。請在下方輸入公司 email，按「繼續」改用 SSO 登入。",
        en: "This email's domain uses your company's single sign-on (SSO), so it can't sign up with Google or email. Enter your work email below and press Continue to sign in with SSO.",
      },
      linkInvalid: {
        "zh-TW": "這個連結已失效或已經用過，請重新申請。",
        en: "This link has expired or has already been used. Please request a new one.",
      },
      passwordUpdated: {
        "zh-TW": "密碼已更新，請用新密碼登入。",
        en: "Your password has been updated. Sign in with your new password.",
      },
      failed: {
        "zh-TW": "登入沒有完成，請再試一次。",
        en: "Sign-in didn't complete. Please try again.",
      },
    },
    toast: {
      failed: { "zh-TW": "登入失敗", en: "Sign-in failed" },
      badCredentials: {
        "zh-TW": "email 或密碼不正確",
        en: "Incorrect email or password",
      },
    },
  },
  // 帳號頁面右半邊的產品展示輪播（src/components/auth/auth-showcase.tsx）。
  // 專案名稱、廠商名稱與金額是示意資料，寫在元件裡；這裡只放會跟著語系變的字。
  showcase: {
    label: { "zh-TW": "產品特色", en: "Product highlights" },
    goTo: { "zh-TW": "顯示第 {index} 張，共 {total} 張", en: "Show slide {index} of {total}" },
    billing: {
      headline: { "zh-TW": "項目款項一鍵追蹤", en: "Every project's payments, tracked at a glance" },
      title: { "zh-TW": "請款", en: "Billing" },
      stage: {
        phase1: { "zh-TW": "第一期", en: "Phase 1" },
        phase2: { "zh-TW": "第二期", en: "Phase 2" },
        monthly: { "zh-TW": "月費", en: "Monthly" },
        final: { "zh-TW": "尾款", en: "Final" },
      },
      status: {
        due: { "zh-TW": "該請款", en: "Time to bill" },
        billed: { "zh-TW": "已請款", en: "Billed" },
        overdue: { "zh-TW": "逾期", en: "Overdue" },
        paid: { "zh-TW": "已收款", en: "Paid" },
      },
    },
    spending: {
      headline: { "zh-TW": "花費分布一看便知", en: "See where the money goes at a glance" },
      title: { "zh-TW": "花費 · 近三個月", en: "Spending · last 3 months" },
      officeRent: { "zh-TW": "辦公室租金", en: "Office rent" },
      other: { "zh-TW": "其他", en: "Other" },
    },
    statement: {
      headline: {
        "zh-TW": "對帳單丟給 AI，它問清楚再入帳",
        en: "Hand the statement to your AI. It asks, then books it.",
      },
      title: { "zh-TW": "AI 助理", en: "AI assistant" },
      upload: { "zh-TW": "這是上個月的對帳單，幫我入帳", en: "Here is last month's statement, book it for me" },
      read: { "zh-TW": "讀到 23 筆，有 3 筆我不確定", en: "23 transactions read — 3 I'm not sure about" },
      ask: {
        "zh-TW": "顧問費 NT$45,000：只進內帳，還是外帳也認？",
        en: "Consulting fee NT$45,000 — internal books only, or external too?",
      },
      answer: { "zh-TW": "外帳也要", en: "External too" },
    },
  },
  // 註冊／忘記密碼／重設密碼／設定密碼這幾頁共用的錯誤訊息與連結。
  shared: {
    backToLogin: { "zh-TW": "回到登入", en: "Back to sign in" },
    emailLabel: { "zh-TW": "Email", en: "Email" },
    emailPlaceholder: { "zh-TW": "you@company.com", en: "you@company.com" },
    rateLimited: {
      "zh-TW": "嘗試次數太多，請稍後再試。",
      en: "Too many attempts. Please try again later.",
    },
    ssoRequired: {
      "zh-TW": "這個 email 的網域必須使用公司的單一登入（SSO）。請回到登入頁輸入 email，按「繼續」用 SSO 登入。",
      en: "This email's domain must use your company's single sign-on (SSO). Go back to sign in, enter your email and press Continue to sign in with SSO.",
    },
    network: {
      "zh-TW": "連線失敗，請檢查網路後再試一次。",
      en: "Couldn't connect. Check your connection and try again.",
    },
  },
  signup: {
    title: { "zh-TW": "建立帳號", en: "Create an account" },
    description: {
      "zh-TW": "我們會寄一封確認信到你的 email，點信裡的連結就能完成註冊並設定密碼。",
      en: "We'll email you a confirmation link. Click it to finish signing up and set a password.",
    },
    nameLabel: { "zh-TW": "名字", en: "Name" },
    namePlaceholder: { "zh-TW": "王小明", en: "Jane Doe" },
    submit: { "zh-TW": "寄送確認信", en: "Send confirmation email" },
    submitting: { "zh-TW": "寄送中…", en: "Sending…" },
    sent: {
      title: { "zh-TW": "請到信箱收信", en: "Check your inbox" },
      body: {
        "zh-TW": "請到 {email} 收信，連結 15 分鐘內有效。",
        en: "Check {email} for a link. It's valid for 15 minutes.",
      },
      hint: {
        "zh-TW": "沒收到的話，先看一下垃圾郵件匣；同一個 email 一分鐘內只會寄一封。",
        en: "If it doesn't arrive, check your spam folder. We send at most one email per minute to the same address.",
      },
      retry: { "zh-TW": "改用其他 email", en: "Use a different email" },
    },
    haveAccount: { "zh-TW": "已經有帳號？登入", en: "Already have an account? Sign in" },
  },
  forgotPassword: {
    title: { "zh-TW": "忘記密碼", en: "Forgot your password?" },
    description: {
      "zh-TW": "輸入帳號的 email，我們會寄一封重設密碼的信給你。",
      en: "Enter your account's email and we'll send you a link to reset your password.",
    },
    submit: { "zh-TW": "寄送重設連結", en: "Send reset link" },
    submitting: { "zh-TW": "寄送中…", en: "Sending…" },
    sent: {
      title: { "zh-TW": "請到信箱收信", en: "Check your inbox" },
      body: {
        "zh-TW": "如果這個 email 有帳號，會收到重設密碼的信。連結 1 小時內有效。",
        en: "If this email has an account, you'll receive a password reset email. The link is valid for 1 hour.",
      },
    },
  },
  // 重設密碼（/reset-password）與新帳號設定密碼（/signup/password）共用的欄位與檢查訊息。
  passwordForm: {
    password: { "zh-TW": "新密碼", en: "New password" },
    confirm: { "zh-TW": "再輸入一次", en: "Confirm password" },
    hint: { "zh-TW": "至少 {min} 個字元", en: "At least {min} characters" },
    tooShort: { "zh-TW": "密碼至少要 {min} 個字元。", en: "Password must be at least {min} characters." },
    mismatch: { "zh-TW": "兩次輸入的密碼不一樣。", en: "The passwords don't match." },
  },
  resetPassword: {
    title: { "zh-TW": "設定新密碼", en: "Set a new password" },
    description: {
      "zh-TW": "設定完成後，所有裝置上的登入都會被登出。",
      en: "Once it's set, you'll be signed out on every device.",
    },
    submit: { "zh-TW": "更新密碼", en: "Update password" },
    submitting: { "zh-TW": "更新中…", en: "Updating…" },
    failed: { "zh-TW": "更新密碼失敗，請再試一次。", en: "Couldn't update the password. Please try again." },
    invalid: {
      title: { "zh-TW": "連結已失效", en: "This link has expired" },
      body: {
        "zh-TW": "這個重設密碼連結已過期或已經用過。請重新申請一次。",
        en: "This password reset link has expired or has already been used. Please request a new one.",
      },
      action: { "zh-TW": "重新申請重設密碼", en: "Request a new link" },
    },
  },
  setPassword: {
    title: { "zh-TW": "設定登入密碼", en: "Set your password" },
    description: {
      "zh-TW": "帳號已建立。設定一組密碼，之後就能用 email 和密碼登入。",
      en: "Your account is ready. Set a password so you can sign in with your email and password.",
    },
    submit: { "zh-TW": "設定密碼並繼續", en: "Set password and continue" },
    submitting: { "zh-TW": "設定中…", en: "Saving…" },
    failed: { "zh-TW": "設定密碼失敗，請再試一次。", en: "Couldn't set the password. Please try again." },
  },
  // 邀請清單是 onboarding 與側邊欄 user menu 的邀請對話框共用的（元件也是同一個），
  // 所以字串放在 auth.invites 這層，而不是埋在 auth.onboarding 底下。
  invites: {
    title: { "zh-TW": "你收到的邀請", en: "Your invitations" },
    description: { "zh-TW": "接受邀請以加入既有組織", en: "Accept an invitation to join an existing organization" },
    role: { "zh-TW": "身分：{role}", en: "Role: {role}" },
    expiresAt: { "zh-TW": "到期：{date}", en: "Expires {date}" },
    accept: { "zh-TW": "接受", en: "Accept" },
    accepting: { "zh-TW": "加入中…", en: "Joining…" },
    decline: { "zh-TW": "婉拒", en: "Decline" },
    expired: { "zh-TW": "已過期", en: "Expired" },
    expiredHint: { "zh-TW": "這個邀請已過期，請聯絡管理員重新邀請", en: "This invitation has expired — ask an admin to invite you again" },
    empty: { "zh-TW": "目前沒有待處理的邀請", en: "No pending invitations" },
    toast: {
      acceptFailed: { "zh-TW": "接受邀請失敗", en: "Failed to accept invitation" },
      joined: { "zh-TW": "已加入 {name}", en: "Joined {name}" },
      declineFailed: { "zh-TW": "婉拒邀請失敗", en: "Failed to decline invitation" },
      declined: { "zh-TW": "已婉拒 {name} 的邀請", en: "Declined the invitation from {name}" },
    },
  },
  onboarding: {
    loading: { "zh-TW": "載入中…", en: "Loading…" },
    create: {
      title: { "zh-TW": "建立組織", en: "Create an organization" },
      descriptionWithInvites: { "zh-TW": "或建立一個新的組織", en: "Or create a new organization" },
      nameLabel: { "zh-TW": "組織名稱", en: "Organization name" },
      namePlaceholder: { "zh-TW": "我的公司", en: "My company" },
      submit: { "zh-TW": "建立並進入", en: "Create and continue" },
      submitting: { "zh-TW": "建立中…", en: "Creating…" },
      toast: {
        failed: { "zh-TW": "建立組織失敗", en: "Failed to create organization" },
        created: { "zh-TW": "已建立 {name}", en: "Created {name}" },
      },
    },
  },
} satisfies Dictionary;

export default auth;
