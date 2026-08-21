import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";

type BookKey = "internal" | "external" | "both";

const variantByBook: Record<BookKey, "default" | "secondary" | "outline"> = {
  internal: "secondary",
  external: "default",
  both: "outline",
};

function isBookKey(book: string): book is BookKey {
  return book in variantByBook;
}

export async function BookBadge({ book }: Readonly<{ book: string }>) {
  const t = await getTranslations("common");
  const variant = isBookKey(book) ? variantByBook[book] : "outline";
  const label = isBookKey(book) ? t(`bookBadge.${book}`) : book;
  return <Badge variant={variant}>{label}</Badge>;
}
