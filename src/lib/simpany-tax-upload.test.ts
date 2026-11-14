import { describe, expect, test } from "bun:test";
import { assertTaxFileUpload, SimpanyError } from "./integrations/simpany";
import {
  createUploadSlots,
  fileNameProblem,
  parseTaxUploadHistory,
  parseTaxUploadOptions,
  periodLabel,
  previewTaxUpload,
  receiveSlotUpload,
  submitTaxUpload,
  type StoredObject,
  type TaxUploadStore,
} from "./simpany-tax-upload";

// 實際從 Simpany GET file-upload/initial 拿到的形狀（2026-11-14）。
const INITIAL = {
  allow_period_list: {
    "115-12": "115 年 11、12 月 (開放上傳至 116 年 01 月 13 日前止)",
    "116-2": "116 年 01、02 月 (開放上傳至 116 年 03 月 13 日前止)",
  },
  categories: {
    export_labor_services: {
      name: "外銷勞務",
      subcategories: {
        labor_service: { name: "技術服務、專案服務等", info_link: "https://blog.simpany.co/export-service-0-vat/" },
        app: { name: "APP", info_link: null },
      },
    },
  },
  notice_text: { odd_month_buffer_period_when_submit: "目前選擇的月份，不是正在申報中的 09、10 月哦！" },
};
const OPTIONS = parseTaxUploadOptions(INITIAL);

function memStore(start = new Date("2026-11-14T02:00:00Z")) {
  const objects = new Map<string, StoredObject>();
  let etag = 0;
  let tok = 0;
  let now = start;
  const store: TaxUploadStore & { objects: Map<string, StoredObject>; advance(ms: number): void } = {
    objects,
    advance(ms) {
      now = new Date(now.getTime() + ms);
    },
    async get(key) {
      return objects.get(key) ?? null;
    },
    async put(key, bytes, _ct, onlyIfEtag) {
      if (onlyIfEtag && objects.get(key)?.etag !== onlyIfEtag) return false;
      objects.set(key, { bytes, etag: String(++etag) });
      return true;
    },
    async delete(key) {
      objects.delete(key);
    },
    now: () => now,
    token: () => `tok${String(++tok).padStart(40, "0")}`,
  };
  return store;
}

const PDF = new TextEncoder().encode("%PDF-1.4 test");
const ORG = "org_a";

async function slotWithFile(store: ReturnType<typeof memStore>, name = "Invoice.pdf", org = ORG) {
  const [slot] = await createUploadSlots(store, { orgId: org, userId: "u1", fileNames: [name], baseUrl: "https://x" });
  const res = await receiveSlotUpload(store, slot.uploadId, PDF);
  expect(res.ok).toBe(true);
  return slot;
}

const noDocs = async () => null;

describe("helpers", () => {
  test("periodLabel", () => {
    expect(periodLabel("115-12")).toBe("115 年 11、12 月");
    expect(periodLabel("116-2")).toBe("116 年 01、02 月");
  });

  test("fileNameProblem", () => {
    expect(fileNameProblem("永豐_匯入匯款交易憑證.pdf")).toBeNull();
    expect(fileNameProblem("a.exe")).toContain("格式不支援");
    expect(fileNameProblem("../a.pdf")).toContain("路徑");
    expect(fileNameProblem(`${"a".repeat(100)}.pdf`)).toContain("超過");
  });

  test("parseTaxUploadOptions keeps Simpany's order", () => {
    expect(OPTIONS.periods.map((p) => p.value)).toEqual(["115-12", "116-2"]);
    expect(OPTIONS.categories[0].subcategories.map((s) => s.value)).toEqual(["labor_service", "app"]);
    expect(OPTIONS.offPeriodNotice).toContain("09、10");
  });

  test("parseTaxUploadHistory", () => {
    const page = parseTaxUploadHistory(
      {
        data: [
          {
            hash_id: "yAV459Ysl8djK",
            period_year: 115,
            period_month: 12,
            category: "export_labor_services",
            subcategory: "labor_service",
            note: null,
            created_datetime: "2026-11-14 10:01:24",
            upload_by: "派斯科技股份有限公司",
            files: [{ id: 16939, file_original_name: "MSA.pdf", link: "https://api.simpany.co/v1/13988/file-upload/yAV459Ysl8djK/16939" }],
          },
        ],
        meta: { pagination: { total: 4, current_page: 1, total_pages: 2 } },
      },
      1,
    );
    expect(page.items[0]).toMatchObject({ hashId: "yAV459Ysl8djK", period: "115-12", periodLabel: "115 年 11、12 月" });
    expect(page.items[0].files).toEqual([{ id: 16939, name: "MSA.pdf" }]);
    expect(page.totalPages).toBe(2);
  });

  test("endpoint whitelist", () => {
    expect(() => assertTaxFileUpload("GET", "initial")).not.toThrow();
    expect(() => assertTaxFileUpload("GET", "history", { page: 1, limit: 10 })).not.toThrow();
    expect(() => assertTaxFileUpload("POST", "")).not.toThrow();
    expect(() => assertTaxFileUpload("DELETE", "abc/1")).toThrow(SimpanyError);
    expect(() => assertTaxFileUpload("GET", "history", { q: 1 })).toThrow(SimpanyError);
    expect(() => assertTaxFileUpload("POST", "initial")).toThrow(SimpanyError);
  });
});

