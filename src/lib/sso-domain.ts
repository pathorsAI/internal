import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { ssoProvider } from "@/db/auth-schema";

/**
 * 某個 email 網域是否落在 sso_provider.domain 的清單裡。
 *
 * 逐字照抄 @better-auth/sso 1.6.14 的 `domainMatches`（dist/index.mjs）：domain 欄位
 * 可以是逗號分隔的多個網域，每個去空白、轉小寫；完全相同或是它的子網域都算。
 * 必須跟 plugin 一模一樣——這裡的判斷決定「誰不准自助註冊」，plugin 的判斷決定
 * 「誰在登入頁會被導去 IdP」。兩邊不一致，就會有人既不能自己註冊、在登入頁又
 * 不會被導去 SSO，卡在中間哪裡都進不去。
 *
 * 子網域比對用 `endsWith("." + d)` 而不是 `endsWith(d)`：後者會讓 evilacme.com
 * 被當成 acme.com。
 */
export function domainMatches(searchDomain: string, domainList: string): boolean {
  const search = searchDomain.toLowerCase();
  return domainList
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .some((d) => search === d || search.endsWith(`.${d}`));
}

/**
 * 這個 email 的網域是否有註冊 SSO provider —— 有的話，這個人只能走公司的 IdP。
 *
 * 只看 domain_verified = true 的 provider：auth.ts 開了 domainVerification，plugin 的
 * /sign-in/sso 遇到未驗證的 provider 會回 401，登入頁接著把人送到密碼那一步，
 * 也就是「實際上不會被導去 IdP」。這裡用同一個條件，擋下自助註冊的範圍才會剛好
 * 等於登入頁真的會導去 SSO 的範圍。
 *
 * 取網域的方式也跟 plugin 一樣用 `split("@")[1]`。不是字串（hooks 拿到的 body
 * 還沒經過 zod 驗證）就當作不是 SSO 網域，交給 endpoint 自己的驗證去拒絕。
 *
 * provider 數量是個位數，整張表撈回來在記憶體比對；domain 是逗號清單又要比子網域，
 * 用 SQL 寫只會更難懂。
 */
export async function isSsoDomain(email: unknown): Promise<boolean> {
  if (typeof email !== "string") return false;
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return false;
  const rows = await getDb()
    .select({ domain: ssoProvider.domain })
    .from(ssoProvider)
    .where(eq(ssoProvider.domainVerified, true));
  return rows.some((row) => domainMatches(domain, row.domain));
}
