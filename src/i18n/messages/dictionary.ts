import { defaultLocale, type Locale } from "../config";

/**
 * 一則翻譯：每個語系都要有，少一個就編不過。
 *
 * 兩種語言寫在同一個 key 上（而不是兩棵平行的樹）有兩個好處：漏翻在原地就看得見，
 * 而且不會有「結構完全相同、只有值不同」的兩份檔案 —— 那種對照表對複製貼上偵測
 * 來說就是大片重複。
 */
export type Leaf = Record<Locale, string>;

export type Dictionary = { [key: string]: Leaf | Dictionary };

/** 交給 next-intl 的形狀：同一棵樹，葉子換成單一語系的字串。 */
export type Localized<T> = T extends Leaf
  ? string
  : { [K in keyof T]: Localized<T[K]> };

function isLeaf(value: Leaf | Dictionary): value is Leaf {
  return typeof (value as Leaf)[defaultLocale] === "string";
}

/** 把雙語字典壓成單一語系的訊息樹。 */
export function localize<T extends Dictionary>(tree: T, locale: Locale): Localized<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(tree)) {
    out[key] = isLeaf(value) ? value[locale] : localize(value, locale);
  }
  return out as Localized<T>;
}
