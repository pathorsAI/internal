import { parseOptions } from "@/lib/ai/options";

/**
 * 回覆裡的快速選項標記 `[[選項：A|B]]`：拆成文字＋選項。串流中標記還沒寫完時
 * （有 `[[` 但還沒 `]]`），先把那段藏起來，不讓半個標記閃一下。
 */
export function splitOptions(raw: string, streaming: boolean): { text: string; options: string[] } {
  let source = raw;
  if (streaming) {
    const open = source.lastIndexOf("[[");
    if (open !== -1 && !source.includes("]]", open)) source = source.slice(0, open);
  }
  return parseOptions(source);
}
