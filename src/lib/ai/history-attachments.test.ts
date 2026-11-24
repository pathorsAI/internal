import { describe, expect, test } from "bun:test";
import type { AiMessageRow } from "@/db/ai";
import {
  ATTACH_MAX_BYTES,
  attachmentPart,
  attachmentsToLoad,
  bytesToBase64,
  loadAttachmentParts,
  toModelMessages,
  toUiMessages,
} from "./history";
import type { ContentPart } from "./openrouter";
import type { AttachmentRef } from "./types";

const NOW = Date.parse("2026-11-25T10:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

let id = 1;
function user(content: string, attachments: AttachmentRef[] | null, createdAt = minutesAgo(1)): AiMessageRow {
  return {
    id: id++,
    role: "user",
    content,
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    status: null,
    attachments,
    createdAt,
  };
}
function assistant(content: string): AiMessageRow {
  return { ...user(content, null), role: "assistant" };
}

const img = (documentId: number, fileName = `p${documentId}.jpg`): AttachmentRef => ({
  documentId,
  fileName,
  contentType: "image/jpeg",
});

// 假的 STORAGE：documentId → 幾個位元組；記下被讀了哪些
function fakeStorage(files: Record<number, Uint8Array>) {
  const reads: number[][] = [];
  const reader = async (refs: AttachmentRef[]) => {
    reads.push(refs.map((r) => r.documentId));
    const out = new Map<number, ContentPart>();
    for (const r of refs) {
      const bytes = files[r.documentId];
      const part = bytes ? attachmentPart(r, bytes) : null;
      if (part) out.set(r.documentId, part);
    }
    return out;
  };
  return { reader, reads };
}

describe("attachments in model history", () => {
  test("only the last 3 messages with files, within 30 minutes, images and PDFs", () => {
    const rows = [
      user("最早", [img(1)], minutesAgo(5)),
      user("第二", [img(2)], minutesAgo(4)),
      user("第三", [img(3), { documentId: 4, fileName: "a.zip", contentType: "application/zip" }], minutesAgo(3)),
      assistant("好"),
      user("最新", [{ documentId: 5, fileName: "inv.pdf", contentType: "application/pdf" }], minutesAgo(2)),
      user("沒附件", null, minutesAgo(1)),
    ];
    expect(attachmentsToLoad(rows, NOW).map((a) => a.documentId)).toEqual([5, 3, 2]);
    const old = [user("舊", [img(9)], minutesAgo(31))];
    expect(attachmentsToLoad(old, NOW)).toEqual([]);
  });

  test("loaded files become parts after a text block that names every file", async () => {
    const storage = fakeStorage({ 1: new Uint8Array([1, 2, 3]) });
    const rows = [
      user("這張是代墊", [img(1, "receipt.jpg"), { documentId: 2, fileName: "notes.txt", contentType: "text/plain" }]),
    ];
    const parts = await loadAttachmentParts(rows, storage.reader, NOW);
    expect(storage.reads).toEqual([[1]]); // 文字檔不讀
    const [msg] = toModelMessages(rows, parts);
    expect(msg.role).toBe("user");
    expect(msg.content).toEqual([
      { type: "text", text: "這張是代墊\n[附件 document #1：receipt.jpg]\n[附件 document #2：notes.txt]" },
      { type: "image_url", image_url: { url: `data:image/jpeg;base64,${bytesToBase64(new Uint8Array([1, 2, 3]))}` } },
    ]);
  });

  test("PDFs use the file part; files that could not be read stay as text", async () => {
    const storage = fakeStorage({ 5: new Uint8Array([37, 80, 68, 70]) });
    const rows = [
      user("", [{ documentId: 5, fileName: "inv.pdf", contentType: "application/pdf" }, img(6)]),
    ];
    const parts = await loadAttachmentParts(rows, storage.reader, NOW);
    const [msg] = toModelMessages(rows, parts);
    expect(Array.isArray(msg.content)).toBe(true);
    const content = msg.content as ContentPart[];
    expect(content[0]).toEqual({ type: "text", text: "[附件 document #5：inv.pdf]\n[附件 document #6：p6.jpg]" });
    expect(content[1]).toMatchObject({ type: "file", file: { filename: "inv.pdf" } });
    expect((content[1] as { file: { file_data: string } }).file.file_data.startsWith("data:application/pdf;base64,")).toBe(true);
    expect(content.length).toBe(2); // #6 讀不到，只有文字
  });

  test("without loaded parts the message is plain text with placeholders", () => {
    const [msg] = toModelMessages([user("看一下", [img(7)])]);
    expect(msg.content).toBe("看一下\n[附件 document #7：p7.jpg]");
  });

  test("too-large files are never sent", () => {
    expect(attachmentPart(img(1), new Uint8Array(ATTACH_MAX_BYTES + 1))).toBeNull();
    expect(attachmentPart({ fileName: "x", contentType: "video/mp4" }, new Uint8Array(1))).toBeNull();
  });

  test("the UI keeps the attachments on the user bubble", () => {
    const ui = toUiMessages([user("q", [img(1)])]);
    expect(ui[0]).toMatchObject({ kind: "user", attachments: [{ documentId: 1 }] });
  });
});
