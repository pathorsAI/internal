"use server";

import { applyOwnerAvatarForm, type AvatarActionState } from "@/lib/owner-avatar-actions";
import { requireOrg } from "@/lib/session";

/** 換／移除自己的頭像。使用者一律取 session 本人，不收前端傳來的 id。 */
export async function saveMyAvatar(formData: FormData): Promise<AvatarActionState> {
  const { userId } = await requireOrg();
  return applyOwnerAvatarForm("user", userId, formData);
}
