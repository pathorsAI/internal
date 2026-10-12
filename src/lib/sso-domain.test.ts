import { describe, expect, test } from "bun:test";
import { domainMatches } from "./sso-domain";

// 這個函式決定「誰不准自助註冊」，必須跟 @better-auth/sso 決定「誰在登入頁被導去
// IdP」的那份完全一致，所以每個案例都對照 plugin 的行為。
describe("domainMatches", () => {
  test("exact domain", () => {
    expect(domainMatches("acme.com", "acme.com")).toBe(true);
  });

  test("subdomain of a listed domain", () => {
    expect(domainMatches("tw.acme.com", "acme.com")).toBe(true);
  });

  test("comma-separated list with spaces", () => {
    expect(domainMatches("acme.io", "acme.com, acme.io ,acme.co.jp")).toBe(true);
    expect(domainMatches("acme.co.jp", "acme.com, acme.io ,acme.co.jp")).toBe(true);
  });

  test("case-insensitive on both sides", () => {
    expect(domainMatches("ACME.com", "Acme.COM")).toBe(true);
  });

  test("a domain that merely ends with the same letters does not match", () => {
    expect(domainMatches("evilacme.com", "acme.com")).toBe(false);
  });

  test("a parent domain does not match a listed subdomain", () => {
    expect(domainMatches("acme.com", "tw.acme.com")).toBe(false);
  });

  test("empty entries in the list match nothing", () => {
    expect(domainMatches("acme.com", " , ,")).toBe(false);
  });
});
