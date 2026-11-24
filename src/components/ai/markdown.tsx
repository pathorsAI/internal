import Link from "next/link";
import type { ReactNode } from "react";

/**
 * 模型回覆用的極簡 Markdown：段落、標題（畫成粗體段落）、清單、表格、粗體、行內 code、連結。
 * 全部轉成 React 元素，不用 dangerouslySetInnerHTML，模型寫什麼 HTML 都只會變成純文字。
 * 連結只放行站內的 /dashboard 路徑與 https 網址。
 * 解析刻意用線性掃描而不是正規表示式（Sonar S5852：避免在模型輸出上跑回溯型 pattern）。
 */

export type Block =
  | { type: "p"; text: string }
  | { type: "h"; text: string }
  | { type: "ul" | "ol"; items: string[] }
  | { type: "table"; head: string[]; rows: string[][] }
  | { type: "code"; text: string };

function isBullet(line: string): boolean {
  const t = line.trimStart();
  return t.startsWith("- ") || t.startsWith("* ") || t.startsWith("• ");
}

function orderedItem(line: string): string | null {
  const t = line.trimStart();
  let i = 0;
  while (i < t.length && t[i] >= "0" && t[i] <= "9") i++;
  if (i === 0 || i > 3) return null;
  if ((t[i] === "." || t[i] === ")") && t[i + 1] === " ") return t.slice(i + 2);
  return null;
}

function isTableRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.endsWith("|") && t.length > 1;
}

function isTableSeparator(line: string): boolean {
  const t = line.trim();
  if (!isTableRow(t)) return false;
  for (const ch of t) if (!"|-: ".includes(ch)) return false;
  return t.includes("-");
}

function cells(line: string): string[] {
  return line.trim().slice(1, -1).split("|").map((c) => c.trim());
}

function headingText(line: string): string | null {
  const t = line.trimStart();
  let i = 0;
  while (i < t.length && t[i] === "#") i++;
  if (i === 0 || i > 4 || t[i] !== " ") return null;
  return t.slice(i + 1).trim();
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) blocks.push({ type: "p", text: para.join("\n") });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = headingText(line);
    if (h !== null) {
      flush();
      blocks.push({ type: "h", text: h });
      continue;
    }
    if (isTableRow(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flush();
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      i--;
      blocks.push({ type: "table", head, rows });
      continue;
    }
    if (isBullet(line) || orderedItem(line) !== null) {
      flush();
      const ordered = orderedItem(line) !== null;
      const items: string[] = [];
      while (i < lines.length) {
        const l = lines[i];
        const item = ordered ? orderedItem(l) : isBullet(l) ? l.trimStart().slice(2) : null;
        if (item === null) break;
        items.push(item.trim());
        i++;
      }
      i--;
      blocks.push({ type: ordered ? "ol" : "ul", items });
      continue;
    }
    para.push(line);
  }
  flush();
  return blocks;
}

function safeHref(href: string): { internal: boolean } | null {
  if (href.startsWith("/dashboard") && !href.startsWith("//")) return { internal: true };
  if (href.startsWith("https://")) return { internal: false };
  return null;
}

/** 行內：**粗體**、`code`、[文字](網址)。 */
export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let k = 0;
  const key = () => `${keyPrefix}-${k++}`;
  const flush = () => {
    if (buf) out.push(buf);
    buf = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        out.push(
          <strong key={key()} className="font-semibold">
            {renderInline(text.slice(i + 2, end), key())}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push(
          <code key={key()} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">
            {text.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }
    if (text[i] === "[") {
      const close = text.indexOf("](", i + 1);
      const end = close === -1 ? -1 : text.indexOf(")", close + 2);
      if (close > i && end > close) {
        const label = text.slice(i + 1, close);
        const href = text.slice(close + 2, end).trim();
        const safe = safeHref(href);
        flush();
        if (safe?.internal) {
          out.push(
            <Link key={key()} href={href} className="text-primary underline-offset-2 hover:underline">
              {label}
            </Link>,
          );
        } else if (safe) {
          out.push(
            <a key={key()} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
              {label}
            </a>,
          );
        } else {
          out.push(label);
        }
        i = end + 1;
        continue;
      }
    }
    buf += text[i];
    i++;
  }
  flush();
  return out;
}

const NUMERIC = /^[+\-−]?[\d.,]+%?$|^[+\-−]?(NT\$|US\$|\$)[\d.,]+$/;

export function Markdown({ text }: Readonly<{ text: string }>) {
  const blocks = parseBlocks(text);
  return (
    <div className="space-y-2.5 text-sm leading-6">
      {blocks.map((b, bi) => {
        const k = `b${bi}`;
        switch (b.type) {
          case "h":
            return (
              <p key={k} className="font-semibold">
                {renderInline(b.text, k)}
              </p>
            );
          case "ul":
          case "ol": {
            const List = b.type;
            return (
              <List key={k} className={`space-y-1 pl-5 ${b.type === "ul" ? "list-disc" : "list-decimal"} marker:text-muted-foreground`}>
                {b.items.map((it, ii) => (
                  <li key={`${k}-${ii}`}>{renderInline(it, `${k}-${ii}`)}</li>
                ))}
              </List>
            );
          }
          case "table":
            return (
              <div key={k} className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-xs text-muted-foreground">
                    <tr>
                      {b.head.map((c, ci) => (
                        <th key={`${k}-h${ci}`} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                          {renderInline(c, `${k}-h${ci}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((r, ri) => (
                      <tr key={`${k}-r${ri}`} className="border-t border-border-soft">
                        {r.map((c, ci) => (
                          <td
                            key={`${k}-r${ri}-${ci}`}
                            className={`px-3 py-2 ${NUMERIC.test(c) ? "text-right tabular-nums whitespace-nowrap" : ""}`}
                          >
                            {renderInline(c, `${k}-r${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "code":
            return (
              <pre key={k} className="overflow-x-auto rounded-lg bg-muted px-3 py-2 font-mono text-xs">
                {b.text}
              </pre>
            );
          default:
            return (
              <p key={k} className="whitespace-pre-wrap">
                {renderInline(b.text, k)}
              </p>
            );
        }
      })}
    </div>
  );
}
