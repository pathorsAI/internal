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

/** 讀到一個區塊後回傳區塊本身與下一行的位置。 */
type Read = { block: Block; next: number };

/** ``` 圍起來的程式碼區塊；沒有收尾的 ``` 就吃到結尾。 */
function readCodeBlock(lines: string[], start: number): Read {
  const code: string[] = [];
  let i = start + 1;
  while (i < lines.length && !lines[i].trim().startsWith("```")) code.push(lines[i++]);
  return { block: { type: "code", text: code.join("\n") }, next: i + 1 };
}

/** 表格要有表頭列加分隔列才算，否則回 null 讓它當一般段落。 */
function readTable(lines: string[], start: number): Read | null {
  if (!isTableRow(lines[start]) || start + 1 >= lines.length || !isTableSeparator(lines[start + 1])) return null;
  const head = cells(lines[start]);
  const rows: string[][] = [];
  let i = start + 2;
  while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
  return { block: { type: "table", head, rows }, next: i };
}

function bulletItem(line: string): string | null {
  return isBullet(line) ? line.trimStart().slice(2) : null;
}

/** 連續的清單項目；第一行決定是有序還是無序，遇到不同種類就停。 */
function readList(lines: string[], start: number): Read | null {
  const ordered = orderedItem(lines[start]) !== null;
  if (!ordered && !isBullet(lines[start])) return null;
  const itemOf = ordered ? orderedItem : bulletItem;
  const items: string[] = [];
  let i = start;
  while (i < lines.length) {
    const item = itemOf(lines[i]);
    if (item === null) break;
    items.push(item.trim());
    i++;
  }
  return { block: { type: ordered ? "ol" : "ul", items }, next: i };
}

/** 標題、表格、清單其中之一；都不是就回 null。 */
function readStructured(lines: string[], start: number): Read | null {
  const h = headingText(lines[start]);
  if (h !== null) return { block: { type: "h", text: h }, next: start + 1 };
  return readTable(lines, start) ?? readList(lines, start);
}

export function parseBlocks(src: string): Block[] {
  const lines = src.replaceAll("\r\n", "\n").split("\n");
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) blocks.push({ type: "p", text: para.join("\n") });
    para = [];
  };
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const read = line.trim().startsWith("```") ? readCodeBlock(lines, i) : readStructured(lines, i);
    if (read) {
      flush();
      blocks.push(read.block);
      i = read.next;
      continue;
    }
    para.push(line);
    i++;
  }
  flush();
  return blocks;
}

function safeHref(href: string): { internal: boolean } | null {
  if (href.startsWith("/dashboard") && !href.startsWith("//")) return { internal: true };
  if (href.startsWith("https://")) return { internal: false };
  return null;
}

/** 行內片段：渲染好的節點與片段結束後的位置；不成立就回 null，交給下一種規則或當純文字。 */
type Inline = { node: ReactNode; end: number };

function readBold(text: string, i: number, key: () => string): Inline | null {
  if (!text.startsWith("**", i)) return null;
  const end = text.indexOf("**", i + 2);
  if (end <= i + 2) return null;
  return {
    node: (
      <strong key={key()} className="font-semibold">
        {renderInline(text.slice(i + 2, end), key())}
      </strong>
    ),
    end: end + 2,
  };
}

function readCode(text: string, i: number, key: () => string): Inline | null {
  if (text[i] !== "`") return null;
  const end = text.indexOf("`", i + 1);
  if (end <= i + 1) return null;
  return {
    node: (
      <code key={key()} className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.85em]">
        {text.slice(i + 1, end)}
      </code>
    ),
    end: end + 1,
  };
}

function linkNode(label: string, href: string, key: string): ReactNode {
  const safe = safeHref(href);
  if (!safe) return label;
  if (safe.internal) {
    return (
      <Link key={key} href={href} className="text-primary underline-offset-2 hover:underline">
        {label}
      </Link>
    );
  }
  return (
    <a key={key} href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">
      {label}
    </a>
  );
}

function readLink(text: string, i: number, key: () => string): Inline | null {
  if (text[i] !== "[") return null;
  const close = text.indexOf("](", i + 1);
  const end = close === -1 ? -1 : text.indexOf(")", close + 2);
  if (close <= i || end <= close) return null;
  const label = text.slice(i + 1, close);
  const href = text.slice(close + 2, end).trim();
  return { node: linkNode(label, href, key()), end: end + 1 };
}

/** 行內：**粗體**、`code`、[文字](網址)。 */
export function renderInline(text: string, keyPrefix = "i"): ReactNode[] {
  const out: ReactNode[] = [];
  let buf = "";
  let k = 0;
  const key = () => `${keyPrefix}-${k++}`;
  let i = 0;
  while (i < text.length) {
    const hit = readBold(text, i, key) ?? readCode(text, i, key) ?? readLink(text, i, key);
    if (hit) {
      if (buf) out.push(buf);
      buf = "";
      out.push(hit.node);
      i = hit.end;
      continue;
    }
    buf += text[i];
    i++;
  }
  if (buf) out.push(buf);
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
