import { getTranslations } from "next-intl/server";
import { readAvatarForm } from "./avatar-form";
import { ownerAvatarDeps } from "./owner-avatar-deps";
import { removeOwnerAvatar, replaceOwnerAvatar } from "./owner-avatar-store";
import type { OwnerKind } from "./owner-avatar";

export type AvatarActionState = { ok: boolean; error?: string; url?: string | null };

/** 套用表單裡的頭像變更到組織或使用者。權限由呼叫端先檢查。 */
export async function applyOwnerAvatarForm(
  kind: OwnerKind,
  id: string,
  formData: FormData,
): Promise<AvatarActionState> {
  const t = await getTranslations("errors");
  const read = await readAvatarForm(formData);
  if ("error" in read) return { ok: false, error: t(`avatar.${read.error}`) };
  const { change } = read;
  if (change.kind === "keep") return { ok: true };
  try {
    const res =
      change.kind === "remove"
        ? await removeOwnerAvatar(ownerAvatarDeps(), { kind, id })
        : await replaceOwnerAvatar(ownerAvatarDeps(), { kind, id, bytes: change.bytes });
    if (res.ok) return { ok: true, url: res.url };
    return { ok: false, error: res.error === "notFound" ? t("avatar.saveFailed") : t(`avatar.${res.error}`) };
  } catch (e) {
    console.error("[owner-avatar] save failed", e);
    return { ok: false, error: t("avatar.saveFailed") };
  }
}
