import { describe, expect, test } from "bun:test";
import type { ChatEvent, UiToolCall } from "@/lib/ai/types";
import {
  argRows,
  batchCard,
  cardToText,
  collectTurn,
  markdownToChat,
  maskAccountNumbers,
  maskTail,
  replyToChat,
  toConfirmCard,
  MAX_CARD_ROWS,
} from "./render";
import { parseBindCommand, parseCommand } from "./strings";

const BASE = "https://internal.pathors.com";

describe("markdownToChat", () => {
  test("去粗體、標題、列點、inline code", () => {
    const out = markdownToChat("## 結果\n**3 筆**代墊\n- 第一筆 `#12`\n- 第二筆", BASE);
    expect(out).toBe("結果\n3 筆代墊\n・第一筆 #12\n・第二筆");
  });

  test("表格轉「欄：值」，列之間空一行", () => {
    const md = "| 日期 | 金額 |\n|---|---:|\n| 11/24 | 1,860 |\n| 11/25 | 2,460 |";
    expect(markdownToChat(md, BASE)).toBe("日期：11/24\n金額：1,860\n\n日期：11/25\n金額：2,460");
  });

  test("站內連結轉絕對網址", () => {
    expect(markdownToChat("到[交易頁](/dashboard/transactions?x=1)看", BASE)).toBe(
      `到交易頁：${BASE}/dashboard/transactions?x=1 看`,
    );
    expect(markdownToChat("[https://a.b/c](https://a.b/c)", BASE)).toBe("https://a.b/c");
  });

  test("網址後面緊接中文時補空白（不然聊天 app 會把中文算進網址）", () => {
    expect(markdownToChat("可至[代墊](/dashboard/advances)查看。", BASE)).toBe(`可至代墊：${BASE}/dashboard/advances 查看。`);
    expect(markdownToChat("看 https://a.b/c，或 https://a.b/d", BASE)).toBe("看 https://a.b/c ，或 https://a.b/d");
  });

  test("截長度", () => {
    const out = markdownToChat("字".repeat(100), BASE, 10);
    expect(out.length).toBe(10);
    expect(out.endsWith("…")).toBe(true);
  });

  test("長串帳號遮成末四碼，統編與日期不動", () => {
    expect(maskAccountNumbers("帳號 0123-4567-8901-2345，統編 12345678，2026-11-25")).toBe(
      "帳號 •••• 2345，統編 12345678，2026-11-25",
    );
    expect(maskTail("808-123456789")).toBe("•••• 6789");
    expect(maskTail("ABC")).toBe("ABC");
  });
});

describe("replyToChat", () => {
  test("[[選項：…]] 拆成 quick reply", () => {
    const r = replyToChat("這筆是誰付的？\n[[選項：我先墊的|公司信用卡|公司帳戶]]", BASE);
    expect(r.text).toBe("這筆是誰付的？");
    expect(r.quickReplies.map((q) => q.text)).toEqual(["我先墊的", "公司信用卡", "公司帳戶"]);
  });
});

describe("collectTurn", () => {
  test("每輪文字分開、pending 卡片、按完的結果、錯誤", () => {
    const pending: UiToolCall = { id: "t1", name: "submit_advance", status: "pending", level: "write", args: {} };
    const events: ChatEvent[] = [
      { t: "conv", id: "c1", title: "x" },
      { t: "msg", id: "r0" },
      { t: "text", d: "我查" },
      { t: "text", d: "一下" },
      { t: "tool", call: { id: "r1", name: "list_parties", status: "running", level: "read" } },
      { t: "tool_done", id: "r1", status: "ok" },
      { t: "msg", id: "r1" },
      { t: "text", d: "請確認" },
      { t: "tool", call: pending },
      { t: "error", code: "too_many_rounds" },
    ];
    const out = collectTurn(events);
    expect(out.conversationId).toBe("c1");
    expect(out.texts).toEqual(["我查一下", "請確認"]);
    expect(out.pending.map((p) => p.id)).toEqual(["t1"]);
    expect(out.results).toEqual([{ id: "r1", status: "ok" }]);
    expect(out.error).toBe("too_many_rounds");
  });

  test("按完的卡不再算 pending", () => {
    const out = collectTurn([
      { t: "tool", call: { id: "t1", name: "x", status: "pending", level: "write" } },
      { t: "tool_done", id: "t1", status: "running" },
      { t: "tool_done", id: "t1", status: "ok" },
    ]);
    expect(out.pending).toEqual([]);
    expect(out.results).toEqual([{ id: "t1", status: "ok" }]);
  });
});

