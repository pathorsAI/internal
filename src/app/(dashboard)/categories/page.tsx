import { PageHeader } from "@/components/page-header";
import { listCategories } from "@/db/queries";
import { CategoryBoard } from "./category-board";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const categories = await listCategories();
  return (
    <>
      <PageHeader title="分類" description="收入 / 成本 / 費用 科目，用於交易分類與損益表" />
      <CategoryBoard categories={categories} />
    </>
  );
}
