import { AsyncLocalStorage } from "node:async_hooks";
import { createTranslator, type NamespaceKeys, type NestedKeyOf } from "next-intl";
import { getTranslations } from "next-intl/server";
import { defaultLocale } from "./config";
import { messages, type Messages } from "./messages";

/**
 * 沒有「使用者請求」時也能用的翻譯函式。
 *
 * next-intl 的 `getTranslations` 靠 src/i18n/request.ts 從 cookie / Accept-Language
 * 決定語系，而 `cookies()` / `headers()` 只在 Next 的 request scope 裡存在。排程工作
 * （整合每日自動同步，src/lib/integrations/autosync.ts）不是任何人發出的請求，
 * 所以走的是另一條路：在 `runAsSystem()` 裡執行的程式碼，`getServerT()` 一律回傳
 * 預設語系（zh-TW，也是 source of truth）的 translator，直接吃打包進來的字典。
 *
 * 不在 system context 裡時就是原封不動的 `getTranslations` —— web 與 MCP 的行為不變。
 *
 * 刻意不用「try getTranslations、失敗就退回」：Next 在靜態預算時會用丟例外的方式
 * 標記「這頁用到了 cookies()」，吞掉那個例外會讓頁面被錯誤地當成靜態。用顯式的
 * context 旗標判斷，就不會碰到 Next 的控制流程。
 */

const systemContext = new AsyncLocalStorage<true>();

/** 以「系統」身分執行（沒有使用者、沒有 request 語系）。訊息一律 zh-TW。 */
export function runAsSystem<T>(fn: () => Promise<T>): Promise<T> {
  return systemContext.run(true, fn);
}

/** 目前是否在 runAsSystem 裡。 */
export function inSystemContext(): boolean {
  return systemContext.getStore() === true;
}

type Namespace = NamespaceKeys<Messages, NestedKeyOf<Messages>>;
type ServerT<N extends Namespace> = ReturnType<typeof createTranslator<Messages, N>>;

/** 同 `getTranslations(namespace)`；在 runAsSystem 裡改用 zh-TW 字典，不需要 request。 */
export async function getServerT<N extends Namespace>(namespace: N): Promise<ServerT<N>> {
  if (inSystemContext()) {
    return createTranslator<Messages, N>({
      locale: defaultLocale,
      messages: messages[defaultLocale],
      namespace,
    });
  }
  return getTranslations<N>(namespace);
}
