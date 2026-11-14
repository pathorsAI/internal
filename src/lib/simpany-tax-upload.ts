/**
 * Simpany「稅務申報 › 申報檔案上傳」（member.simpany.co/file-upload）。
 *
 * 外銷勞務零稅率每期要附 Invoice、合約、銀行水單。Simpany 只有網頁拖檔，這裡把它接成
 * 三段式，讓 Claude 不用經過瀏覽器的檔案選擇器：
 *
 *   1. createUploadSlots —— 為每個檔案開一個一次性上傳網址（PUT，30 分鐘內有效）。
 *      本機用 `curl -T <檔案> <網址>` 傳上來，檔案位元組不經過對話。網址本身就是憑證
 *      （256-bit 隨機 token），只能用一次，檔名與副檔名在開網址時就定好。
 *   2. previewTaxUpload —— 收 uploadId / 系統內既有文件（documents）/ 小檔 base64，
 *      對照 Simpany 當下的選項（可上傳月份、分類）驗證，寫一份草稿，回傳給使用者確認。
 *   3. submitTaxUpload(draftId) —— 使用者明確同意後，原封不動把草稿裡的檔案送給 Simpany。
 *      只收 draftId，所以「使用者看過的」就是「送出去的」；送出前重新比對 SHA-256。
 *
 * 草稿與暫存檔都放 R2（simpany-tax/…），不進 DB：不用 migration，也不把檔案塞進資料庫。
 * 單次使用靠 R2 的條件寫入（etag）保證。這個模組不直接碰 R2 / Simpany，吃一組 deps，
 * 正式環境見 simpany-tax-upload-r2.ts，測試塞假的。
 */

// ---------------------------------------------------------------------------
// Simpany 前端的限制（member.simpany.co FileUpload 頁面 bundle）
// ---------------------------------------------------------------------------

export const TAX_UPLOAD_EXTS = ["pdf", "jpg", "jpeg", "png", "bmp", "csv", "xls", "xlsx", "doc", "docx"] as const;
export const TAX_UPLOAD_MAX_FILES = 20;
export const TAX_UPLOAD_MAX_TOTAL_BYTES = 50 * 1024 * 1024;
export const TAX_UPLOAD_MAX_NAME_LENGTH = 100;
export const TAX_UPLOAD_MAX_NOTE_LENGTH = 255;
/** 這頁目前只支援外銷勞務（Simpany 的上傳類型下拉選單是鎖死的）。 */
export const TAX_UPLOAD_DEFAULT_CATEGORY = "export_labor_services";
export const TAX_UPLOAD_DEFAULT_SUBCATEGORY = "labor_service";

/** base64 只給很小的檔案用（會整份經過對話），大檔一律走上傳網址。 */
export const TAX_UPLOAD_MAX_BASE64_BYTES = 2 * 1024 * 1024;
export const SLOT_TTL_MS = 30 * 60 * 1000;
export const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  bmp: "image/bmp",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export class TaxUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaxUploadError";
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  return null;
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i > 0 ? name.slice(i + 1).toLowerCase() : "";
}

export function contentTypeFor(name: string): string {
  return CONTENT_TYPES[extOf(name)] ?? "application/octet-stream";
}

/** 檔名不合 Simpany 規則時回傳中文原因，合法回 null。 */
export function fileNameProblem(name: string): string | null {
  if (!name.trim()) return "檔名是空的";
  if (/[/\\\u0000-\u001f]/.test(name)) return `檔名「${name}」含路徑或控制字元`;
  if (name.length > TAX_UPLOAD_MAX_NAME_LENGTH) {
    return `檔名「${name}」超過 ${TAX_UPLOAD_MAX_NAME_LENGTH} 字（Simpany 會拒收）`;
  }
  const ext = extOf(name);
  if (!(TAX_UPLOAD_EXTS as readonly string[]).includes(ext)) {
    return `檔名「${name}」的格式不支援，只收 ${TAX_UPLOAD_EXTS.join("、")}`;
  }
  return null;
}

