import { describe, expect, test } from "bun:test";
import { tools } from "@/lib/mcp/tools";
import { assistantSchema, buildToolSpecs, prepareArgs, type OrgScope } from "./tool-specs";
import { bestRole, canRunInOrg, roleIn } from "./tool-policy";

const scope: OrgScope = {
  currentOrgId: "org_p",
  orgs: [
    { id: "org_p", name: "派斯科技", slug: "pathors", logo: null, role: "admin" },
    { id: "org_d", name: "東蜂科技", slug: "dongfeng", logo: null, role: "member" },
  ],
};

describe("prepareArgs organization", () => {
  test("no organizationId → the current org", () => {
    expect(prepareArgs('{"limit":5}', scope).args).toEqual({ limit: 5, organizationId: "org_p" });
  });

  test("accepts another org of the user by id or slug and resolves it to the id", () => {
    expect(prepareArgs('{"organizationId":"dongfeng"}', scope).args.organizationId).toBe("org_d");
    expect(prepareArgs('{"organizationId":"org_d"}', scope).args.organizationId).toBe("org_d");
  });

  test("rejects an org the user does not belong to instead of replacing it", () => {
    expect(() => prepareArgs('{"organizationId":"evil"}', scope)).toThrow(/not a member/);
  });

  test("a bare org id (single-org caller) still works", () => {
    expect(prepareArgs("{}", "org_1").args.organizationId).toBe("org_1");
    expect(() => prepareArgs('{"organizationId":"org_2"}', "org_1")).toThrow(/not a member/);
  });

  test("confirmSummary is split off", () => {
    const out = prepareArgs('{"amount":1,"confirmSummary":" 記一筆 "}', scope);
    expect(out.summary).toBe("記一筆");
    expect(out.args).not.toHaveProperty("confirmSummary");
  });
});

describe("organizationId in the tool schema", () => {
  test("multi-org users see an enum of their orgs, described with names", () => {
    const schema = assistantSchema("list_contracts", tools.list_contracts.inputSchema, scope);
    const org = schema.properties.organizationId as { enum: string[]; description: string };
    expect(org.enum).toEqual(["pathors", "dongfeng"]);
    expect(org.description).toContain("東蜂科技");
    expect(org.description).toContain("current organization (派斯科技)");
    expect(schema.required ?? []).not.toContain("organizationId");
  });

  test("single-org users do not see organizationId", () => {
    const single: OrgScope = { currentOrgId: "org_p", orgs: [scope.orgs[0]] };
    expect(assistantSchema("list_contracts", tools.list_contracts.inputSchema, single).properties).not.toHaveProperty(
      "organizationId",
    );
    expect(assistantSchema("list_contracts", tools.list_contracts.inputSchema).properties).not.toHaveProperty(
      "organizationId",
    );
  });

  test("write tools are offered when the user can write in at least one org", () => {
    const names = buildToolSpecs(["ledger"], bestRole(scope.orgs.map((o) => o.role)), "web", scope).map(
      (t) => t.function.name,
    );
    expect(names).toContain("create_transaction");
  });
});

describe("role per target org", () => {
  test("roleIn / bestRole", () => {
    expect(roleIn(scope.orgs, "org_d")).toBe("member");
    expect(roleIn(scope.orgs, "nope")).toBeNull();
    expect(bestRole(["member", "admin", null])).toBe("admin");
    expect(bestRole(["admin", "owner"])).toBe("owner");
    expect(bestRole([null])).toBeNull();
  });

  test("writes need owner/admin in the org the call targets", () => {
    const write = { amount: 1 };
    expect(canRunInOrg("create_transaction", { ...write, organizationId: "org_p" }, scope.orgs)).toBe(true);
    expect(canRunInOrg("create_transaction", { ...write, organizationId: "org_d" }, scope.orgs)).toBe(false);
    expect(canRunInOrg("create_transaction", { ...write, organizationId: "org_x" }, scope.orgs)).toBe(false);
    // 只讀在任何一個所屬組織都可以；不是成員的組織，canRunInOrg 不擋讀（prepareArgs 已經擋掉）
    expect(canRunInOrg("list_contracts", { organizationId: "org_d" }, scope.orgs)).toBe(true);
    // 成員也能用的寫入（提交自己的代墊）只要是那個組織的成員
    expect(canRunInOrg("submit_advance", { organizationId: "org_d" }, scope.orgs)).toBe(true);
    expect(canRunInOrg("submit_advance", { organizationId: "org_x" }, scope.orgs)).toBe(false);
  });
});
