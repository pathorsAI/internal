import type { IntegrationConfig } from "./types";

// Discord 整合在 org_integrations.config 裡的非機密設定。client 與 server 都可以 import
// （純函式，不碰 DB）。連接 Sheet 的輸入都是字串，存進 config 也是字串，所以讀的時候一律
// 防禦式解析、超出範圍就退回預設，不讓一個打錯的數字讓整個通知停擺。
//
//   mentionRoleId  提醒與回顧要 @ 的 Discord 身分組 id（選填）
//   recapDay       每月幾號發上個月的回顧（1–28，預設 1）
//   reminderDays   扣款日前幾天提醒（0–14，預設 3；0 = 當天）
//   channelId / guildId / webhookName  連接時從 Discord 讀回來的，只用來顯示

export type DiscordConfig = {
  mentionRoleId: string | null;
  recapDay: number;
  reminderDays: number;
};

export const DISCORD_DEFAULTS = { recapDay: 1, reminderDays: 3 } as const;
export const RECAP_DAY_RANGE = { min: 1, max: 28 } as const;
export const REMINDER_DAYS_RANGE = { min: 0, max: 14 } as const;

/** 整數字串（或數字）且在範圍內才回傳；其他一律 null。 */
export function parseIntInRange(v: unknown, range: { min: number; max: number }): number | null {
  let s = "";
  if (typeof v === "number") s = String(v);
  else if (typeof v === "string") s = v.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= range.min && n <= range.max ? n : null;
}

/**
 * 身分組 id 是 Discord 的 snowflake（純數字）。使用者常直接貼 `<@&123>`，所以先剝掉外殼。
 * 認不得回 null。
 */
export function parseRoleId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/^<@&/, "").replace(/>$/, "");
  return /^\d{5,25}$/.test(s) ? s : null;
}

export function parseDiscordConfig(config: IntegrationConfig | null | undefined): DiscordConfig {
  return {
    mentionRoleId: parseRoleId(config?.mentionRoleId),
    recapDay: parseIntInRange(config?.recapDay, RECAP_DAY_RANGE) ?? DISCORD_DEFAULTS.recapDay,
    reminderDays: parseIntInRange(config?.reminderDays, REMINDER_DAYS_RANGE) ?? DISCORD_DEFAULTS.reminderDays,
  };
}
