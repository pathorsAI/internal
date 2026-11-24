import type { Dictionary } from "./dictionary";

/**
 * 頭像欄位（AvatarUploadField）的字串，組織 logo 與個人頭像共用，只差「什麼東西」與存檔按鈕的名字。
 * 交易對象的版本在 parties.ts（按鈕叫「儲存變更」、英文叫 logo），保留原樣。
 */
export function avatarFieldStrings(subject: { "zh-TW": string; en: string }) {
  return {
    choose: { "zh-TW": `上傳${subject["zh-TW"]}`, en: `Upload ${subject.en}` },
    replace: { "zh-TW": "更換", en: "Replace" },
    remove: { "zh-TW": "移除", en: "Remove" },
    undo: { "zh-TW": "復原", en: "Undo" },
    hint: {
      "zh-TW": "PNG、JPEG、WebP，1 MB 以內。可點擊、拖曳或直接貼上（⌘V / Ctrl+V）；會裁成正方形。",
      en: "PNG, JPEG or WebP up to 1 MB. Click, drag & drop, or paste (⌘V / Ctrl+V); it is cropped to a square.",
    },
    processing: { "zh-TW": "處理中…", en: "Processing…" },
    pendingReplace: { "zh-TW": `按「儲存」後套用新${subject["zh-TW"]}`, en: `The new ${subject.en} is applied when you save` },
    pendingRemove: { "zh-TW": `按「儲存」後移除${subject["zh-TW"]}`, en: `The ${subject.en} is removed when you save` },
    errors: {
      empty: { "zh-TW": "這個檔案是空的", en: "That file is empty" },
      type: { "zh-TW": "只支援 PNG、JPEG、WebP 圖片", en: "Only PNG, JPEG and WebP images are supported" },
      tooLarge: { "zh-TW": "圖片超過 1 MB", en: "The image is larger than 1 MB" },
      processFailed: { "zh-TW": "無法讀取這張圖片", en: "Could not read that image" },
    },
  } satisfies Dictionary;
}
