import type { Dictionary } from "./dictionary";

/** 個人設定（/dashboard/account）：目前只有頭像。 */
const account = {
  title: { "zh-TW": "個人設定", en: "Your profile" },
  description: { "zh-TW": "你的頭像會顯示在側欄、操作紀錄與 AI 助理", en: "Your picture shows in the sidebar, the activity log and the AI assistant" },
  metaTitle: { "zh-TW": "個人設定 · Internal", en: "Your profile · Internal" },
  profile: {
    title: { "zh-TW": "頭像", en: "Profile picture" },
    description: { "zh-TW": "只有你自己可以更改", en: "Only you can change it" },
    nameLabel: { "zh-TW": "名稱", en: "Name" },
    emailLabel: { "zh-TW": "Email", en: "Email" },
  },
  avatar: {
    choose: { "zh-TW": "上傳頭像", en: "Upload picture" },
    replace: { "zh-TW": "更換", en: "Replace" },
    remove: { "zh-TW": "移除", en: "Remove" },
    undo: { "zh-TW": "復原", en: "Undo" },
    hint: {
      "zh-TW": "PNG、JPEG、WebP，1 MB 以內。可點擊、拖曳或直接貼上（⌘V / Ctrl+V）；會裁成正方形。",
      en: "PNG, JPEG or WebP up to 1 MB. Click, drag & drop, or paste (⌘V / Ctrl+V); it is cropped to a square.",
    },
    processing: { "zh-TW": "處理中…", en: "Processing…" },
    pendingReplace: { "zh-TW": "按「儲存」後套用新頭像", en: "The new picture is applied when you save" },
    pendingRemove: { "zh-TW": "按「儲存」後移除頭像", en: "The picture is removed when you save" },
    errors: {
      empty: { "zh-TW": "這個檔案是空的", en: "That file is empty" },
      type: { "zh-TW": "只支援 PNG、JPEG、WebP 圖片", en: "Only PNG, JPEG and WebP images are supported" },
      tooLarge: { "zh-TW": "圖片超過 1 MB", en: "The image is larger than 1 MB" },
      processFailed: { "zh-TW": "無法讀取這張圖片", en: "Could not read that image" },
    },
  },
  save: { "zh-TW": "儲存", en: "Save" },
  saving: { "zh-TW": "儲存中…", en: "Saving…" },
  toast: {
    updated: { "zh-TW": "已更新頭像", en: "Profile picture updated" },
    removed: { "zh-TW": "已移除頭像", en: "Profile picture removed" },
  },
} satisfies Dictionary;

export default account;
