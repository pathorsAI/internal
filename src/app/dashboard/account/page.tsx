import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireOrg } from "@/lib/session";
import { AccountClient } from "./account-client";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("account");
  return { title: t("metaTitle") };
}

/** 個人設定：從左下角使用者選單進來。目前只有頭像，只能改自己的。 */
export default async function AccountPage() {
  const t = await getTranslations("account");
  const { session } = await requireOrg();
  const u = session.user;
  return (
    <>
      <PageHeader title={t("title")} />
      <AccountClient name={u.name} email={u.email} image={u.image ?? null} />
    </>
  );
}
