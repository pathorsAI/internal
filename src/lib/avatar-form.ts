import { validateAvatarBytes } from "./party-avatar";

export type AvatarFormChange =
  | { kind: "keep" }
  | { kind: "remove" }
  | { kind: "replace"; bytes: Uint8Array };

/**
 * 讀頭像欄位（AvatarUploadField 放進表單的 avatarAction + avatar），並先驗內容。
 * 回傳 error 時是 errors.avatar.<reason> 的 key 尾段。
 */
export async function readAvatarForm(
  formData: FormData,
): Promise<{ change: AvatarFormChange } | { error: "empty" | "tooLarge" | "type" }> {
  const action = formData.get("avatarAction");
  if (action === "remove") return { change: { kind: "remove" } };
  if (action !== "replace") return { change: { kind: "keep" } };
  const file = formData.get("avatar");
  if (!(file instanceof File)) return { error: "empty" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateAvatarBytes(bytes);
  if (!check.ok) return { error: check.reason };
  return { change: { kind: "replace", bytes } };
}
