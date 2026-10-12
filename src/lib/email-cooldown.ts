import { and, eq, gt, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { verification } from "@/db/auth-schema";

export type EmailCooldownKind = "magic-link" | "reset-password";

/**
 * 同一個收件地址、同一種信，`seconds` 秒內只寄一封。搶到名額回 true，該寄；
 * 還在冷卻中回 false，呼叫端應該**默默不寄**，API 回應照常——回應一旦不同，
 * 就成了「這個 email 剛剛有人申請過」的探測管道。
 *
 * 為什麼需要它：better-auth 的 rate limit 在 Workers 上是 memory storage，計數
 * 不跨 isolate（見 src/lib/auth.ts 的 Rate limiting 段），擋不住有人換著 IP、
 * 打不同的 isolate，拿我們的註冊表單去轟炸某個人的信箱。這裡用的是資料庫，
 * 所有 isolate 看到的是同一份狀態。它保護的是「收件人」，不是我們的端點。
 *
 * 借用 better-auth 既有的 verification 表（identifier 加上 `email-cooldown:` 前綴，
 * 跟 better-auth 自己的 `reset-password:<token>`、magic link 的雜湊 token 不會撞），
 * 所以不需要 migration。過期的那一列在下次同一個地址再申請時順手刪掉，表不會為
 * 每個地址累積超過一列。
 *
 * 不是原子操作：兩個請求剛好同時進來，可能兩個都搶到、寄出兩封。這裡要擋的是
 * 「每秒一封、持續一小時」的轟炸，不是偶爾多一封，所以接受這個競態，不為它
 * 加唯一索引（那需要 migration，也會碰到 better-auth 自己寫這張表的方式）。
 */
export async function claimEmailCooldown(
  kind: EmailCooldownKind,
  email: string,
  seconds = 60,
): Promise<boolean> {
  const db = getDb();
  const identifier = `email-cooldown:${kind}:${email.toLowerCase()}`;
  const now = new Date();

  await db
    .delete(verification)
    .where(and(eq(verification.identifier, identifier), lte(verification.expiresAt, now)));

  const live = await db
    .select({ id: verification.id })
    .from(verification)
    .where(and(eq(verification.identifier, identifier), gt(verification.expiresAt, now)))
    .limit(1);
  if (live.length > 0) return false;

  await db.insert(verification).values({
    id: crypto.randomUUID(),
    identifier,
    value: "1",
    expiresAt: new Date(now.getTime() + seconds * 1000),
  });
  return true;
}