describe("確認卡", () => {
  const call: UiToolCall = {
    id: "t1",
    name: "submit_advance",
    status: "pending",
    level: "write",
    summary: "提交代墊 11/24 餐敘 NT$1,860",
    args: {
      date: "2026-11-24",
      amount: 1860,
      currency: "TWD",
      partyName: "某餐廳",
      docKind: "receipt",
      documentIds: [12],
      accountNumber: "0123456789012",
    },
    ruleHint: "依規則：某餐廳 → 交際費",
  };

  test("參數轉中文標籤、金額併幣別、帳號遮末四碼", () => {
    const rows = argRows(call.args!, "zh-TW");
    expect(rows).toEqual([
      { label: "日期", value: "2026-11-24" },
      { label: "金額", value: "TWD 1,860" },
      { label: "對象", value: "某餐廳" },
      { label: "憑證種類", value: "收據" },
      { label: "附件", value: "#12" },
      { label: "帳號", value: "•••• 9012" },
    ]);
  });

  test("卡片帶組織、操作人、規則提示", () => {
    const card = toConfirmCard(call, { cardId: "abc123defg", orgName: "派斯科技", actorName: "Tiger", locale: "zh-TW" });
    expect(card).toMatchObject({
      cardId: "abc123defg",
      title: "提交代墊 11/24 餐敘 NT$1,860",
      orgName: "派斯科技",
      actorName: "Tiger",
      ruleHint: "依規則：某餐廳 → 交際費",
      actions: ["confirm", "edit", "cancel"],
    });
    expect(cardToText(card, "zh-TW")).toContain("規則：依規則：某餐廳 → 交際費");
  });

  test("沒有 summary 用工具名稱", () => {
    const card = toConfirmCard({ ...call, summary: undefined }, { cardId: "x", orgName: "", actorName: "", locale: "zh-TW" });
    expect(card.title).toBe("提交代墊");
  });

  test("欄位太多只列前幾個", () => {
    const args = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    const rows = argRows(args, "zh-TW");
    expect(rows.length).toBe(MAX_CARD_ROWS);
    expect(rows.at(-1)?.value).toContain("19");
  });

  test("批次卡只有全部確認", () => {
    const cards = [1, 2, 3].map((i) =>
      toConfirmCard({ ...call, id: `t${i}` }, { cardId: `c${i}`, orgName: "o", actorName: "a", locale: "zh-TW" }),
    );
    const b = batchCard(cards, { cardId: "b1", orgName: "o", actorName: "a", locale: "zh-TW" });
    expect(b.actions).toEqual(["all"]);
    expect(b.confirmLabel).toBe("全部確認（3 筆）");
    expect(b.rows.length).toBe(3);
  });
});

describe("指令", () => {
  test("綁定碼：全形空白、無空白、全形數字、冒號", () => {
    expect(parseBindCommand("綁定 123456")).toBe("123456");
    expect(parseBindCommand("綁定　123456")).toBe("123456");
    expect(parseBindCommand("綁定123456")).toBe("123456");
    expect(parseBindCommand("綁定：１２３４５６")).toBe("123456");
    expect(parseBindCommand(" bind 123456 ")).toBe("123456");
    expect(parseBindCommand("綁定 12345")).toBeNull();
    expect(parseBindCommand("請幫我綁定 123456")).toBeNull();
  });

  test("整則就是指令才算", () => {
    expect(parseCommand("切換組織")).toEqual({ kind: "switchOrg" });
    expect(parseCommand("新對話")).toEqual({ kind: "newConversation" });
    expect(parseCommand("解除綁定")).toEqual({ kind: "unlink" });
    expect(parseCommand("說明")).toEqual({ kind: "help" });
    expect(parseCommand("Help")).toEqual({ kind: "help" });
    expect(parseCommand("幫我切換組織到派斯")).toBeNull();
  });
});