describe("upload slots", () => {
  test("single use and expiry", async () => {
    const store = memStore();
    const [a, b] = await createUploadSlots(store, {
      orgId: ORG,
      userId: "u1",
      fileNames: ["a.pdf", "b.pdf"],
      baseUrl: "https://internal.example",
    });
    expect(a.uploadUrl).toBe(`https://internal.example/api/simpany-tax-uploads/${a.uploadId}`);
    expect((await receiveSlotUpload(store, a.uploadId, PDF)).ok).toBe(true);
    expect(await receiveSlotUpload(store, a.uploadId, PDF)).toMatchObject({ ok: false, status: 409 });
    store.advance(31 * 60 * 1000);
    expect(await receiveSlotUpload(store, b.uploadId, PDF)).toMatchObject({ ok: false, status: 410 });
    expect(await receiveSlotUpload(store, "nope", PDF)).toMatchObject({ ok: false, status: 404 });
  });

  test("rejects unsupported names up front", async () => {
    await expect(
      createUploadSlots(memStore(), { orgId: ORG, userId: "u1", fileNames: ["x.zip"], baseUrl: "https://x" }),
    ).rejects.toThrow("格式不支援");
  });
});

describe("preview", () => {
  test("validates period / subcategory and summarises files", async () => {
    const store = memStore();
    const slot = await slotWithFile(store);
    const p = await previewTaxUpload(store, {
      orgId: ORG,
      userId: "u1",
      options: OPTIONS,
      period: "115-12",
      note: "HY16000753",
      files: [{ uploadId: slot.uploadId }, { fileName: "水單.pdf", contentBase64: btoa("%PDF slip") }],
      loadDocument: noDocs,
    });
    expect(p.periodLabel).toBe("115 年 11、12 月");
    expect(p.category).toBe("export_labor_services");
    expect(p.subcategory).toBe("labor_service");
    expect(p.files.map((f) => f.name)).toEqual(["Invoice.pdf", "水單.pdf"]);
    expect(p.warnings.some((w) => w.includes("09、10"))).toBe(true);

    await expect(
      previewTaxUpload(store, { orgId: ORG, userId: "u1", options: OPTIONS, period: "115-10", files: [{ uploadId: slot.uploadId }], loadDocument: noDocs }),
    ).rejects.toThrow("不開放上傳");
    await expect(
      previewTaxUpload(store, { orgId: ORG, userId: "u1", options: OPTIONS, period: "115-12", subcategory: "steam", files: [{ uploadId: slot.uploadId }], loadDocument: noDocs }),
    ).rejects.toThrow("沒有上傳分類");
  });

  test("warns when not Simpany's default period", async () => {
    const store = memStore();
    const slot = await slotWithFile(store);
    const p = await previewTaxUpload(store, { orgId: ORG, userId: "u1", options: OPTIONS, period: "116-2", files: [{ uploadId: slot.uploadId }], loadDocument: noDocs });
    expect(p.warnings.some((w) => w.includes("不是 Simpany 網頁預設"))).toBe(true);
  });

  test("another org's upload is treated as missing", async () => {
    const store = memStore();
    const slot = await slotWithFile(store, "a.pdf", "org_b");
    await expect(
      previewTaxUpload(store, { orgId: ORG, userId: "u1", options: OPTIONS, period: "115-12", files: [{ uploadId: slot.uploadId }], loadDocument: noDocs }),
    ).rejects.toThrow("找不到上傳");
  });

  test("slot not yet uploaded", async () => {
    const store = memStore();
    const [slot] = await createUploadSlots(store, { orgId: ORG, userId: "u1", fileNames: ["a.pdf"], baseUrl: "https://x" });
    await expect(
      previewTaxUpload(store, { orgId: ORG, userId: "u1", options: OPTIONS, period: "115-12", files: [{ uploadId: slot.uploadId }], loadDocument: noDocs }),
    ).rejects.toThrow("還沒傳上來");
  });

  test("uses stored documents", async () => {
    const store = memStore();
    await store.put("orgs/org_a/docs/msa", PDF, "application/pdf");
    const p = await previewTaxUpload(store, {
      orgId: ORG,
      userId: "u1",
      options: OPTIONS,
      period: "115-12",
      files: [{ documentId: 7 }],
      loadDocument: async (id) => (id === 7 ? { r2Key: "orgs/org_a/docs/msa", fileName: "MSA.pdf" } : null),
    });
    expect(p.files[0]).toMatchObject({ name: "MSA.pdf", source: "document", size: PDF.byteLength });
  });
});

