/**
 * 建立 LINE bot 的 rich menu（聊天室下方那排常駐按鈕），設成所有人的預設選單。
 *
 * 版面：public/line/rich-menu.png（2500×843），兩列各三格，左到右、上到下：
 *   說明 ｜ 我的代墊 ｜ 本月支出
 *   切換組織 ｜ 新對話 ｜ 開啟 internal
 * 前五格是 message action（點了等於使用者打那段字，bot 當指令或問題處理），最後一格開網頁。
 *
 * 冪等：先建新的、傳圖、設成預設，成功之後才刪掉其他同名（RICH_MENU_NAME）的舊選單，
 * 所以重跑不會累積、中途失敗也不會讓使用者沒有選單。別的名字的選單不動。
 *
 * 用法：
 *   bun scripts/line-rich-menu.ts --dry-run          # 只印出要建的 JSON，不打 LINE API
 *   LINE_CHANNEL_ACCESS_TOKEN=… bun scripts/line-rich-menu.ts
 *   bun scripts/line-rich-menu.ts --image path/to/menu.png   # 換一張圖
 *
 * token 是 Worker secret 那把 long-lived channel access token（見 docs/chat-channels.md）。
 * 參考：https://developers.line.biz/en/reference/messaging-api/#rich-menu
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

export const RICH_MENU_NAME = "pathors-internal-main";
export const RICH_MENU_WIDTH = 2500;
export const RICH_MENU_HEIGHT = 843;

const LINE_API = "https://api.line.me";
const LINE_DATA_API = "https://api-data.line.me";

type Action = { type: "message"; label: string; text: string } | { type: "uri"; label: string; uri: string };

/** 六格的動作（左到右、上到下）。 */
export const RICH_MENU_ACTIONS: Action[] = [
  { type: "message", label: "說明", text: "說明" },
  { type: "message", label: "我的代墊", text: "我還有哪些代墊沒還？" },
  { type: "message", label: "本月支出", text: "這個月支出多少？" },
  { type: "message", label: "切換組織", text: "切換組織" },
  { type: "message", label: "新對話", text: "新對話" },
  { type: "uri", label: "開啟 internal", uri: "https://internal.pathors.com/dashboard" },
];

/** rich menu 物件：2 列 × 3 欄，邊界整數切齊（欄寬 833／833／834、列高 421／422）。 */
export function richMenuDefinition() {
  const cols = 3;
  const rows = 2;
  const xs = Array.from({ length: cols + 1 }, (_, i) => Math.round((RICH_MENU_WIDTH * i) / cols));
  const ys = Array.from({ length: rows + 1 }, (_, i) => Math.round((RICH_MENU_HEIGHT * i) / rows));
  const areas = RICH_MENU_ACTIONS.map((action, i) => {
    const c = i % cols;
    const r = Math.floor(i / cols);
    return {
      bounds: { x: xs[c], y: ys[r], width: xs[c + 1] - xs[c], height: ys[r + 1] - ys[r] },
      action,
    };
  });
  return {
    size: { width: RICH_MENU_WIDTH, height: RICH_MENU_HEIGHT },
    selected: true,
    name: RICH_MENU_NAME,
    chatBarText: "選單",
    areas,
  };
}

async function line(token: string, method: string, url: string, body?: BodyInit, contentType?: string) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(contentType ? { "Content-Type": contentType } : {}) },
    ...(body === undefined ? {} : { body }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as unknown) : {};
}

async function main() {
  const { values } = parseArgs({
    options: {
      "dry-run": { type: "boolean", default: false },
      image: { type: "string", default: path.join(process.cwd(), "public/line/rich-menu.png") },
    },
  });
  const definition = richMenuDefinition();
  if (values["dry-run"]) {
    console.log(JSON.stringify(definition, null, 2));
    console.log(`\n（dry run：不打 LINE API。圖片會用 ${values.image}）`);
    return;
  }
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("LINE_CHANNEL_ACCESS_TOKEN 沒設。");
  const image = await readFile(values.image);

  // 先驗證定義（LINE 會回具體哪裡不對），再建。
  await line(token, "POST", `${LINE_API}/v2/bot/richmenu/validate`, JSON.stringify(definition), "application/json");
  const { richMenuId } = (await line(
    token,
    "POST",
    `${LINE_API}/v2/bot/richmenu`,
    JSON.stringify(definition),
    "application/json",
  )) as { richMenuId: string };
  console.log(`建好 rich menu ${richMenuId}`);

  await line(token, "POST", `${LINE_DATA_API}/v2/bot/richmenu/${richMenuId}/content`, new Uint8Array(image), "image/png");
  console.log(`上傳圖片 ${values.image}（${image.byteLength} bytes）`);

  await line(token, "POST", `${LINE_API}/v2/bot/user/all/richmenu/${richMenuId}`);
  console.log("設成預設選單");

  const { richmenus = [] } = (await line(token, "GET", `${LINE_API}/v2/bot/richmenu/list`)) as {
    richmenus?: { richMenuId: string; name: string }[];
  };
  for (const old of richmenus) {
    if (old.name !== RICH_MENU_NAME || old.richMenuId === richMenuId) continue;
    await line(token, "DELETE", `${LINE_API}/v2/bot/richmenu/${old.richMenuId}`);
    console.log(`刪掉舊的 ${old.richMenuId}`);
  }
}

if (import.meta.main) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
