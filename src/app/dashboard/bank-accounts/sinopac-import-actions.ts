"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { logWeb } from "@/db/activity";
import {
  applySinopacImport,
  listImportAccountOptions,
  planSinopacImport,
  type ApplyFailure,
  type SinopacApplyResult,
  type SinopacPlan,
} from "@/db/bank-import";
import {
  guessAccountMap,
  parseSinopacFile,
  SinopacFileError,
  statementAccounts,
  type ImportAccountOption,
  type SinopacParseResult,
} from "@/lib/bank-import/sinopac";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";

/**
 * 帳戶頁「匯入永豐明細」：preview 只試算（不寫任何東西），apply 重新解析檔案、重新試算後才寫入。
 * 限 owner / admin（這裡再檢查一次，按鈕藏起來不算數）。檔案每次都重新上傳：
 * 不信任瀏覽器傳回來的試算結果。
 */

const MAX_BYTES = 5 * 1024 * 1024;

export type SinopacPreview = {
  plan: SinopacPlan;
  options: ImportAccountOption[];
  /** 這次試算用的對應（第一次沒給就是猜的）。 */
  accountMap: Record<string, number>;
};

export type SinopacActionResult<T> = { ok: true; result: T } | { ok: false; error: string };

type Ctx = { orgId: string; userId: string };

async function authorize(): Promise<Ctx | { error: string }> {
  const t = await getTranslations("bankImport");
  const { orgId, userId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId, userId };
}

async function readUpload(formData: FormData): Promise<SinopacParseResult | { error: string }> {
  const t = await getTranslations("bankImport");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: t("errors.noFile") };
  if (file.size > MAX_BYTES) return { error: t("errors.tooLarge") };
  try {
    return await parseSinopacFile(await file.arrayBuffer());
  } catch (e) {
    if (e instanceof SinopacFileError) {
      if (e.code === "missingColumns") return { error: t("errors.missingColumns", { list: e.detail ?? "" }) };
      return { error: t(`errors.${e.code}`) };
    }
    throw e;
  }
}

/** skipUnmatched 欄位：「1」= 配不上的只列出來、不新建。 */
function readSkipUnmatched(formData: FormData): boolean {
  return formData.get("skipUnmatched") === "1";
}

/** map 欄位：JSON 物件 { "9228": 1 }；沒給回 null（= 用猜的）。 */
function readMap(formData: FormData): Record<string, number> | null | "invalid" {
  const raw = formData.get("map");
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return "invalid";
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (!/^\d{4}$/.test(k)) return "invalid";
      if (v === null || v === "" || v === 0) continue; // 不匯入
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) return "invalid";
      out[k] = n;
    }
    return out;
  } catch {
    return "invalid";
  }
}

async function prepare(formData: FormData) {
  const t = await getTranslations("bankImport");
  const ctx = await authorize();
  if ("error" in ctx) return ctx;
  const parsed = await readUpload(formData);
  if ("error" in parsed) return parsed;
  const map = readMap(formData);
  if (map === "invalid") return { error: t("errors.badMap") };
  return { ctx, parsed, map };
}

export async function previewSinopacImport(formData: FormData): Promise<SinopacActionResult<SinopacPreview>> {
  const t = await getTranslations("bankImport");
  try {
    const prep = await prepare(formData);
    if ("error" in prep) return { ok: false, error: prep.error };
    const { ctx, parsed } = prep;
    const db = getDb();
    const options = await listImportAccountOptions(db, ctx.orgId);
    const accountMap = prep.map ?? guessAccountMap(statementAccounts(parsed.lines), options);
    const plan = await planSinopacImport(db, ctx.orgId, parsed, accountMap, {
      skipUnmatched: readSkipUnmatched(formData),
    });
    return { ok: true, result: { plan, options, accountMap } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

export type SinopacApplySummary = Pick<SinopacApplyResult, "written" | "filled"> & {
  failures: ApplyFailure[];
};

export async function applySinopacImportAction(
  formData: FormData,
): Promise<SinopacActionResult<SinopacApplySummary>> {
  const t = await getTranslations("bankImport");
  try {
    const prep = await prepare(formData);
    if ("error" in prep) return { ok: false, error: prep.error };
    const { ctx, parsed } = prep;
    // 寫入一定要有明確的對應（試算時已經帶回去給使用者確認過）。
    if (prep.map === null) return { ok: false, error: t("errors.badMap") };
    const res = await applySinopacImport(getDb(), ctx.orgId, parsed, prep.map, {
      userId: ctx.userId,
      skipUnmatched: readSkipUnmatched(formData),
      log: (summary) => logWeb(ctx.orgId, "create", "transaction", null, summary),
    });
    revalidatePath("/dashboard/transactions");
    revalidatePath("/dashboard/bank-accounts");
    revalidatePath("/dashboard");
    return { ok: true, result: { written: res.written, filled: res.filled, failures: res.failures } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}
