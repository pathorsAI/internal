import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDocument } from "@/db/queries";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * 可以直接 inline 顯示的型別白名單。
 *
 * 為什麼需要白名單：documents.contentType 存的是上傳當下瀏覽器給的 `file.type`
 * （src/lib/storage.ts），完全由上傳者控制。把它原封不動當 Content-Type 回、再配
 * `Content-Disposition: inline`，等於允許任何成員在 internal.pathors.com 這個
 * origin 上掛一頁自己的 HTML —— 那是教科書等級的 stored XSS，能讀到同源的
 * session cookie 與整個帳務 API。
 *
 * 名單只收「瀏覽器渲染時不會執行腳本」的型別。特別注意 image/svg+xml 不在裡面：
 * SVG 當成文件開啟時可以帶 <script>，它是圖片裡唯一會執行程式的格式。
 */
const INLINE_SAFE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "application/pdf",
]);

/** 去掉 `; charset=…` 這類參數再比對，並統一小寫。 */
function normalizeType(raw: string | null | undefined): string {
  return (raw ?? "").split(";")[0].trim().toLowerCase();
}

// 串流回 R2 上的憑證檔案（bucket 非公開，需透過這個 route 取用）
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const docId = Number(id);
  if (!Number.isFinite(docId)) {
    return new Response("Bad id", { status: 400 });
  }

  // 跨租戶隔離：requireOrg() 決定呼叫者當前的組織，getDocument() 的 where 同時
  // 綁 organizationId 與 id，所以拿別的組織的 id 來猜只會得到 404（IDOR 的解法
  // 是查詢就帶上租戶條件，而不是查完再比對）。
  const { orgId } = await requireOrg();
  const doc = await getDocument(orgId, docId);
  if (!doc?.r2Key || doc.r2Key.startsWith("meta/")) {
    return new Response("Not found", { status: 404 });
  }

  const obj = await getCloudflareContext().env.STORAGE.get(doc.r2Key);
  if (!obj) {
    return new Response("File missing", { status: 404 });
  }

  const declaredType = normalizeType(doc.contentType ?? obj.httpMetadata?.contentType);
  const inlineSafe = INLINE_SAFE_TYPES.has(declaredType);
  const disposition = inlineSafe ? "inline" : "attachment";
  const fileName = doc.fileName ?? `document-${docId}`;

  const headers = new Headers({
    // 不在白名單內的一律降成八位元串流：即使有人硬把網址貼到網址列，瀏覽器也只會
    // 存檔，不會把它當文件渲染。
    "Content-Type": inlineSafe ? declaredType : "application/octet-stream",
    // filename* 用 RFC 5987 編碼，中文檔名才不會壞掉。
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    // 沒有這個，Chrome 會在 Content-Type 與內容不符時自行「猜」型別，把
    // application/octet-stream 的 HTML 猜回 text/html，上面那層防護就白做了。
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=60",
    // 憑證是組織私有資料，任何情況下都不該進搜尋引擎索引。
    "X-Robots-Tag": "noindex, nofollow",
  });

  // 強制下載的那一類本來就不會被渲染，這條 CSP 是第二道保險：萬一哪天 disposition
  // 判斷被繞過，這份回應也拿不到任何腳本、樣式或子資源。inline 的那一類不加，
  // 避免影響瀏覽器內建 PDF 檢視器。
  if (!inlineSafe) {
    headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  }

  return new Response(obj.body, { headers });
}
