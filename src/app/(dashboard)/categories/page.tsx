import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { listCategories } from "@/db/queries";
import { CategoryBoard } from "./category-board";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const t = await getTranslations("categories");
  const { orgId } = await requireOrg();
  const categories = await listCategories(orgId);
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <CategoryBoard categories={categories} />
    </>
  );
}
