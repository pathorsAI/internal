import { describe, expect, test } from "bun:test";

import { locales } from "@/i18n/config";
import { localize, type Dictionary } from "@/i18n/messages/dictionary";
import landing from "@/i18n/messages/landing";

import { LANDING_HTML } from "./landing-content";
import { renderLandingTemplate } from "./landing-template";

/** 模板裡出現過的 `{{key}}`。 */
function placeholders(template: string): Set<string> {
  const keys = new Set<string>();
  for (const chunk of template.split("{{").slice(1)) {
    keys.add(chunk.slice(0, chunk.indexOf("}}")));
  }
  return keys;
}

/** 字典的每一個葉子路徑（`books.heading` …）與它的雙語值。 */
function leaves(tree: Dictionary, prefix = ""): [string, Record<string, string>][] {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof (value as Record<string, unknown>)["zh-TW"] === "string"
      ? [[path, value as Record<string, string>] as [string, Record<string, string>]]
      : leaves(value as Dictionary, path);
  });
}

/** 不經過模板、由 page.tsx / landing-nav.tsx 直接取用的區塊。 */
const USED_OUTSIDE_TEMPLATE = ["meta.", "cta.", "nav."];

describe("landing template", () => {
  test.each([...locales])("每個佔位符在 %s 都代得進去", (locale) => {
    const html = renderLandingTemplate(LANDING_HTML, localize(landing, locale));
    expect(html).not.toContain("{{");
    expect(html).not.toContain("}}");
  });

  test("字典裡沒有被遺忘的文案", () => {
    const used = placeholders(LANDING_HTML);
    const orphans = leaves(landing)
      .map(([path]) => path)
      .filter((path) => !used.has(path))
      .filter((path) => !USED_OUTSIDE_TEMPLATE.some((p) => path.startsWith(p)));
    expect(orphans).toEqual([]);
  });

  test("字典的值不放 HTML 標記（會被 escape 成字面文字）", () => {
    const withMarkup = leaves(landing)
      .filter(([, value]) => Object.values(value).some((text) => /[<>]/.test(text)))
      .map(([path]) => path);
    expect(withMarkup).toEqual([]);
  });

  test("「其他」區塊是 12 格", () => {
    const more = LANDING_HTML.slice(
      LANDING_HTML.indexOf('<section id="more">'),
      LANDING_HTML.indexOf('<section id="end">'),
    );
    expect(more.match(/class="tile rv"/g)?.length).toBe(12);
  });
});
