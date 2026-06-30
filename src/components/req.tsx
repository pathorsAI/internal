/**
 * 必填欄位的紅色星號標記。
 *
 * 放在 `components/ui` 之外，讓 `components/ui` 維持原廠 shadcn、可持續用 CLI 更新。
 * 用法：<Label>金額<Req /></Label>
 */
export function Req() {
  return (
    <span aria-hidden className="text-destructive">
      *
    </span>
  );
}
