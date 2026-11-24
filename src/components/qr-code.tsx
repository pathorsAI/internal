import qrcode from "qrcode-generator";

/**
 * QR code（SVG）：用 qrcode-generator（無依賴、MIT）算出模組，自己畫成一條 path。
 * 掃描需要「淺底深點」，所以底色與點的顏色寫死在 SVG 裡（不跟深色主題變），
 * 這是功能性的圖，不是版面配色。
 */
export function qrModules(text: string): boolean[][] {
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
}

/** 模組 → SVG path（每列連續的深色格併成一段，path 短很多）。 */
export function qrPath(modules: readonly (readonly boolean[])[], margin: number): string {
  const parts: string[] = [];
  modules.forEach((row, r) => {
    let c = 0;
    while (c < row.length) {
      if (!row[c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < row.length && row[c]) c++;
      parts.push(`M${start + margin} ${r + margin}h${c - start}v1h-${c - start}z`);
    }
  });
  return parts.join("");
}

export function QrCode({
  value,
  size = 176,
  label,
  className,
}: Readonly<{ value: string; size?: number; label: string; className?: string }>) {
  const modules = qrModules(value);
  const margin = 2;
  const dim = modules.length + margin * 2;
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${dim} ${dim}`}
      shapeRendering="crispEdges"
      className={className}
    >
      <rect width={dim} height={dim} rx={1} fill="#fff" />
      <path d={qrPath(modules, margin)} fill="#111" />
    </svg>
  );
}
