import type { Dictionary } from "./dictionary";

const auth = {
  login: {
    title: { "zh-TW": "登入內部管理系統", en: "Sign in to the internal admin system" },
    description: { "zh-TW": "用 Google 帳號進入後台", en: "Sign in with Google to continue" },
    signInWithGoogle: { "zh-TW": "使用 Google 登入", en: "Sign in with Google" },
    redirecting: { "zh-TW": "前往 Google…", en: "Redirecting to Google…" },
    toast: {
      failed: { "zh-TW": "登入失敗", en: "Sign-in failed" },
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
