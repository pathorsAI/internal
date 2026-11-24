"use server";

import { getTranslations } from "next-intl/server";
import { applyOwnerAvatarForm, type AvatarActionState } from "@/lib/owner-avatar-actions";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";

/**
 * 換／移除目前組織的 logo。組織一律取 session 的目前組織，不收前端傳來的 id；
 * 只有 owner／admin 能改（隱藏按鈕擋得住誤按，擋不住直接呼叫 action，所以這裡再檢查一次）。
 */
export async function saveOrgLogo(formData: FormData): Promise<AvatarActionState> {
  const { orgId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) {
    const t = await getTranslations("errors");
    return { ok: false, error: t("avatar.forbidden") };
  }
  return applyOwnerAvatarForm("org", orgId, formData);
}
