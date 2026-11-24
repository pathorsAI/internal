import { describe, expect, test } from "bun:test";
import { checkLinkCode } from "./chat";

// 兌換綁定碼前的判斷（純函式，不碰資料庫）。
describe("checkLinkCode", () => {
  const now = Date.parse("2026-11-25T10:00:00Z");
  const fresh = { userId: "u1", usedAt: null, expiresAt: "2026-11-25T10:05:00Z" };

  test("沒用過、沒過期、這個聊天帳號沒綁別人：可以兌換", () => {
    expect(checkLinkCode(fresh, null, now)).toBe("redeem");
    expect(checkLinkCode(fresh, { userId: "u1" }, now)).toBe("redeem");
  });

  test("過期、已綁給別人", () => {
    expect(checkLinkCode({ ...fresh, expiresAt: "2026-11-25T09:59:59Z" }, null, now)).toBe("expired");
    expect(checkLinkCode(fresh, { userId: "u2" }, now)).toBe("taken");
  });

  test("同一個人重傳同一句「綁定 123456」：已經綁好了，不回「用過了」", () => {
    const used = { ...fresh, usedAt: "2026-11-25T09:58:00Z" };
    expect(checkLinkCode(used, { userId: "u1" }, now)).toBe("already");
    // 用過了、過期也一樣（重傳可能晚於 10 分鐘）
    expect(checkLinkCode({ ...used, expiresAt: "2026-11-25T09:00:00Z" }, { userId: "u1" }, now)).toBe("already");
  });

  test("用過的碼被別的聊天帳號拿來用：照樣拒絕", () => {
    const used = { ...fresh, usedAt: "2026-11-25T09:58:00Z" };
    expect(checkLinkCode(used, null, now)).toBe("used");
    expect(checkLinkCode(used, { userId: "u2" }, now)).toBe("used");
  });
});