/** 跑一次並回傳毫秒數。 */
function timed(fn: () => unknown): number {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

describe("regex 邊界與惡意長輸入（不能超線性回溯）", () => {
  const N = 20_000;
  /** 線性的實作在這個長度是幾十毫秒；改寫前的 regex 同樣輸入要 3–47 秒。上限放寬避免 CI 機器慢誤報。 */
  const LIMIT_MS = 1000;

  test("表格分隔線：各種寫法", () => {
    const table = (sep: string) => markdownToChat(`| a | b |\n${sep}\n| 1 | 2 |`, BASE, 100_000);
    expect(table("|---|---|")).toBe("a：1\nb：2");
    expect(table("| :--- | ---: |")).toBe("a：1\nb：2");
    expect(table("---|---")).toBe("a：1\nb：2");
    expect(table(":--:|--")).toBe("a：1\nb：2");
    // 不是分隔線：只有一個 -、空格子、雙直線，原樣保留
    expect(table("|-|-|")).toBe("| a | b |\n|-|-|\n| 1 | 2 |");
    expect(table("|---||---|")).toBe("| a | b |\n|---||---|\n| 1 | 2 |");
    expect(table("||")).toBe("| a | b |\n||\n| 1 | 2 |");
  });

  test("表格分隔線：很長的惡意輸入", () => {
    const evil = `| a |\n|${"--- ".repeat(N)}x`;
    expect(timed(() => markdownToChat(evil, BASE, 10))).toBeLessThan(LIMIT_MS);
    const evil2 = `| a |\n${"|--".repeat(N)}|x`;
    expect(timed(() => markdownToChat(evil2, BASE, 10))).toBeLessThan(LIMIT_MS);
  });

  test("連結：標題、圖片、空字、未收尾", () => {
    expect(markdownToChat('[說明](/a "標題")', BASE)).toBe(`說明：${BASE}/a`);
    expect(markdownToChat("![](/img.png)", BASE)).toBe(`${BASE}/img.png`);
    expect(markdownToChat("a[b](c d)e", BASE)).toBe("a[b](c d)e");
    expect(markdownToChat("[a [b](/x)", BASE)).toBe(`a [b：${BASE}/x`);
    expect(markdownToChat("[x](/a) [y](/b)", BASE)).toBe(`x：${BASE}/a y：${BASE}/b`);
    expect(markdownToChat("[未收尾 [x](", BASE)).toBe("[未收尾 [x](");
  });

  test("連結：很長的惡意輸入", () => {
    for (const evil of ["[".repeat(N), `${"[".repeat(N)}]`, "[](".repeat(N), `[a](${"b".repeat(N)} "${"c".repeat(N)}`, "![".repeat(N)]) {
      expect(timed(() => markdownToChat(evil, BASE, 10))).toBeLessThan(LIMIT_MS);
    }
  });

  test("行尾空白：很長的空白後面不是換行", () => {
    expect(markdownToChat("a \t \nb", BASE)).toBe("a\nb");
    const evil = `${" ".repeat(N)}x`;
    expect(timed(() => markdownToChat(evil, BASE, 10))).toBeLessThan(LIMIT_MS);
    const evil2 = `${"\t \t".repeat(N)}x\n`;
    expect(timed(() => markdownToChat(evil2, BASE, 10))).toBeLessThan(LIMIT_MS);
  });

  test("網址後補空白：很多網址接在一起", () => {
    expect(markdownToChat("http://a.b/http://c.d查", BASE)).toBe("http://a.b/http://c.d 查");
    const evil = "http://".repeat(N);
    expect(timed(() => markdownToChat(evil, BASE, 10))).toBeLessThan(LIMIT_MS);
  });

  test("綁定碼：很長的空白與冒號", () => {
    expect(parseBindCommand("綁定 : 123456")).toBe("123456");
    expect(parseBindCommand("綁定 :: 123456")).toBeNull();
    const evil = `綁定${" ".repeat(N)}：${" ".repeat(N)}12345x`;
    expect(timed(() => parseBindCommand(evil))).toBeLessThan(LIMIT_MS);
    expect(parseBindCommand(evil)).toBeNull();
  });
});
