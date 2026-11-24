import { describe, expect, test } from "bun:test";
import { buildSetupPrompt } from "./setup-prompt";

const url = "https://internal.pathors.com/mcp?org=demo";
const connectorName = "Pathors Internal (Demo)";

describe("buildSetupPrompt", () => {
  for (const locale of ["zh-TW", "en"] as const) {
    test(`${locale}: has the org URL, every tool's setup and a verification step`, () => {
      const p = buildSetupPrompt({ locale, mcpUrl: url, connectorName });
      expect(p).toContain(url);
      expect(p).toContain(connectorName);
      expect(p).toContain("Streamable HTTP");
      expect(p).toContain("OAuth");
      expect(p).toContain(`claude mcp add --transport http pathors-internal ${url}`);
      expect(p).toContain('"pathors-internal": {');
      expect(p).toContain("ChatGPT");
      expect(p).toContain("list_organizations");
    });
  }

  test("language follows the UI locale", () => {
    expect(buildSetupPrompt({ locale: "zh-TW", mcpUrl: url, connectorName })).toContain("請幫我");
    expect(buildSetupPrompt({ locale: "en", mcpUrl: url, connectorName })).toContain("Please connect");
  });

  test("the Cursor snippet is valid JSON", () => {
    const p = buildSetupPrompt({ locale: "en", mcpUrl: url, connectorName });
    const json = p.split("```json\n")[1].split("\n```")[0];
    expect(JSON.parse(json)).toEqual({ mcpServers: { "pathors-internal": { url } } });
  });
});
