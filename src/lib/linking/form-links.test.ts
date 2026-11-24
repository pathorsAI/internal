import { describe, expect, test } from "bun:test";
import { linkPatchFromForm } from "./form-links";

function form(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.set(k, v);
  return fd;
}

describe("linkPatchFromForm", () => {
  test("編輯表單沒有訂閱 / 請款項欄位 → patch 不帶這些 key（保留既有值）", () => {
    const patch = linkPatchFromForm(form({ projectId: "3", contractId: "" }));
    expect(patch).toEqual({ projectId: 3, contractId: null });
    expect("subscriptionId" in patch).toBe(false);
    expect("subscriptionPeriod" in patch).toBe(false);
    expect("billingItemId" in patch).toBe(false);
  });

  test("表單有的欄位照實帶：空字串與 none 是清空", () => {
    expect(
      linkPatchFromForm(
        form({ projectId: "none", subscriptionId: "7", subscriptionPeriod: " 2026-01-01 ", billingItemId: "" }),
      ),
    ).toEqual({ projectId: null, subscriptionId: 7, subscriptionPeriod: "2026-01-01", billingItemId: null });
  });

  test("不是正整數的 id 當作沒選", () => {
    expect(linkPatchFromForm(form({ contractId: "abc", projectId: "-1" }))).toEqual({
      contractId: null,
      projectId: null,
    });
  });

  test("什麼連結欄位都沒有 → 空 patch", () => {
    expect(linkPatchFromForm(form({ amount: "100" }))).toEqual({});
  });
});
