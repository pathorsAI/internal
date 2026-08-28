import type { Dictionary } from "./dictionary";

const auth = {
  login: {
    title: { "zh-TW": "登入內部管理系統", en: "Sign in to the internal admin system" },
    description: { "zh-TW": "選擇一種方式進入後台", en: "Choose how you want to sign in" },
    signInWithGoogle: { "zh-TW": "使用 Google 登入", en: "Sign in with Google" },
    redirecting: { "zh-TW": "前往 Google…", en: "Redirecting to Google…" },
    or: { "zh-TW": "或", en: "or" },
    sso: {
      button: { "zh-TW": "使用單一登入（SSO）", en: "Continue with SSO" },
      emailLabel: { "zh-TW": "公司 email", en: "Work email" },
      emailPlaceholder: { "zh-TW": "you@company.com", en: "you@company.com" },
      submit: { "zh-TW": "繼續", en: "Continue" },
      submitting: { "zh-TW": "前往識別提供者…", en: "Redirecting to your provider…" },
      cancel: { "zh-TW": "取消", en: "Cancel" },
    },
    password: {
      toggle: { "zh-TW": "改用 email 與密碼登入", en: "Sign in with email and password" },
      emailLabel: { "zh-TW": "Email", en: "Email" },
      emailPlaceholder: { "zh-TW": "you@example.com", en: "you@example.com" },
      passwordLabel: { "zh-TW": "密碼", en: "Password" },
      submit: { "zh-TW": "登入", en: "Sign in" },
      submitting: { "zh-TW": "登入中…", en: "Signing in…" },
      cancel: { "zh-TW": "取消", en: "Cancel" },
    },
    toast: {
      failed: { "zh-TW": "登入失敗", en: "Sign-in failed" },
      // 找不到對應 provider 時故意講「這個網域」而不是「這個帳號不存在」：
      // 後者會變成帳號探測工具。
      ssoNotConfigured: {
        "zh-TW": "這個 email 網域尚未設定單一登入",
        en: "SSO is not configured for this email domain",
      },
      badCredentials: {
        "zh-TW": "email 或密碼不正確",
        en: "Incorrect email or password",
      },
    },
  },
  onboarding: {
    loading: { "zh-TW": "載入中…", en: "Loading…" },
    invites: {
      title: { "zh-TW": "你收到的邀請", en: "Your invitations" },
      description: { "zh-TW": "接受邀請以加入既有組織", en: "Accept an invitation to join an existing organization" },
      role: { "zh-TW": "身分：{role}", en: "Role: {role}" },
      accept: { "zh-TW": "接受", en: "Accept" },
      accepting: { "zh-TW": "加入中…", en: "Joining…" },
      expired: { "zh-TW": "已過期", en: "Expired" },
      expiredHint: { "zh-TW": "這個邀請已過期，請聯絡管理員重新邀請", en: "This invitation has expired — ask an admin to invite you again" },
      toast: {
        acceptFailed: { "zh-TW": "接受邀請失敗", en: "Failed to accept invitation" },
        joined: { "zh-TW": "已加入 {name}", en: "Joined {name}" },
      },
    },
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
