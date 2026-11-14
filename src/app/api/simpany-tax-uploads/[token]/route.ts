import { receiveSlotUpload, TAX_UPLOAD_MAX_TOTAL_BYTES } from "@/lib/simpany-tax-upload";
import { taxUploadStore } from "@/lib/simpany-tax-upload-store";

export const dynamic = "force-dynamic";

/**
 * 一次性上傳網址（MCP 工具 simpany_create_tax_upload_slots 開的）。
 *
 * 不走登入：網址裡 256-bit 的隨機 token 就是憑證，30 分鐘內有效、只能 PUT 一次，
 * 檔名與副檔名在開網址時已經定好，這裡收到的位元組只會進那個組織的暫存區，
 * 之後還要經過預覽 + 使用者確認才會送到 Simpany。用法：`curl -T <檔案> <網址>`。
 */
export async function PUT(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > TAX_UPLOAD_MAX_TOTAL_BYTES) {
    return Response.json({ ok: false, error: "file too large" }, { status: 413 });
  }
  const bytes = new Uint8Array(await req.arrayBuffer());
  const res = await receiveSlotUpload(taxUploadStore(), token, bytes);
  if (!res.ok) return Response.json({ ok: false, error: res.error }, { status: res.status });
  return Response.json(res);
}
