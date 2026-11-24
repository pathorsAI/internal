import { describe, expect, test } from "bun:test";
import { parseDocKind, parseDocumentIds } from "@/db/chat";
import { submitAdvanceArgs, transactionTools } from "./tools-transactions";

describe("submit_advance arguments", () => {
  test("maps to an advance with the receipt fields", () => {
    expect(
      submitAdvanceArgs({
        date: "2026-11-22",
        amount: 2400,
        partyName: "台灣大車隊",
        description: "計程車 發票 AB12345678",
        categoryId: 5,
        documentIds: [12, 12, "13"],
        docKind: "e_invoice",
        billedToCompanyTaxId: true,
        organizationId: "org_1",
      }),
    ).toEqual({
      type: "advance",
      txnDate: "2026-11-22",
      amount: 2400,
      partyName: "台灣大車隊",
      description: "計程車 發票 AB12345678",
      categoryId: 5,
      documentIds: [12, 13],
      docKind: "e_invoice",
      billedToCompanyTaxId: true,
      organizationId: "org_1",
    });
  });

  test("rejects missing or bad fields before touching the database", () => {
    const ok = { date: "2026-11-22", amount: 100, partyName: "店", description: "午餐" };
    expect(() => submitAdvanceArgs({ ...ok, date: "11/22" })).toThrow(/date/);
    expect(() => submitAdvanceArgs({ ...ok, amount: 0 })).toThrow(/greater than 0/);
    expect(() => submitAdvanceArgs({ ...ok, partyName: " " })).toThrow(/partyName/);
    expect(() => submitAdvanceArgs({ ...ok, description: undefined })).toThrow(/description/);
    expect(() => submitAdvanceArgs({ ...ok, documentIds: "12" })).toThrow(/documentIds/);
    expect(() => submitAdvanceArgs({ ...ok, documentIds: [0] })).toThrow(/positive integer/);
    expect(() => submitAdvanceArgs({ ...ok, docKind: "photo" })).toThrow(/docKind/);
    // 代墊人不能自己指定：參數裡根本沒有 settleEmployeeName
    expect(submitAdvanceArgs({ ...ok, settleEmployeeName: "別人" })).not.toHaveProperty("settleEmployeeName");
  });

  test("schema: required fields, documentIds on create/update_transaction too", () => {
    const schema = transactionTools.submit_advance.inputSchema;
    expect(schema.required).toEqual(["date", "amount", "partyName", "description"]);
    expect(schema.properties).not.toHaveProperty("settleEmployeeName");
    expect(transactionTools.create_transaction.inputSchema.properties).toHaveProperty("documentIds");
    expect(transactionTools.update_transaction.inputSchema.properties).toHaveProperty("docKind");
  });

  test("document id and kind parsing", () => {
    expect(parseDocumentIds(undefined)).toEqual([]);
    expect(() => parseDocumentIds(Array.from({ length: 21 }, (_, i) => i + 1))).toThrow(/20/);
    expect(parseDocKind("")).toBeUndefined();
    expect(parseDocKind("receipt")).toBe("receipt");
  });
});
