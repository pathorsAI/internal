"use server";

import { headers } from "next/headers";
import { isAPIError } from "better-auth/api";
import { auth } from "@/lib/auth";

export type SetInitialPasswordResult = { ok: true } | { ok: false; code: string };

/**
 * 替目前登入的人設第一組密碼。
 *
 * 為什麼是 server action：better-auth 1.6.14 的 setPassword 沒有 HTTP 路徑
 * （api/routes/update-user 的 setPassword 是 createAuthEndpoint 不帶 path，只能從
 * 伺服器呼叫）。它的設計就是「已登入、但沒有密碼」的人加密碼用的；已經有密碼的
 * 人會被它拒絕（PASSWORD_ALREADY_SET），所以這支 action 不能拿來改別人的密碼，
 * 也不能在不知道舊密碼的情況下改自己的。
 *
 * 長度檢查由 better-auth 依 minPasswordLength 再做一次，不只信前端。
 */
export async function setInitialPassword(newPassword: string): Promise<SetInitialPasswordResult> {
  if (typeof newPassword !== "string") return { ok: false, code: "VALIDATION_ERROR" };
  try {
    await auth.api.setPassword({ body: { newPassword }, headers: await headers() });
    return { ok: true };
  } catch (error) {
    if (isAPIError(error)) {
      const code = (error.body as { code?: unknown } | undefined)?.code;
      return { ok: false, code: typeof code === "string" ? code : "UNKNOWN" };
    }
    throw error;
  }
}
