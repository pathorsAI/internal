import { describe, expect, test } from "bun:test";
import { runChatCleanup, type ChatCleanupDeps } from "./chat-cleanup";

function deps(over: Partial<ChatCleanupDeps> = {}) {
  const calls: string[] = [];
  let pool = [
    { id: 1, r2Key: "chat/o/1-a.jpg" },
    { id: 2, r2Key: "chat/o/2-b.pdf" },
  ];
  const d: ChatCleanupDeps = {
    listStaleInboxDocuments: async () => pool,
    deleteObject: async (key) => {
      calls.push(`del ${key}`);
    },
    deleteInboxDocumentRows: async (ids) => {
      calls.push(`rows ${ids.join(",")}`);
      pool = pool.filter((p) => !ids.includes(p.id));
      return ids.length;
    },
    purgeInboundEvents: async (days) => {
      calls.push(`events ${days}`);
      return 3;
    },
    purgeChatBuffer: async (days) => {
      calls.push(`buffer ${days}`);
      return 4;
    },
    purgeChatMessageRefs: async (days) => {
      calls.push(`refs ${days}`);
      return 5;
    },
    expireChatCards: async () => 6,
    ...over,
  };
  return { d, calls };
}

describe("runChatCleanup", () => {
  test("先刪檔再刪列，各項保留天數正確", async () => {
    const { d, calls } = deps();
    const r = await runChatCleanup(d);
    expect(r).toEqual({
      inboxDocuments: 2,
      inboxFileErrors: 0,
      inboundEvents: 3,
      buffer: 4,
      messageRefs: 5,
      expiredCards: 6,
      errors: {},
    });
    expect(calls.slice(0, 3)).toEqual(["del chat/o/1-a.jpg", "del chat/o/2-b.pdf", "rows 1,2"]);
    expect(calls).toContain("events 7");
    expect(calls).toContain("buffer 7");
    expect(calls).toContain("refs 90");
  });

  test("檔案刪不掉的列留著（明天再試），其他照刪", async () => {
    const { d, calls } = deps({
      deleteObject: async (key) => {
        if (key.includes("2-b")) throw new Error("R2 down");
      },
    });
    const r = await runChatCleanup(d);
    expect(r.inboxDocuments).toBe(1);
    expect(r.inboxFileErrors).toBe(1);
    expect(calls).toContain("rows 1");
    expect(calls.some((c) => c.startsWith("rows") && c.includes("2"))).toBe(false);
  });

  test("某一項整個失敗不影響其他項", async () => {
    const { d } = deps({
      purgeInboundEvents: async () => {
        throw new Error("db down");
      },
    });
    const r = await runChatCleanup(d);
    expect(r.errors).toEqual({ inboundEvents: "db down" });
    expect(r.buffer).toBe(4);
    expect(r.expiredCards).toBe(6);
  });
});