/** "115-12" → "115 年 11、12 月"（Simpany 以雙月期的後一個月代表那一期）。 */
export function periodLabel(period: string): string {
  const m = /^(\d{2,3})-(\d{1,2})$/.exec(period);
  if (!m) return period;
  const end = Number(m[2]);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${m[1]} 年 ${pad(end - 1)}、${pad(end)} 月`;
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

export type TaxUploadSubcategory = { value: string; label: string; infoLink: string | null };
export type TaxUploadCategory = { value: string; label: string; subcategories: TaxUploadSubcategory[] };
export type TaxUploadOptions = {
  /** Simpany 給的順序（第一個是網頁預設選的那期）。 */
  periods: { value: string; label: string }[];
  categories: TaxUploadCategory[];
  /** 選了非當期月份時 Simpany 網頁會跳的提醒。 */
  offPeriodNotice: string | null;
};

/** 解析 GET file-upload/initial 的 data。 */
export function parseTaxUploadOptions(data: unknown): TaxUploadOptions {
  const d = isObj(data) ? data : {};
  const periods = isObj(d.allow_period_list)
    ? Object.entries(d.allow_period_list).map(([value, label]) => ({ value, label: str(label) ?? value }))
    : [];
  const categories: TaxUploadCategory[] = isObj(d.categories)
    ? Object.entries(d.categories).map(([value, c]) => {
        const cat = isObj(c) ? c : {};
        const subs = isObj(cat.subcategories) ? cat.subcategories : {};
        return {
          value,
          label: str(cat.name) ?? value,
          subcategories: Object.entries(subs).map(([sv, s]) => ({
            value: sv,
            label: str(isObj(s) ? s.name : null) ?? sv,
            infoLink: str(isObj(s) ? s.info_link : null),
          })),
        };
      })
    : [];
  const notice = isObj(d.notice_text) ? str(d.notice_text.odd_month_buffer_period_when_submit) : null;
  return { periods, categories, offPeriodNotice: notice };
}

export type TaxUploadRecord = {
  hashId: string;
  period: string;
  periodLabel: string;
  category: string;
  subcategory: string;
  note: string | null;
  createdAt: string | null;
  uploadedBy: string | null;
  files: { id: number; name: string }[];
};

export type TaxUploadHistoryPage = {
  items: TaxUploadRecord[];
  page: number;
  totalPages: number;
  total: number;
};

/** 解析 GET file-upload/history 的完整 body。 */
export function parseTaxUploadHistory(body: unknown, page: number): TaxUploadHistoryPage {
  const b = isObj(body) ? body : {};
  const rows = Array.isArray(b.data) ? b.data : [];
  const items: TaxUploadRecord[] = [];
  for (const r of rows) {
    if (!isObj(r)) continue;
    const hashId = str(r.hash_id);
    if (!hashId) continue;
    const period = `${str(r.period_year) ?? "?"}-${str(r.period_month) ?? "?"}`;
    items.push({
      hashId,
      period,
      periodLabel: periodLabel(period),
      category: str(r.category) ?? "",
      subcategory: str(r.subcategory) ?? "",
      note: str(r.note),
      createdAt: str(r.created_datetime),
      uploadedBy: str(r.upload_by),
      files: (Array.isArray(r.files) ? r.files : [])
        .filter(isObj)
        .map((f) => ({ id: Number(f.id), name: str(f.file_original_name) ?? "" })),
    });
  }
  const meta = isObj(b.meta) && isObj(b.meta.pagination) ? b.meta.pagination : {};
  return {
    items,
    page: Number(meta.current_page) || page,
    totalPages: Number(meta.total_pages) || 1,
    total: Number(meta.total) || items.length,
  };
}

// ---------------------------------------------------------------------------
// Store (R2) abstraction
// ---------------------------------------------------------------------------

export type StoredObject = { bytes: Uint8Array; etag: string };

export type TaxUploadStore = {
  get(key: string): Promise<StoredObject | null>;
  /** onlyIfEtag 有給時是條件寫入；條件不成立回 false。 */
  put(key: string, bytes: Uint8Array, contentType: string, onlyIfEtag?: string): Promise<boolean>;
  delete(key: string): Promise<void>;
  now(): Date;
  /** URL-safe、≥ 256 bit 的隨機字串。 */
  token(): string;
};

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function isValidToken(t: string): boolean {
  return TOKEN_RE.test(t);
}

const slotKey = (token: string) => `simpany-tax/slots/${token}.json`;
const fileKey = (orgId: string, token: string) => `simpany-tax/files/${orgId}/${token}`;
const draftKey = (id: string) => `simpany-tax/drafts/${id}.json`;

const enc = new TextEncoder();
const dec = new TextDecoder();

async function readJson<T>(store: TaxUploadStore, key: string): Promise<{ value: T; etag: string } | null> {
  const obj = await store.get(key);
  if (!obj) return null;
  try {
    return { value: JSON.parse(dec.decode(obj.bytes)) as T, etag: obj.etag };
  } catch {
    return null;
  }
}

function writeJson(store: TaxUploadStore, key: string, value: unknown, onlyIfEtag?: string): Promise<boolean> {
  return store.put(key, enc.encode(JSON.stringify(value)), "application/json", onlyIfEtag);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// 1. Upload slots
// ---------------------------------------------------------------------------

type SlotRecord = {
  orgId: string;
  userId: string;
  fileName: string;
  createdAt: string;
  expiresAt: string;
  /** null = 還沒傳。 */
  uploaded: { size: number; sha256: string; at: string } | null;
};

export type UploadSlot = { uploadId: string; fileName: string; uploadUrl: string; expiresAt: string };

export async function createUploadSlots(
  store: TaxUploadStore,
  input: { orgId: string; userId: string; fileNames: string[]; baseUrl: string },
): Promise<UploadSlot[]> {
  if (input.fileNames.length === 0) throw new TaxUploadError("至少要給一個檔名");
  if (input.fileNames.length > TAX_UPLOAD_MAX_FILES) {
    throw new TaxUploadError(`一次最多 ${TAX_UPLOAD_MAX_FILES} 個檔案`);
  }
  const problems = input.fileNames.map(fileNameProblem).filter((p): p is string => p !== null);
  if (problems.length) throw new TaxUploadError(problems.join("；"));
  const now = store.now();
  const expiresAt = new Date(now.getTime() + SLOT_TTL_MS).toISOString();
  const slots: UploadSlot[] = [];
  for (const fileName of input.fileNames) {
    const token = store.token();
    const rec: SlotRecord = {
      orgId: input.orgId,
      userId: input.userId,
      fileName,
      createdAt: now.toISOString(),
      expiresAt,
      uploaded: null,
    };
    await writeJson(store, slotKey(token), rec);
    slots.push({
      uploadId: token,
      fileName,
      uploadUrl: `${input.baseUrl}/api/simpany-tax-uploads/${token}`,
      expiresAt,
    });
  }
  return slots;
}

export type SlotUploadResult =
  | { ok: true; uploadId: string; fileName: string; size: number; sha256: string }
  | { ok: false; status: number; error: string };

/** PUT /api/simpany-tax-uploads/{token} 的本體。網址就是憑證，所以失敗訊息不透露任何組織資訊。 */
export async function receiveSlotUpload(
  store: TaxUploadStore,
  token: string,
  bytes: Uint8Array,
): Promise<SlotUploadResult> {
  if (!isValidToken(token)) return { ok: false, status: 404, error: "not found" };
  const slot = await readJson<SlotRecord>(store, slotKey(token));
  if (!slot) return { ok: false, status: 404, error: "not found" };
  if (slot.value.uploaded) return { ok: false, status: 409, error: "this upload URL was already used; create a new one" };
  if (store.now().getTime() > Date.parse(slot.value.expiresAt)) {
    return { ok: false, status: 410, error: "this upload URL expired; create a new one" };
  }
  if (bytes.byteLength === 0) return { ok: false, status: 400, error: "empty body" };
  if (bytes.byteLength > TAX_UPLOAD_MAX_TOTAL_BYTES) {
    return { ok: false, status: 413, error: `file exceeds ${formatBytes(TAX_UPLOAD_MAX_TOTAL_BYTES)}` };
  }
  const sha256 = await sha256Hex(bytes);
  // 先佔住 slot（條件寫入），再寫檔：兩個同時 PUT 只有一個會成功。
  const claimed = await writeJson(
    store,
    slotKey(token),
    { ...slot.value, uploaded: { size: bytes.byteLength, sha256, at: store.now().toISOString() } },
    slot.etag,
  );
  if (!claimed) return { ok: false, status: 409, error: "this upload URL was already used; create a new one" };
  await store.put(fileKey(slot.value.orgId, token), bytes, contentTypeFor(slot.value.fileName));
  return { ok: true, uploadId: token, fileName: slot.value.fileName, size: bytes.byteLength, sha256 };
}

// ---------------------------------------------------------------------------
// 2. Preview → draft
// ---------------------------------------------------------------------------

export type TaxFileRef =
  | { uploadId: string; fileName?: string }
  | { documentId: number; fileName?: string }
  | { fileName: string; contentBase64: string };

export type DocumentRow = { r2Key: string; fileName: string | null };

type DraftFile = {
  key: string;
  name: string;
  size: number;
  sha256: string;
  contentType: string;
  source: "upload" | "document" | "base64";
  /** true = 暫存檔（上傳網址或 base64），送出成功後刪掉；false = 系統內既有文件，不能刪。 */
  staged: boolean;
};

type DraftStatus = "pending" | "submitting" | "submitted" | "failed";

type DraftRecord = {
  id: string;
  orgId: string;
  userId: string;
  status: DraftStatus;
  createdAt: string;
  expiresAt: string;
  period: string;
  category: string;
  subcategory: string;
  note: string;
  files: DraftFile[];
  result?: { at: string; hashId: string | null; error?: string };
};

export type TaxUploadPreview = {
  draftId: string;
  expiresAt: string;
  period: string;
  periodLabel: string;
  periodOptionLabel: string;
  category: string;
  categoryLabel: string;
  subcategory: string;
  subcategoryLabel: string;
  note: string;
  files: { name: string; size: number; sizeLabel: string; sha256: string; source: DraftFile["source"] }[];
  totalSize: number;
  warnings: string[];
};

function decodeBase64(raw: string): Uint8Array {
  const body = raw.startsWith("data:") ? raw.slice(raw.indexOf(",") + 1) : raw;
  const s = body.replaceAll(/\s+/g, "");
  if (!/^[A-Za-z0-9+/_-]*={0,2}$/.test(s)) throw new TaxUploadError("contentBase64 不是合法的 base64");
  const bin = atob(s.replaceAll("-", "+").replaceAll("_", "/"));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.codePointAt(i) ?? 0;
  return out;
}

type PreviewInput = {
  orgId: string;
  userId: string;
  options: TaxUploadOptions;
  period: string;
  category?: string;
  subcategory?: string;
  note?: string;
  files: TaxFileRef[];
  loadDocument(id: number): Promise<DocumentRow | null>;
};

function resolvePeriod(options: TaxUploadOptions, period: string, warnings: string[]) {
  const periodOpt = options.periods.find((p) => p.value === period);
  if (!periodOpt) {
    const choices = options.periods.map((p) => `${p.value}（${p.label}）`).join("、");
    throw new TaxUploadError(
      `Simpany 目前不開放上傳 ${period}（${periodLabel(period)}）。可選：${choices || "（Simpany 沒有回傳任何可上傳月份）"}`,
    );
  }
  const first = options.periods[0];
  if (first && first.value !== period) {
    warnings.push(
      `${periodLabel(period)} 不是 Simpany 網頁預設的那一期（${first.label}）。Simpany 網頁對這種選擇會跳提醒，請確認申報月份正確。`,
    );
  }
  if (options.offPeriodNotice) warnings.push(`Simpany 送出前的提醒：${options.offPeriodNotice}`);
  return periodOpt;
}

function resolveCategory(options: TaxUploadOptions, categoryValue: string, subValue: string) {
  const category = options.categories.find((c) => c.value === categoryValue);
  if (!category) {
    const choices = options.categories.map((c) => `${c.value}（${c.label}）`).join("、");
    throw new TaxUploadError(`Simpany 沒有上傳類型 ${categoryValue}。可選：${choices}`);
  }
  const sub = category.subcategories.find((x) => x.value === subValue);
  if (!sub) {
    const choices = category.subcategories.map((x) => `${x.value}（${x.label}）`).join("、");
    throw new TaxUploadError(`${category.label} 底下沒有上傳分類 ${subValue}。可選：${choices}`);
  }
  return { category, sub };
}

async function resolveUploadRef(
  store: TaxUploadStore,
  orgId: string,
  ref: { uploadId: string; fileName?: string },
  label: string,
): Promise<DraftFile> {
  if (!isValidToken(ref.uploadId)) throw new TaxUploadError(`${label}：uploadId 格式不對`);
  const slot = await readJson<SlotRecord>(store, slotKey(ref.uploadId));
  // 別的組織的 slot 一律當作不存在。
  if (slot?.value.orgId !== orgId) throw new TaxUploadError(`${label}：找不到上傳 ${ref.uploadId}`);
  const uploaded = slot.value.uploaded;
  if (!uploaded) {
    throw new TaxUploadError(`${label}：「${slot.value.fileName}」還沒傳上來（先對上傳網址 PUT 檔案）`);
  }
  const name = ref.fileName ?? slot.value.fileName;
  return {
    key: fileKey(orgId, ref.uploadId),
    name,
    size: uploaded.size,
    sha256: uploaded.sha256,
    contentType: contentTypeFor(name),
    source: "upload",
    staged: true,
  };
}

async function resolveDocumentRef(
  store: TaxUploadStore,
  ref: { documentId: number; fileName?: string },
  label: string,
  loadDocument: PreviewInput["loadDocument"],
): Promise<DraftFile> {
  const doc = await loadDocument(ref.documentId);
  if (!doc?.r2Key || doc.r2Key.startsWith("meta/")) {
    throw new TaxUploadError(`${label}：找不到文件 #${ref.documentId}`);
  }
  const obj = await store.get(doc.r2Key);
  if (!obj) throw new TaxUploadError(`${label}：文件 #${ref.documentId} 的檔案不在儲存空間裡`);
  const name = ref.fileName ?? doc.fileName ?? `document-${ref.documentId}.pdf`;
  return {
    key: doc.r2Key,
    name,
    size: obj.bytes.byteLength,
    sha256: await sha256Hex(obj.bytes),
    contentType: contentTypeFor(name),
    source: "document",
    staged: false,
  };
}

