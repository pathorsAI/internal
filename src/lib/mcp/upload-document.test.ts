import { describe, expect, test } from "bun:test";
import type { InboxDocumentRow } from "@/db/chat";
import { deriveMcpAudit, isReadOnlyTool, toolAllowedFor } from "./handler";
import type { ToolContext } from "./shared";
import { tools } from "./tools";
import {
  decodeBase64Content,
  documentTools,
  NOT_ADMIN_UPLOAD_ERROR,
  parseUploadDocumentArgs,
  uploadDocumentToInbox,
  type UploadDocumentDeps,
} from "./tools-documents";

// 全部用假的 deps：不碰 DB、不碰物件儲存。

const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%receipt\n");
const PDF_B64 = btoa(String.fromCodePoint(...PDF_BYTES));

function fakeDeps(role: string | null = "admin") {
  const puts: { key: string; body: Uint8Array; contentType: string }[] = [];
  const created: Parameters<UploadDocumentDeps["createInboxDocument"]>[0][] = [];
  const deps: UploadDocumentDeps = {
    resolveOrg: async () => "org_1",
    getOrgRole: async () => role,
    putObject: async (key, body, contentType) => {
      puts.push({ key, body, contentType });
    },
    createInboxDocument: async (input) => {
      created.push(input);
      return { id: 42 } as InboxDocumentRow;
    },
    newId: () => "uuid-1",
  };
  return { deps, puts, created };
}

const ctx: ToolContext = { userId: "u1" };
const args = (over: Record<string, unknown> = {}) => ({
  fileName: "Meta 收據 2026-11.pdf",
  contentType: "application/pdf",
  contentBase64: PDF_B64,
  ...over,
});

describe("upload_document", () => {
  test("a valid PDF is stored under mcp/<org>/ and becomes an inbox document with source mcp", async () => {
    const { deps, puts, created } = fakeDeps("owner");
    const out = await uploadDocumentToInbox(args(), ctx, deps);
    expect(out).toEqual({
      documentId: 42,
      fileName: "Meta 收據 2026-11.pdf",
      contentType: "application/pdf",
      sizeBytes: PDF_BYTES.byteLength,
    });
    expect(puts).toHaveLength(1);
    expect(puts[0].key).toBe("mcp/org_1/uuid-1-Meta_2026-11.pdf");
    expect(puts[0].contentType).toBe("application/pdf");
    expect([...puts[0].body]).toEqual([...PDF_BYTES]);
    expect(created).toEqual([
      {
        orgId: "org_1",
        r2Key: "mcp/org_1/uuid-1-Meta_2026-11.pdf",
        fileName: "Meta 收據 2026-11.pdf",
        contentType: "application/pdf",
        sizeBytes: PDF_BYTES.byteLength,
        uploadedBy: "u1",
        source: "mcp",
      },
    ]);
  });

  test("accepts a data: URL prefix, line breaks, missing padding and octet-stream with a .pdf name", () => {
    const parsed = parseUploadDocumentArgs(
      args({ contentType: "application/octet-stream", contentBase64: `data:application/pdf;base64,${PDF_B64}` }),
    );
    expect(parsed.contentType).toBe("application/pdf");
    expect([...parsed.bytes]).toEqual([...PDF_BYTES]);
    const wrapped = PDF_B64.replace(/=+$/, "").replaceAll(/(.{8})/g, "$1\n");
    expect([...decodeBase64Content(wrapped)]).toEqual([...PDF_BYTES]);
    expect(parseUploadDocumentArgs(args({ fileName: "a.png", contentType: "image/png" })).contentType).toBe(
      "image/png",
    );
  });

  test("rejects bad base64, empty files, disallowed types and files over 10 MB", () => {
    expect(() => parseUploadDocumentArgs(args({ contentBase64: "not base64!!" }))).toThrow(/valid base64/);
    expect(() => parseUploadDocumentArgs(args({ contentBase64: "abcde" }))).toThrow(/valid base64/);
    expect(() => parseUploadDocumentArgs(args({ contentBase64: "" }))).toThrow(/empty/);
    expect(() => parseUploadDocumentArgs(args({ contentBase64: "data:application/pdf;base64," }))).toThrow(/empty/);
    expect(() => parseUploadDocumentArgs(args({ contentBase64: undefined }))).toThrow(/contentBase64/);
    expect(() => parseUploadDocumentArgs(args({ contentType: "text/html" }))).toThrow(/Unsupported contentType/);
    expect(() =>
      parseUploadDocumentArgs(args({ fileName: "x.zip", contentType: "application/octet-stream" })),
    ).toThrow(/Unsupported contentType/);
    expect(() => parseUploadDocumentArgs(args({ fileName: " " }))).toThrow(/fileName/);
    expect(() => parseUploadDocumentArgs(args({ fileName: `${"a".repeat(300)}.pdf` }))).toThrow(/too long/);
    // 超過 10 MB 一點：解碼前就用長度擋下
    const tooBig = "A".repeat((Math.ceil((10 * 1024 * 1024) / 3) + 1) * 4);
    expect(() => parseUploadDocumentArgs(args({ contentBase64: tooBig }))).toThrow(/too large/);
    // 上限本身可以，多 1 byte 就不行
    expect(decodeBase64Content("AAAA", 3).byteLength).toBe(3);
    expect(() => decodeBase64Content("AAAAAA==", 3)).toThrow(/too large/);
  });

  test("bad arguments fail before resolving the org or touching storage", async () => {
    const { deps, puts, created } = fakeDeps("owner");
    let resolved = false;
    deps.resolveOrg = async () => {
      resolved = true;
      return "org_1";
    };
    await expect(uploadDocumentToInbox(args({ contentType: "text/plain" }), ctx, deps)).rejects.toThrow(
      /Unsupported/,
    );
    expect(resolved).toBe(false);
    expect(puts).toHaveLength(0);
    expect(created).toHaveLength(0);
  });

  test("members (and non-members) cannot upload", async () => {
    for (const role of ["member", null]) {
      const { deps, puts, created } = fakeDeps(role);
      await expect(uploadDocumentToInbox(args(), ctx, deps)).rejects.toThrow(NOT_ADMIN_UPLOAD_ERROR);
      expect(puts).toHaveLength(0);
      expect(created).toHaveLength(0);
    }
    const { deps } = fakeDeps("admin");
    await expect(uploadDocumentToInbox(args(), ctx, deps)).resolves.toMatchObject({ documentId: 42 });
  });

  test("registered as a write tool, audited as a document create, hidden from read-only keys", () => {
    expect(tools.upload_document).toBe(documentTools.upload_document);
    expect(tools.upload_document.inputSchema.required).toEqual(["fileName", "contentType", "contentBase64"]);
    expect(tools.upload_document.inputSchema.properties).toHaveProperty("organizationId");
    expect(tools.upload_document.description).toContain("update_transaction");
    expect(isReadOnlyTool("upload_document")).toBe(false);
    const readKey: ToolContext = {
      userId: "u1",
      apiKey: { id: 1, name: "腳本", organizationId: "org_1", scope: "read" },
    };
    const writeKey: ToolContext = { ...readKey, apiKey: { ...readKey.apiKey!, scope: "write" } };
    expect(toolAllowedFor("upload_document", readKey)).toBe(false);
    expect(toolAllowedFor("upload_document", writeKey)).toBe(true);
    expect(deriveMcpAudit("upload_document", { documentId: 42 })).toEqual({
      action: "create",
      entityType: "document",
      entityId: 42,
    });
  });
});
