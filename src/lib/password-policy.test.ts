import { describe, expect, test } from "bun:test";
import { checkNewPassword } from "./password-policy";

describe("checkNewPassword", () => {
  test("12 characters that match is accepted", () => {
    expect(checkNewPassword("abcdefghijkl", "abcdefghijkl")).toBeNull();
  });

  test("11 characters is too short", () => {
    expect(checkNewPassword("abcdefghijk", "abcdefghijk")).toBe("tooShort");
  });

  test("long enough but different", () => {
    expect(checkNewPassword("abcdefghijkl", "abcdefghijkm")).toBe("mismatch");
  });
});
