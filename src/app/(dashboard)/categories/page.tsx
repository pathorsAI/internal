import { PageHeader } from "@/components/page-header";
import { listCategories } from "@/db/queries";
import { CategoryBoard } from "./category-board";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const { orgId } = await requireOrg();
  const categories = await listCategories(orgId);
  return (
    <>
      <PageHeader title="分類" description="收入 / 成本 / 費用 科目，用於交易分類與損益表" />
      <CategoryBoard categories={categories} />
    </>
  );
}
