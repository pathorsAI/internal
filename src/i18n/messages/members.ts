import type { Dictionary } from "./dictionary";

const members = {
  title: { "zh-TW": "成員", en: "Members" },
  description: { "zh-TW": "邀請同事加入這個組織，或管理現有成員", en: "Invite teammates to join this organization, or manage existing members" },
  loading: { "zh-TW": "載入中…", en: "Loading…" },
  role: {
    owner: { "zh-TW": "擁有者", en: "Owner" },
    admin: { "zh-TW": "管理員", en: "Admin" },
    member: { "zh-TW": "成員", en: "Member" },
  },
  invite: {
    title: { "zh-TW": "邀請成員", en: "Invite member" },
    description: { "zh-TW": "用對方的 Google 帳號 email 邀請。對方用同一個 email 登入後即可在進入畫面接受邀請，不需要任何邀請碼。", en: "Invite by their Google account email. After signing in with the same email, they can accept the invitation on the entry screen — no invite code needed." },
    emailLabel: { "zh-TW": "Email", en: "Email" },
    emailPlaceholder: { "zh-TW": "teammate@example.com", en: "teammate@example.com" },
    roleLabel: { "zh-TW": "身分", en: "Role" },
    submit: { "zh-TW": "送出邀請", en: "Send invite" },
    submitting: { "zh-TW": "邀請中…", en: "Inviting…" },
    toast: {
      failed: { "zh-TW": "邀請失敗", en: "Failed to invite" },
      success: { "zh-TW": "已邀請 {email}", en: "Invited {email}" },
    },
  },
  list: {
    title: { "zh-TW": "成員（{count}）", en: "Members ({count})" },
    empty: { "zh-TW": "尚無成員", en: "No members yet" },
    you: { "zh-TW": "（你）", en: " (you)" },
  },
  invitations: {
    title: { "zh-TW": "待接受的邀請（{count}）", en: "Pending invitations ({count})" },
    description: { "zh-TW": "對方用該 email 登入後即可接受", en: "They can accept after signing in with that email" },
    pending: { "zh-TW": "待接受", en: "Pending" },
    expired: { "zh-TW": "已過期", en: "Expired" },
    expiresAt: { "zh-TW": "到期：{date}", en: "Expires: {date}" },
    cancel: { "zh-TW": "取消邀請", en: "Cancel invitation" },
    resend: { "zh-TW": "重新邀請", en: "Resend invitation" },
    toast: {
      failed: { "zh-TW": "取消失敗", en: "Failed to cancel" },
      success: { "zh-TW": "已取消邀請", en: "Invitation canceled" },
      resent: { "zh-TW": "已重新邀請 {email}", en: "Re-invited {email}" },
      resendFailed: { "zh-TW": "重新邀請失敗", en: "Failed to resend invitation" },
    },
  },
  danger: {
    title: { "zh-TW": "危險區域", en: "Danger zone" },
    description: { "zh-TW": "刪除組織會永久移除組織內所有資料，且無法復原。", en: "Deleting the organization permanently removes all of its data and cannot be undone." },
    defaultOrgName: { "zh-TW": "組織", en: "Organization" },
    deleteTrigger: { "zh-TW": "刪除「{name}」", en: "Delete \"{name}\"" },
    deleting: { "zh-TW": "刪除中…", en: "Deleting…" },
    confirmTitle: { "zh-TW": "確定要刪除組織「{name}」嗎？", en: "Delete organization \"{name}\"?" },
    confirmDescription: { "zh-TW": "此動作無法復原，組織內所有資料將一併刪除。", en: "This cannot be undone — all data in the organization will be deleted too." },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    confirm: { "zh-TW": "刪除", en: "Delete" },
    toast: {
      failed: { "zh-TW": "刪除組織失敗", en: "Failed to delete organization" },
      success: { "zh-TW": "已刪除 {name}", en: "Deleted {name}" },
    },
  },
} satisfies Dictionary;

export default members;
