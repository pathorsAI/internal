import { getCloudflareContext } from "@opennextjs/cloudflare";
import { getDocument } from "@/db/queries";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

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

  const { orgId } = await requireOrg();
  const doc = await getDocument(orgId, docId);
  if (!doc?.r2Key || doc.r2Key.startsWith("meta/")) {
    return new Response("Not found", { status: 404 });
  }

  const obj = await getCloudflareContext().env.STORAGE.get(doc.r2Key);
  if (!obj) {
    return new Response("File missing", { status: 404 });
  }

  const headers = new Headers();
  headers.set(
    "Content-Type",
    doc.contentType ?? obj.httpMetadata?.contentType ?? "application/octet-stream",
  );
  if (doc.fileName) {
    headers.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
    );
  }
  headers.set("Cache-Control", "private, max-age=60");

  return new Response(obj.body, { headers });
}
