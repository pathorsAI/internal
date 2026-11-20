/**
 * 設定區的外框只是透傳：頁首（<PageHeader>）必須是頁面的第一個元素才能貼齊內容區，
 * 所以次級導覽（基本資料 / 整合 / MCP）改由各分頁在頁首下方用 <SettingsBody> 包起來。
 */
export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
