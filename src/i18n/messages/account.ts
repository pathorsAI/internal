import { avatarFieldStrings } from "./avatar-field";
import type { Dictionary } from "./dictionary";

/** 個人設定（/dashboard/account）：目前只有頭像。 */
const account = {
  title: { "zh-TW": "個人設定", en: "Your profile" },
  metaTitle: { "zh-TW": "個人設定 · Internal", en: "Your profile · Internal" },
  profile: {
    title: { "zh-TW": "頭像", en: "Profile picture" },
    nameLabel: { "zh-TW": "名稱", en: "Name" },
    emailLabel: { "zh-TW": "Email", en: "Email" },
  },
  avatar: avatarFieldStrings({ "zh-TW": "頭像", en: "picture" }),
  save: { "zh-TW": "儲存", en: "Save" },
  saving: { "zh-TW": "儲存中…", en: "Saving…" },
  toast: {
    updated: { "zh-TW": "已更新頭像", en: "Profile picture updated" },
    removed: { "zh-TW": "已移除頭像", en: "Profile picture removed" },
  },
} satisfies Dictionary;

export default account;
