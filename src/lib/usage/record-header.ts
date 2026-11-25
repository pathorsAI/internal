/**
 * src/proxy.ts 把正規化後的路由 pattern 放在這個 request header，requireOrg() 讀它。
 * 獨立成一支沒有任何 import 的檔案：proxy 只需要這個字串，不該把 DB 程式碼打包進去。
 */
export const USAGE_ROUTE_HEADER = "x-pathors-usage-route";
