import { redirect } from "next/navigation";

/**
 * 固定支出已經併進廠商計費（migrations/0039）：一個廠商計費帳戶就是一筆固定支出，
 * 排程、這期付了沒都在廠商計費頁的帳戶上。舊網址（書籤、Discord 訊息、AI 回覆裡的連結）導過去。
 */
export default function RecurringExpensesPage(): never {
  redirect("/dashboard/vendor-billing");
}
