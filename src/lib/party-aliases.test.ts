import { describe, expect, test } from "bun:test";
import {
  isPrefixAlias,
  matchParty,
  mergedAliases,
  normalizeAliases,
  parseAliasesText,
  type PartyCandidate,
} from "./party-aliases";

const p = (id: number, name: string, aliases: string[] = []): PartyCandidate => ({ id, name, aliases });

describe("matchParty", () => {
  test("exact name, case-insensitive and ignoring surrounding whitespace", () => {
    const all = [p(1, "GitHub")];
    expect(matchParty(all, "github")).toBe(1);
    expect(matchParty(all, "  GITHUB ")).toBe(1);
    expect(matchParty(all, "GitHub Inc")).toBeNull();
  });

  test("exact alias, case-insensitive", () => {
    const all = [p(1, "GitHub", ["Github, Inc."]), p(2, "ElevenLabs", ["Elevenlabs.io"])];
    expect(matchParty(all, "GITHUB, INC.")).toBe(1);
    expect(matchParty(all, "elevenlabs.io")).toBe(2);
  });

  test("an alias ending in * is a prefix match", () => {
    const all = [p(1, "Meta Ads", ["Facebk *"]), p(2, "Grab", ["Grab*"])];
    expect(matchParty(all, "Facebk *26qx2aj6e4")).toBe(1);
    expect(matchParty(all, "FACEBK *9kq")).toBe(1);
    expect(matchParty(all, "Grab* A-9p4ckuhgwjnpav")).toBe(2);
    expect(matchParty(all, "grab")).toBe(2);
    // 前綴要從頭對齊，不是包含
    expect(matchParty(all, "Pay Facebk *1")).toBeNull();
    // `Facebk *` 的空白是前綴的一部分
    expect(matchParty(all, "Facebkx")).toBeNull();
  });

  test("priority: exact name > exact alias > prefix alias", () => {
    const all = [p(1, "Grab*", []), p(2, "Other", ["grab* food"]), p(3, "Grab", ["Grab*"])];
    // 名稱完全相同贏過別名與前綴
    expect(matchParty(all, "grab*")).toBe(1);
    // 別名完全相同贏過前綴
    expect(matchParty(all, "Grab* Food")).toBe(2);
    // 只剩前綴
    expect(matchParty(all, "Grab* Taxi")).toBe(3);
  });

  test("exact name beats an alias on a lower id", () => {
    const all = [p(1, "Alpha", ["Beta"]), p(9, "Beta")];
    expect(matchParty(all, "beta")).toBe(9);
  });

  test("longest prefix wins; equal prefixes go to the lowest id", () => {
    const all = [p(5, "Google", ["Google*"]), p(7, "Google Cloud", ["Google *Cloud*"])];
    expect(matchParty(all, "GOOGLE *CLOUD 1234")).toBe(7);
    expect(matchParty(all, "Google *Ads 1234")).toBe(5);

    const tie = [p(8, "B", ["Grab*"]), p(3, "A", ["grab*"])];
    expect(matchParty(tie, "grab x")).toBe(3);
  });

  test("ties on exact name or exact alias go to the lowest id", () => {
    expect(matchParty([p(4, "Acme"), p(2, "ACME")], "acme")).toBe(2);
    expect(matchParty([p(6, "X", ["acme"]), p(3, "Y", ["Acme"])], "ACME")).toBe(3);
  });

  test("deleted parties are excluded by the caller: only passed candidates match", () => {
    // 呼叫端只傳未刪除的；同名的已刪除對象（id 1）不在清單裡，就不會吃到新匯入的交易。
    const live = [p(2, "Notion")];
    expect(matchParty(live, "Notion")).toBe(2);
    expect(matchParty([], "Notion")).toBeNull();
  });

  test("blank names never match, and a bare * alias is ignored", () => {
    const all = [p(1, "Anything", ["*"])];
    expect(matchParty(all, "")).toBeNull();
    expect(matchParty(all, "   ")).toBeNull();
    expect(matchParty(all, "random")).toBeNull();
  });
});

describe("normalizeAliases", () => {
  test("trims, drops blanks and bare *, dedupes case-insensitively keeping the first spelling", () => {
    expect(normalizeAliases(["  Github, Inc. ", "", "github, inc.", "*", " * ", "Grab*", "GRAB*"])).toEqual([
      "Github, Inc.",
      "Grab*",
    ]);
  });

  test("drops aliases equal to the party's own name", () => {
    expect(normalizeAliases(["GitHub", "github", "Github, Inc."], "GitHub")).toEqual(["Github, Inc."]);
  });

  test("isPrefixAlias", () => {
    expect(isPrefixAlias("Facebk *")).toBe(true);
    expect(isPrefixAlias("Grab* ")).toBe(true);
    expect(isPrefixAlias("Github, Inc.")).toBe(false);
  });
});

describe("parseAliasesText", () => {
  test("one alias per line, CRLF tolerant", () => {
    expect(parseAliasesText("Github, Inc.\r\n\nFacebk *\n github, inc. ", "GitHub")).toEqual([
      "Github, Inc.",
      "Facebk *",
    ]);
    expect(parseAliasesText(null)).toEqual([]);
  });
});

describe("mergedAliases", () => {
  test("appends source names and aliases, deduped, skipping the target name", () => {
    const target = { name: "GitHub", aliases: ["Github, Inc."] };
    const sources = [
      { name: "github", aliases: [] },
      { name: "GITHUB, INC.", aliases: ["GitHub Sponsors*"] },
      { name: "Github.com", aliases: ["github sponsors*"] },
    ];
    expect(mergedAliases(target, sources)).toEqual(["Github, Inc.", "GitHub Sponsors*", "Github.com"]);
  });
});
