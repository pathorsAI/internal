import { describe, expect, test } from "bun:test";
import {
  billingAccountRefs,
  checkOrgRefs,
  invoiceResolutionRefs,
  OrgRefError,
  paymentMethodRefs,
  type OrgRefKind,
  type OrgRefLookup,
} from "./guards";

// 兩個組織的假資料：每種參照各自的 id → 所屬組織
const OWNERS: Record<OrgRefKind, Map<number | string, string>> = {
  party: new Map([[1, "org_a"], [2, "org_b"]]),
  paymentMethod: new Map([[10, "org_a"], [20, "org_b"]]),
  bankAccount: new Map([[100, "org_a"], [200, "org_b"]]),
  billingAccount: new Map([[1000, "org_a"], [2000, "org_b"]]),
  invoice: new Map([[5, "org_a"], [6, "org_b"]]),
  transaction: new Map([[7, "org_a"], [8, "org_b"]]),
  member: new Map([["user_a", "org_a"], ["user_b", "org_b"]]),
};

const calls: { kind: OrgRefKind; ids: (number | string)[] }[] = [];
const fakeLookup: OrgRefLookup = async (kind, ids, orgId) => {
  calls.push({ kind, ids });
  return new Set(ids.filter((id) => OWNERS[kind].get(id) === orgId));
};

describe("checkOrgRefs", () => {
  test("accepts references that all belong to the org", async () => {
    await expect(
      checkOrgRefs(fakeLookup, "org_a", billingAccountRefs({ id: 1000, partyId: 1, paymentMethodId: 10, ownerUserId: "user_a" })),
    ).resolves.toBeUndefined();
  });

  test("rejects another org's party on a billing account", async () => {
    await expect(checkOrgRefs(fakeLookup, "org_a", billingAccountRefs({ partyId: 2 }))).rejects.toBeInstanceOf(OrgRefError);
  });

  test("rejects another org's payment method", async () => {
    await expect(checkOrgRefs(fakeLookup, "org_a", billingAccountRefs({ paymentMethodId: 20 }))).rejects.toThrow(/付款方式 20/);
  });

  test("rejects an owner who is not a member of the org", async () => {
    await expect(checkOrgRefs(fakeLookup, "org_a", billingAccountRefs({ ownerUserId: "user_b" }))).rejects.toThrow(/負責人/);
  });

  test("rejects another org's bank account as settles-from account", async () => {
    await expect(
      checkOrgRefs(fakeLookup, "org_a", paymentMethodRefs({ id: 10, settlesFromAccountId: 200 })),
    ).rejects.toThrow(/帳本帳戶 200/);
  });

  test("rejects editing another org's payment method / billing account by id", async () => {
    await expect(checkOrgRefs(fakeLookup, "org_a", paymentMethodRefs({ id: 20 }))).rejects.toBeInstanceOf(OrgRefError);
    await expect(checkOrgRefs(fakeLookup, "org_a", billingAccountRefs({ id: 2000 }))).rejects.toBeInstanceOf(OrgRefError);
  });

  test("rejects linking an invoice to another org's transaction", async () => {
    await expect(
      checkOrgRefs(fakeLookup, "org_a", invoiceResolutionRefs({ invoiceId: 5, transactionId: 8 })),
    ).rejects.toThrow(/交易 8/);
    await expect(checkOrgRefs(fakeLookup, "org_a", invoiceResolutionRefs({ invoiceId: 6 }))).rejects.toThrow(/帳單 6/);
  });

  test("extra match parties are checked too", async () => {
    await expect(checkOrgRefs(fakeLookup, "org_a", { party: [1, 2] })).rejects.toThrow(/交易對象 2/);
  });

  test("null / undefined are allowed and never queried; ids are deduped", async () => {
    calls.length = 0;
    await checkOrgRefs(fakeLookup, "org_a", { party: [null, undefined, 1, 1], paymentMethod: [null] });
    expect(calls).toEqual([{ kind: "party", ids: [1] }]);
  });

  test("non-positive / non-integer ids are rejected without a lookup", async () => {
    calls.length = 0;
    await expect(checkOrgRefs(fakeLookup, "org_a", { party: [-1] })).rejects.toBeInstanceOf(OrgRefError);
    await expect(checkOrgRefs(fakeLookup, "org_a", { party: [1.5] })).rejects.toBeInstanceOf(OrgRefError);
    expect(calls).toEqual([]);
  });

  test("error message does not reveal that the id exists elsewhere", async () => {
    await expect(checkOrgRefs(fakeLookup, "org_a", { party: [2] })).rejects.toThrow("找不到交易對象 2（不在這個組織裡或已刪除）");
  });

  test("an empty org id is refused", async () => {
    await expect(checkOrgRefs(fakeLookup, "", { party: [1] })).rejects.toThrow();
  });
});
