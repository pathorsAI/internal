import { isChatProvider } from "@/db/chat";
import type { ChannelJob, RawWebhookJob } from "./types";

/** 佇列訊息 → job。格式不對回 null（/api/channels/process 回 200 讓它被丟掉）。 */
export function parseJob(raw: unknown): ChannelJob | RawWebhookJob | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  if (j.kind === "raw") {
    if (!isChatProvider(j.provider) || typeof j.body !== "string") return null;
    const h = j.headers;
    if (!h || typeof h !== "object" || Object.values(h).some((v) => typeof v !== "string")) return null;
    return j as unknown as RawWebhookJob;
  }
  if (j.kind === "flush") {
    if (!isChatProvider(j.provider) || typeof j.identityId !== "string" || typeof j.anchor !== "string") return null;
    return j as unknown as ChannelJob;
  }
  if (j.kind === "event") {
    const e = j.event as Record<string, unknown> | null;
    if (!e || !isChatProvider(e.provider) || typeof e.eventId !== "string" || typeof e.kind !== "string") return null;
    if (typeof e.externalUserId !== "string" || typeof e.isGroup !== "boolean") return null;
    return j as unknown as ChannelJob;
  }
  return null;
}