async function resolveBase64Ref(
  store: TaxUploadStore,
  orgId: string,
  ref: { fileName: string; contentBase64: string },
  bytes: Uint8Array,
): Promise<DraftFile> {
  const key = fileKey(orgId, store.token());
  await store.put(key, bytes, contentTypeFor(ref.fileName));
  return {
    key,
    name: ref.fileName,
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
    contentType: contentTypeFor(ref.fileName),
    source: "base64",
    staged: true,
  };
}

async function resolveFiles(store: TaxUploadStore, input: PreviewInput): Promise<DraftFile[]> {
  if (input.files.length === 0) throw new TaxUploadError("至少要附一個檔案");
  if (input.files.length > TAX_UPLOAD_MAX_FILES) throw new TaxUploadError(`一次最多 ${TAX_UPLOAD_MAX_FILES} 個檔案`);
  const files: DraftFile[] = [];
  let base64Total = 0;
  for (const [i, ref] of input.files.entries()) {
    const label = `files[${i}]`;
    if ("uploadId" in ref) {
      files.push(await resolveUploadRef(store, input.orgId, ref, label));
      continue;
    }
    if ("documentId" in ref) {
      files.push(await resolveDocumentRef(store, ref, label, input.loadDocument));
      continue;
    }
    const bytes = decodeBase64(ref.contentBase64);
    if (bytes.byteLength === 0) throw new TaxUploadError(`${label}：檔案是空的`);
    base64Total += bytes.byteLength;
    if (base64Total > TAX_UPLOAD_MAX_BASE64_BYTES) {
      throw new TaxUploadError(
        `base64 檔案合計超過 ${formatBytes(TAX_UPLOAD_MAX_BASE64_BYTES)}，請改用 simpany_create_tax_upload_slots 開上傳網址`,
      );
    }
    files.push(await resolveBase64Ref(store, input.orgId, ref, bytes));
  }
  return files;
}

