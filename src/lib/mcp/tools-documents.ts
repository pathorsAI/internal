import { createInboxDocument } from "@/db/chat";
import { CHAT_MEDIA_MAX_BYTES, isAcceptedMime, normalizeMime, safeFileName } from "@/lib/channels/media";
import { canManageOrg, getOrgRole } from "@/lib/session";
import { putObject } from "@/lib/storage";
import { ORG_ARG, requireString, resolveOrg, type ToolContext, type ToolDef } from "./shared";

/**
 * upload_document：API / MCP client 把檔案（收據 PDF、照片）放進組織的收件匣。
 *
 * 收件匣 document 原本只有 LINE / WhatsApp 會建（src/lib/channels/dispatcher.ts）；這支讓
 * 腳本與外部 agent 也能建，之後一樣用 create_transaction / update_transaction 的
 * documentIds + docKind 掛到交易上。這支只負責上傳，不掛交易。
 *
 * 型別與大小上限跟聊天 bot 同一套（src/lib/channels/media.ts）。只有 owner / admin 能用；
 * 站內 AI 與聊天 bot 不提供（它們的檔案直接從對話進收件匣，見 src/lib/ai/tool-policy.ts）。
 */

const MAX_FILE_NAME_CHARS = 255;
const MAX_MB = CHAT_MEDIA_MAX_BYTES / (1024 * 1024);

/** 只接受標準 base64（A–Z a–z 0–9 + /，結尾最多兩個 =）；換行與空白先去掉。 */
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;
/** data URL 前綴：`data:application/pdf;base64,`。 */
const DATA_URL_PREFIX_RE = /^data:[^,]*;base64,/i;

/**
 * 解 base64 成 bytes。容許 `data:...;base64,` 前綴、換行與缺少的 `=` 補位；
 * 解碼前先用長度估大小，超過上限就不解（避免白白配置一大塊記憶體）。
 */
export function decodeBase64Content(raw: string, maxBytes = CHAT_MEDIA_MAX_BYTES): Uint8Array {
  const body = raw.trim().replace(DATA_URL_PREFIX_RE, "").replaceAll(/\s+/g, "");
  if (body.length === 0) throw new Error('"contentBase64" is empty; the file has no content.');
  if (!BASE64_RE.test(body) || body.length % 4 === 1) {
    throw new Error('"contentBase64" is not valid base64 (standard alphabet A-Z a-z 0-9 + /, optional = padding).');
  }
  const padded = body + "=".repeat((4 - (body.length % 4)) % 4);
  const padding = padded.length - padded.replace(/=+$/, "").length;
  const estimated = (padded.length / 4) * 3 - padding;
  if (estimated > maxBytes) {
    throw new Error(`File is too large (${estimated} bytes); the limit is ${MAX_MB} MB.`);
  }
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('"contentBase64" is not valid base64.');
  }
  if (binary.length === 0) throw new Error('"contentBase64" is empty; the file has no content.');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.codePointAt(i) ?? 0;
  return bytes;
}

export type UploadDocumentInput = { fileName: string; contentType: string; bytes: Uint8Array };

/** 驗證參數（不碰 DB、不碰儲存）：檔名、型別（跟聊天 bot 同一份白名單）、內容。 */
export function parseUploadDocumentArgs(args: Record<string, unknown>): UploadDocumentInput {
  const fileName = requireString(args, "fileName").trim();
  if (!fileName) throw new Error('"fileName" is required.');
  if (fileName.length > MAX_FILE_NAME_CHARS) {
    throw new Error(`"fileName" is too long (max ${MAX_FILE_NAME_CHARS} characters).`);
  }
  const declared = requireString(args, "contentType");
  const contentType = normalizeMime(declared, fileName);
  if (!isAcceptedMime(contentType)) {
    throw new Error(
      `Unsupported contentType "${declared}". Upload a PDF (application/pdf) or an image (image/jpeg, image/png, image/webp, image/heic, image/gif).`,
    );
  }
  const raw = args.contentBase64;
  if (typeof raw !== "string") throw new Error('"contentBase64" is required (the file encoded as base64).');
  return { fileName, contentType, bytes: decodeBase64Content(raw) };
}

/** 寫入用的外部依賴（測試換成假的）。 */
export type UploadDocumentDeps = {
  resolveOrg: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
  getOrgRole: (orgId: string, userId: string) => Promise<string | null>;
  putObject: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  createInboxDocument: typeof createInboxDocument;
  newId: () => string;
};

const defaultDeps: UploadDocumentDeps = {
  resolveOrg,
  getOrgRole,
  putObject,
  createInboxDocument,
  newId: () => crypto.randomUUID(),
};

export const NOT_ADMIN_UPLOAD_ERROR =
  "Only an owner or admin of this organization can upload documents. Ask an owner or admin to do it.";

/** 驗證 → 檢查角色 → 存檔 → 建收件匣 document（source = mcp）。 */
export async function uploadDocumentToInbox(
  args: Record<string, unknown>,
  ctx: ToolContext,
  deps: UploadDocumentDeps = defaultDeps,
) {
  // 先驗參數：壞掉的 base64、不收的型別不必查 DB。
  const input = parseUploadDocumentArgs(args);
  const orgId = await deps.resolveOrg(args, ctx);
  if (!canManageOrg(await deps.getOrgRole(orgId, ctx.userId))) throw new Error(NOT_ADMIN_UPLOAD_ERROR);
  const key = `mcp/${orgId}/${deps.newId()}-${safeFileName(input.fileName)}`;
  await deps.putObject(key, input.bytes, input.contentType);
  const doc = await deps.createInboxDocument({
    orgId,
    r2Key: key,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
    uploadedBy: ctx.userId,
    source: "mcp",
  });
  return {
    documentId: doc.id,
    fileName: input.fileName,
    contentType: input.contentType,
    sizeBytes: input.bytes.byteLength,
  };
}

export const documentTools: Record<string, ToolDef> = {
  upload_document: {
    description:
      `Upload a file (a receipt or invoice PDF, or a photo of one) into this organization's document inbox (owner/admin only). Pass the file as standard base64 in contentBase64 (a data:...;base64, prefix is fine). Accepted: PDF and images (jpeg, png, webp, heic, gif), up to ${MAX_MB} MB. This only stores the file — it is NOT attached to anything yet. Next step: attach it with update_transaction (existing transaction) or create_transaction, passing documentIds: [documentId] and docKind (e.g. receipt, e_invoice, paper_invoice). A document that is never attached stays in the inbox and is deleted after 30 days. Upload one file per call.`,
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "File name shown on the transaction, e.g. meta-receipt-2026-11-03.pdf." },
        contentType: {
          type: "string",
          description: "MIME type: application/pdf, image/jpeg, image/png, image/webp, image/heic or image/gif.",
        },
        contentBase64: { type: "string", description: `File content, standard base64. Max ${MAX_MB} MB decoded.` },
        ...ORG_ARG,
      },
      required: ["fileName", "contentType", "contentBase64"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        documentId: {
          type: "number",
          description: "Pass this in documentIds to update_transaction / create_transaction to attach the file.",
        },
        fileName: { type: "string" },
        contentType: { type: "string", description: "Normalized MIME type that was stored." },
        sizeBytes: { type: "number" },
      },
      required: ["documentId", "fileName", "contentType", "sizeBytes"],
    },
    annotations: {
      title: "Upload document to inbox",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: (args, ctx) => uploadDocumentToInbox(args, ctx),
  },
};
