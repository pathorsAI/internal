import { describe, expect, test } from "bun:test";
import { pickCurrentOrg } from "./current-org";

// 沒指定組織時用哪一個（MCP 的 resolveOrgId、新 session、聊天 bot 都走這個順序）。
describe("pickCurrentOrg", () => {
  const two = [{ id: "org_early" }, { id: "org_late" }];

  test("the current org wins while the user is still a member", () => {
    expect(pickCurrentOrg(two, "org_late")).toBe("org_late");
  });

  test("a stale current org (no longer a member) falls back to the earliest membership", () => {
    expect(pickCurrentOrg(two, "org_gone")).toBe("org_early");
  });

  test("no current org: the only org, else the earliest — never ambiguous", () => {
    expect(pickCurrentOrg([{ id: "only" }], null)).toBe("only");
    expect(pickCurrentOrg(two, null)).toBe("org_early");
    expect(pickCurrentOrg(two, undefined)).toBe("org_early");
  });

  test("no memberships → null", () => {
    expect(pickCurrentOrg([], "org_x")).toBeNull();
  });
});