/** 檔名 / 總量檢查（擋）與重複檔案（提醒）。回傳總大小。 */
function checkFiles(files: DraftFile[], warnings: string[]): number {
  const problems = files.map((f) => fileNameProblem(f.name)).filter((p): p is string => p !== null);
  if (problems.length) throw new TaxUploadError(problems.join("；"));
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > TAX_UPLOAD_MAX_TOTAL_BYTES) {
    throw new TaxUploadError(
      `檔案合計 ${formatBytes(totalSize)}，超過 Simpany 單次上限 ${formatBytes(TAX_UPLOAD_MAX_TOTAL_BYTES)}`,
    );
  }
  const seenNames = new Set<string>();
  const seenHashes = new Map<string, string>();
  for (const f of files) {
    if (seenNames.has(f.name)) warnings.push(`有兩個檔案都叫「${f.name}」`);
    seenNames.add(f.name);
    const dup = seenHashes.get(f.sha256);
    if (dup) warnings.push(`「${f.name}」與「${dup}」內容完全相同`);
    seenHashes.set(f.sha256, f.name);
  }
  return totalSize;
}

export async function previewTaxUpload(store: TaxUploadStore, input: PreviewInput): Promise<TaxUploadPreview> {
  const warnings: string[] = [];
  const periodOpt = resolvePeriod(input.options, input.period, warnings);
  const { category, sub } = resolveCategory(
    input.options,
    input.category ?? TAX_UPLOAD_DEFAULT_CATEGORY,
    input.subcategory ?? TAX_UPLOAD_DEFAULT_SUBCATEGORY,
  );
  const note = (input.note ?? "").trim();
  if (note.length > TAX_UPLOAD_MAX_NOTE_LENGTH) {
    throw new TaxUploadError(`備註最多 ${TAX_UPLOAD_MAX_NOTE_LENGTH} 字（現在 ${note.length} 字）`);
  }
  const files = await resolveFiles(store, input);
  const totalSize = checkFiles(files, warnings);

  const now = store.now();
  const draft: DraftRecord = {
    id: store.token(),
    orgId: input.orgId,
    userId: input.userId,
    status: "pending",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + DRAFT_TTL_MS).toISOString(),
    period: input.period,
    category: category.value,
    subcategory: sub.value,
    note,
    files,
  };
  await writeJson(store, draftKey(draft.id), draft);

  return {
    draftId: draft.id,
    expiresAt: draft.expiresAt,
    period: draft.period,
    periodLabel: periodLabel(draft.period),
    periodOptionLabel: periodOpt.label,
    category: category.value,
    categoryLabel: category.label,
    subcategory: sub.value,
    subcategoryLabel: sub.label,
    note,
    files: files.map((f) => ({
      name: f.name,
      size: f.size,
      sizeLabel: formatBytes(f.size),
      sha256: f.sha256,
      source: f.source,
    })),
    totalSize,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// 3. Submit
// ---------------------------------------------------------------------------

export type TaxUploadSubmitResult = {
  draftId: string;
  period: string;
  periodLabel: string;
  files: string[];
  /** Simpany 上傳紀錄的流水號；送出成功但在紀錄裡對不到時為 null。 */
  hashId: string | null;
  record: TaxUploadRecord | null;
};

type SubmitInput = {
  orgId: string;
  draftId: string;
  submit(form: FormData): Promise<unknown>;
  isRetryable(e: unknown): boolean;
  /** 送出後讀上傳紀錄第一頁，用來找出剛剛那筆。 */
  latestRecords(): Promise<TaxUploadRecord[]>;
};

/** 讀草稿並確認它現在可以送出；回傳草稿與它的 etag。 */
async function loadSubmittableDraft(
  store: TaxUploadStore,
  orgId: string,
  draftId: string,
): Promise<{ value: DraftRecord; etag: string }> {
  if (!isValidToken(draftId)) throw new TaxUploadError(`找不到草稿 ${draftId}`);
  const found = await readJson<DraftRecord>(store, draftKey(draftId));
  if (found?.value.orgId !== orgId) throw new TaxUploadError(`找不到草稿 ${draftId}`);
  const draft = found.value;
  if (draft.status === "submitted") {
    throw new TaxUploadError(`草稿 ${draft.id} 已經上傳過了（流水號 ${draft.result?.hashId ?? "未知"}），不會重複上傳`);
  }
  if (draft.status === "submitting") throw new TaxUploadError(`草稿 ${draft.id} 正在上傳中`);
  if (draft.status === "failed") {
    throw new TaxUploadError(
      `草稿 ${draft.id} 上次送出時結果不明（${draft.result?.error ?? ""}）。請先用 simpany_list_tax_uploads 看 Simpany 有沒有收到，沒有的話重新預覽。`,
    );
  }
  if (store.now().getTime() > Date.parse(draft.expiresAt)) {
    throw new TaxUploadError(`草稿 ${draft.id} 已過期（2 小時），請重新預覽`);
  }
  return found;
}

/** 照 Simpany 網頁的欄位組 multipart；每個檔案重新比對 SHA-256。 */
async function buildForm(store: TaxUploadStore, draft: DraftRecord): Promise<FormData> {
  const form = new FormData();
  form.set("period", draft.period);
  form.set("category", draft.category);
  form.set("subcategory", draft.subcategory);
  form.set("note", draft.note);
  for (const f of draft.files) {
    const obj = await store.get(f.key);
    if (!obj) throw new TaxUploadError(`「${f.name}」的檔案不見了，請重新預覽`);
    if ((await sha256Hex(obj.bytes)) !== f.sha256) {
      throw new TaxUploadError(`「${f.name}」的內容在預覽之後變了，請重新預覽`);
    }
    form.append("files[]", new File([obj.bytes as BlobPart], f.name, { type: f.contentType }));
  }
  return form;
}

const byLocale = (a: string, b: string) => a.localeCompare(b);

/** 在上傳紀錄第一頁找同一期、檔名完全相同的那筆。讀不到不影響上傳結果。 */
async function findRecord(draft: DraftRecord, latest: SubmitInput["latestRecords"]): Promise<TaxUploadRecord | null> {
  const names = draft.files.map((f) => f.name).sort(byLocale).join("\n");
  try {
    const records = await latest();
    return (
      records.find(
        (r) => r.period === draft.period && r.files.map((f) => f.name).sort(byLocale).join("\n") === names,
      ) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * 錯誤分兩種：
 * - retryable = Simpany 明確拒絕（驗證 / 業務 / 權限），檔案一定沒收 → 草稿放回 pending，可修正後重送。
 * - 其他（網路、5xx）= 不確定 Simpany 有沒有收到 → 草稿標 failed，不能重送，請先看上傳紀錄。
 */
export async function submitTaxUpload(store: TaxUploadStore, input: SubmitInput): Promise<TaxUploadSubmitResult> {
  const found = await loadSubmittableDraft(store, input.orgId, input.draftId);
  const draft = found.value;

  // 佔住草稿：條件寫入，同一份草稿只會有一次送出。
  const claimed = await writeJson(store, draftKey(draft.id), { ...draft, status: "submitting" }, found.etag);
  if (!claimed) throw new TaxUploadError(`草稿 ${draft.id} 剛被另一個請求送出了`);

  const setStatus = async (status: DraftStatus, result?: DraftRecord["result"]) => {
    await writeJson(store, draftKey(draft.id), { ...draft, status, result });
  };

  let form: FormData;
  try {
    form = await buildForm(store, draft);
  } catch (e) {
    await setStatus("pending");
    throw e;
  }

  try {
    await input.submit(form);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (input.isRetryable(e)) {
      await setStatus("pending");
      throw e;
    }
    await setStatus("failed", { at: store.now().toISOString(), hashId: null, error: msg.slice(0, 300) });
    throw new TaxUploadError(
      `送出時發生錯誤，不確定 Simpany 有沒有收到：${msg}。請先用 simpany_list_tax_uploads 確認，不要直接重送。`,
    );
  }

  const record = await findRecord(draft, input.latestRecords);
  await setStatus("submitted", { at: store.now().toISOString(), hashId: record?.hashId ?? null });
  for (const f of draft.files) {
    if (f.staged) await store.delete(f.key).catch(() => undefined);
  }
  return {
    draftId: draft.id,
    period: draft.period,
    periodLabel: periodLabel(draft.period),
    files: draft.files.map((f) => f.name),
    hashId: record?.hashId ?? null,
    record,
  };
}
