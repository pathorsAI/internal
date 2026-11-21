import { getTranslations } from "next-intl/server";
import { BookMark, type BookKey } from "@/components/ds/book-mark";

function isBookKey(book: string): book is BookKey {
  return book === "internal" || book === "external" || book === "both";
}

/** 帳別標籤：雙本記號＋文字，淡底。三種帳別靠記號的形狀分，不靠顏色深淺。 */
export async function BookBadge({ book }: Readonly<{ book: string }>) {
  const t = await getTranslations("common");
  const known = isBookKey(book);
  return (
    <span className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border bg-card px-2 py-0.5 text-xs font-medium whitespace-nowrap text-foreground/85">
      {known ? <BookMark book={book} className="size-3" /> : null}
      {known ? t(`bookBadge.${book}`) : book}
    </span>
  );
}
