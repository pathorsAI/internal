/**
 * LANDING_HTML 是一份字串模板：所有人看得到的文字都寫成 `{{hero.lede}}` 這種佔位符，
 * 實際字串在 src/i18n/messages/landing.ts。這裡負責把兩者兜起來。
 *
 * 三個刻意的選擇：
 *  - **代入的值一律 escape。** 字典是我們自己寫的沒錯，但「模板 + 不逃脫」是等著被踩的
 *    地雷 —— 哪天有人把一段含 `<` 的說明文字寫進字典，或把佔位符放進屬性裡，就中了。
 *  - **不用正規表示式解析。** `split("{{")` 是線性的，沒有回溯風險（Sonar S5852），
 *    也不必為了 `{{`／`}}` 去想 regex 的跳脫。
 *  - **漏翻就丟例外。** 靜靜留下 `{{…}}` 或空字串等於把錯誤推到 production 才被看見；
 *    這裡直接爆掉，開發時就會發現。
 */

/** 巢狀的翻譯樹，葉子是單一語系的字串（即 `Localized<typeof landing>` 的形狀）。 */
export type LandingStrings = {
  readonly [key: string]: string | LandingStrings;
};

/** HTML escape。屬性值也走這裡，所以 `"` 與 `'` 都要處理。 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 依 `a.b.c` 取值，取不到（或取到的不是字串）就丟例外。 */
function lookup(strings: LandingStrings, path: string): string {
  let node: unknown = strings;
  for (const part of path.split(".")) {
    node =
      typeof node === "object" && node !== null
        ? (node as Record<string, unknown>)[part]
        : undefined;
  }
  if (typeof node !== "string") {
    throw new TypeError(`landing: 字典裡沒有 "${path}" 這個 key（或它不是字串）`);
  }
  return node;
}

const OPEN = "{{";
const CLOSE = "}}";

/** 把模板裡的 `{{key}}` 換成字典的值（經過 escape）。 */
export function renderLandingTemplate(
  template: string,
  strings: LandingStrings,
): string {
  const chunks = template.split(OPEN);
  let out = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    const end = chunk.indexOf(CLOSE);
    if (end === -1) {
      throw new Error(`landing: 模板有沒關起來的 "${OPEN}"：${chunk.slice(0, 40)}`);
    }
    out += escapeHtml(lookup(strings, chunk.slice(0, end)));
    out += chunk.slice(end + CLOSE.length);
  }
  return out;
}
