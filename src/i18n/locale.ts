import { cookies, headers } from "next/headers";
import { defaultLocale, isLocale, locales, LOCALE_COOKIE, type Locale } from "./config";

/**
 * 從 `Accept-Language` 挑一個我們支援的語系。
 *
 * 只看語言標籤的前綴，因為瀏覽器送來的東西五花八門：`zh-TW`、`zh-Hant`、`zh-Hant-HK`、
 * 單純的 `zh`、以及帶 `;q=` 權重的清單。這裡照 header 給的順序找第一個對得上的，
 * 不去解析 q 值 —— 瀏覽器本來就是按偏好順序排的，為了 q 值多寫一個排序器，
 * 換來的正確性差異在只有兩種語言的情況下是零。
 *
 * 中文一律給 zh-TW（我們只出繁體）。都對不上就給英文，而不是 defaultLocale ——
 * 一個日文或西班牙文的瀏覽器，看得懂英文的機率遠高於看得懂繁體中文。
 *
 * 刻意不用正規表示式：帶量詞的 pattern 跑在使用者可控的 header 上，是典型的
 * ReDoS 面（Sonar S5852）。線性掃描一樣清楚。
 */
function negotiate(acceptLanguage: string | null): Locale {
  if (!acceptLanguage) return defaultLocale;
  for (const part of acceptLanguage.split(",")) {
    const tag = part.split(";")[0].trim().toLowerCase();
    if (!tag) continue;
    if (tag === "*") return defaultLocale;
    if (tag.startsWith("zh")) return "zh-TW";
    const exact = locales.find((l) => l.toLowerCase() === tag);
    if (exact) return exact;
    const prefix = locales.find((l) => tag.startsWith(l.toLowerCase() + "-"));
    if (prefix) return prefix;
    if (tag.startsWith("en")) return "en";
  }
  return "en";
}

/**
 * 這個請求要用哪個語系。
 *
 * 使用者自己選過就一律聽他的（cookie，由 setUserLocale 寫入）。沒選過的第一次
 * 造訪就依瀏覽器的 Accept-Language 判斷 —— landing 是公開頁面，訪客可能來自任何
 * 地方，先給一個他讀得懂的版本比先給預設值合理。
 *
 * 語系放在 cookie 而不是網址，所以每一條既有路由（含 auth callback 與公開的 /mcp）
 * 都不必多一段 locale prefix。
 *
 * 注意：這裡刻意**不寫 cookie**。server component 不允許寫 cookie，而為了持久化
 * 去 middleware 攔一層，換來的只是省下一次 header 解析 —— 這個判斷是純函式且沒有
 * 副作用，每次算一次的成本可以忽略。使用者一旦真的按了語言切換，才會落 cookie。
 */
export async function getUserLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isLocale(value)) return value;
  return negotiate((await headers()).get("accept-language"));
}
