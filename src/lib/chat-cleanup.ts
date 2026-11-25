/**
 * 聊天 bot 的每日清理（由 /api/cron/integrations-autosync 在同步之後呼叫）：
 * - 收件匣：聊天收到（或 MCP upload_document 上傳）、超過 30 天還沒掛到任何交易或發票的檔案 → 刪 STORAGE 物件再刪列
 * - chat_inbound_events（webhook 去重）超過 7 天
 * - chat_buffer（合併成一題的暫存）超過 7 天
 * - chat_message_refs（回覆引用的對照）超過 90 天
 * - 過期還開著的確認卡 → expired
 *
 * 每一項各自接住錯誤：某一項失敗只記在結果裡，不影響其他項、也不影響原本的同步。
 */
import {
  deleteInboxDocumentRows,
  expireChatCards,
  listStaleInboxDocuments,
  purgeChatBuffer,
  purgeChatMessageRefs,
  purgeInboundEvents,
} from "@/db/chat";
import { deleteDocument } from "@/lib/storage";

export const INBOX_RETENTION_DAYS = 30;
export const INBOUND_EVENT_RETENTION_DAYS = 7;
export const BUFFER_RETENTION_DAYS = 7;
export const MESSAGE_REF_RETENTION_DAYS = 90;

/** 一次 cron 最多處理幾批收件匣（每批 200 筆），避免一次跑太久。 */
const MAX_INBOX_BATCHES = 5;
const INBOX_BATCH = 200;

export type ChatCleanupDeps = {
  listStaleInboxDocuments: (days: number, limit: number) => Promise<{ id: number; r2Key: string }[]>;
  deleteObject: (key: string) => Promise<void>;
  deleteInboxDocumentRows: (ids: readonly number[]) => Promise<number>;
  purgeInboundEvents: (days: number) => Promise<number>;
  purgeChatBuffer: (days: number) => Promise<number>;
  purgeChatMessageRefs: (days: number) => Promise<number>;
  expireChatCards: () => Promise<number>;
};

const defaultDeps: ChatCleanupDeps = {
  listStaleInboxDocuments,
  deleteObject: deleteDocument,
  deleteInboxDocumentRows,
  purgeInboundEvents,
  purgeChatBuffer,
  purgeChatMessageRefs,
  expireChatCards,
};

export type ChatCleanupResult = {
  inboxDocuments: number;
  inboxFileErrors: number;
  inboundEvents: number;
  buffer: number;
  messageRefs: number;
  expiredCards: number;
  /** 哪幾項整個失敗了（項目名 → 錯誤訊息）。 */
  errors: Record<string, string>;
};

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 刪收件匣：檔案刪成功的才刪列；檔案刪不掉的列留著，明天再試。 */
async function cleanInbox(deps: ChatCleanupDeps): Promise<{ deleted: number; fileErrors: number }> {
  let deleted = 0;
  let fileErrors = 0;
  const failed = new Set<number>();
  for (let batch = 0; batch < MAX_INBOX_BATCHES; batch++) {
    const stale = (await deps.listStaleInboxDocuments(INBOX_RETENTION_DAYS, INBOX_BATCH)).filter(
      (d) => !failed.has(d.id),
    );
    if (stale.length === 0) break;
    const ok: number[] = [];
    for (const d of stale) {
      try {
        await deps.deleteObject(d.r2Key);
        ok.push(d.id);
      } catch (e) {
        fileErrors++;
        failed.add(d.id);
        console.error(`[chat-cleanup] could not delete ${d.r2Key}: ${message(e)}`);
      }
    }
    if (ok.length > 0) deleted += await deps.deleteInboxDocumentRows(ok);
    // 這批全部失敗：再撈也是同一批，停下來。
    if (ok.length === 0) break;
  }
  return { deleted, fileErrors };
}

export async function runChatCleanup(deps: ChatCleanupDeps = defaultDeps): Promise<ChatCleanupResult> {
  const result: ChatCleanupResult = {
    inboxDocuments: 0,
    inboxFileErrors: 0,
    inboundEvents: 0,
    buffer: 0,
    messageRefs: 0,
    expiredCards: 0,
    errors: {},
  };
  const step = async (name: string, run: () => Promise<void>) => {
    try {
      await run();
    } catch (e) {
      result.errors[name] = message(e);
      console.error(`[chat-cleanup] ${name} failed: ${message(e)}`);
    }
  };
  await step("inbox", async () => {
    const r = await cleanInbox(deps);
    result.inboxDocuments = r.deleted;
    result.inboxFileErrors = r.fileErrors;
  });
  await step("inboundEvents", async () => {
    result.inboundEvents = await deps.purgeInboundEvents(INBOUND_EVENT_RETENTION_DAYS);
  });
  await step("buffer", async () => {
    result.buffer = await deps.purgeChatBuffer(BUFFER_RETENTION_DAYS);
  });
  await step("messageRefs", async () => {
    result.messageRefs = await deps.purgeChatMessageRefs(MESSAGE_REF_RETENTION_DAYS);
  });
  await step("cards", async () => {
    result.expiredCards = await deps.expireChatCards();
  });
  return result;
}