describe("submit", () => {
  async function draft(store: ReturnType<typeof memStore>) {
    const slot = await slotWithFile(store);
    return previewTaxUpload(store, { orgId: ORG, userId: "u1", options: OPTIONS, period: "115-12", note: "n", files: [{ uploadId: slot.uploadId }], loadDocument: noDocs });
  }
  const record = { hashId: "H1", period: "115-12", periodLabel: "", category: "", subcategory: "", note: null, createdAt: null, uploadedBy: null, files: [{ id: 1, name: "Invoice.pdf" }] };

  test("sends the exact multipart Simpany's page sends, once", async () => {
    const store = memStore();
    const p = await draft(store);
    let sent: FormData | null = null;
    const res = await submitTaxUpload(store, {
      orgId: ORG,
      draftId: p.draftId,
      submit: async (form) => {
        sent = form;
        return { status: "ok" };
      },
      isRetryable: () => false,
      latestRecords: async () => [record],
    });
    expect(res.hashId).toBe("H1");
    const form = sent as unknown as FormData;
    expect(form.get("period")).toBe("115-12");
    expect(form.get("category")).toBe("export_labor_services");
    expect(form.get("subcategory")).toBe("labor_service");
    expect(form.get("note")).toBe("n");
    const files = form.getAll("files[]") as File[];
    expect(files.map((f) => f.name)).toEqual(["Invoice.pdf"]);
    expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(PDF);
    // 暫存檔已清掉、不能重送
    expect([...store.objects.keys()].some((k) => k.startsWith("simpany-tax/files/"))).toBe(false);
    await expect(
      submitTaxUpload(store, { orgId: ORG, draftId: p.draftId, submit: async () => ({}), isRetryable: () => false, latestRecords: async () => [] }),
    ).rejects.toThrow("已經上傳過了");
  });

  test("other org cannot submit", async () => {
    const store = memStore();
    const p = await draft(store);
    await expect(
      submitTaxUpload(store, { orgId: "org_b", draftId: p.draftId, submit: async () => ({}), isRetryable: () => false, latestRecords: async () => [] }),
    ).rejects.toThrow("找不到草稿");
  });

  test("Simpany rejection → retryable; network error → locked", async () => {
    const store = memStore();
    const p = await draft(store);
    const reject = new SimpanyError("validation", "bad period", 422);
    await expect(
      submitTaxUpload(store, { orgId: ORG, draftId: p.draftId, submit: async () => { throw reject; }, isRetryable: (e) => e === reject, latestRecords: async () => [] }),
    ).rejects.toBe(reject);
    await expect(
      submitTaxUpload(store, { orgId: ORG, draftId: p.draftId, submit: async () => { throw new Error("socket hang up"); }, isRetryable: () => false, latestRecords: async () => [] }),
    ).rejects.toThrow("不確定 Simpany 有沒有收到");
    await expect(
      submitTaxUpload(store, { orgId: ORG, draftId: p.draftId, submit: async () => ({}), isRetryable: () => false, latestRecords: async () => [] }),
    ).rejects.toThrow("結果不明");
  });

  test("expired draft", async () => {
    const store = memStore();
    const p = await draft(store);
    store.advance(2 * 60 * 60 * 1000 + 1);
    await expect(
      submitTaxUpload(store, { orgId: ORG, draftId: p.draftId, submit: async () => ({}), isRetryable: () => false, latestRecords: async () => [] }),
    ).rejects.toThrow("已過期");
  });
});
