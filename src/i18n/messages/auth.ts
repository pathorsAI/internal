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
      submit: { "zh-TW": "登入", en: "Sign in" },
      submitting: { "zh-TW": "登入中…", en: "Signing in…" },
    },
    toast: {
      failed: { "zh-TW": "登入失敗", en: "Sign-in failed" },
      badCredentials: {
        "zh-TW": "email 或密碼不正確",
        en: "Incorrect email or password",
      },
    },
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
