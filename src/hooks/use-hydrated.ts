import { useSyncExternalStore } from "react";

const subscribeNoop = () => () => {};

/**
 * 伺服器端與 hydration 期間是 false，之後是 true。
 *
 * 登入表單的送出鈕靠它擋住 hydration 前的送出：onSubmit 還沒接上時，送出會變成
 * 瀏覽器原生的表單送出。表單唯一的 submit 鈕 disabled 時，瀏覽器連 Enter 的隱式
 * 送出也會擋掉，帳密就不會被送進網址（pathors/pathors#3281）。不是 hydration 的
 * render（站內導頁）會直接讀到 true，不會閃一下 disabled。
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}
