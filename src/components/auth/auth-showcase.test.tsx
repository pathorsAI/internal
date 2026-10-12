import { describe, expect, test } from "bun:test";
import { serverRenderedHtml } from "@/__tests__/server-rendered-forms";
import { AuthShowcase } from "./auth-showcase";

describe("auth showcase", () => {
  const html = serverRenderedHtml(<AuthShowcase />);

  test("one labelled button per slide, the first marked current", () => {
    const buttons = [...html.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>/g)];
    expect(buttons.map((match) => match[1])).toEqual([
      "顯示第 1 張，共 3 張",
      "顯示第 2 張，共 3 張",
      "顯示第 3 張，共 3 張",
    ]);
    expect(buttons.map((match) => match[0].includes('aria-current="true"'))).toEqual([true, false, false]);
  });

  test("only the current slide is exposed to assistive tech", () => {
    // 三張都在 DOM 裡（交叉淡入淡出要用），但不是目前那張的都要 aria-hidden + inert。
    expect(html.match(/aria-hidden="false"/g)).toHaveLength(1);
    expect(html.match(/inert=""/g)).toHaveLength(2);
    expect(html).toContain("項目款項一鍵追蹤");
  });
});
