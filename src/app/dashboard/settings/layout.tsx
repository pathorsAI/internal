import { SettingsNav } from "./settings-nav";

/**
 * 設定區的外框：左邊一條次級導覽（基本資料 / 整合 / MCP），右邊是各分頁自己的內容。
 * 窄螢幕時導覽改成頂端一排可橫向捲動的分頁，不佔垂直空間。
 */
export default function SettingsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-w-0 flex-col gap-6 md:flex-row md:items-start">
      <SettingsNav />
      <div className="flex min-w-0 flex-1 flex-col gap-6">{children}</div>
    </div>
  );
}
