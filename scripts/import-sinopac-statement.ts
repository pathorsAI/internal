/**
 * 匯入永豐銀行（SinoPac，永豐寰宇金融網）對帳單：對到的既有交易補上銀行備註與參考號，
 * 對不到的新建「待確認」交易，沖正的兩行互相抵銷，匯過的行不會重複。
 * 跟帳戶頁「匯入永豐明細」是同一套邏輯（src/db/bank-import.ts、src/lib/bank-import/sinopac.ts）。
 *
 * 用法：
 *   bun scripts/import-sinopac-statement.ts --org <組織 id 或 slug> --file <明細檔> \
 *     --map 9228=1,4952=15 [--dry-run] [--actor-email someone@example.com]
 *
 *   --map         帳號末四碼=帳本帳戶 id（帳本帳戶沒有存帳號，一定要明講）。檔案裡出現、但沒列在
 *                 --map 的帳戶會整個略過（不寫入、下次對應好再匯）。
 *   --dry-run     只試算：印出每一類的筆數與會新建的行，**完全不寫入**（連匯入紀錄都不寫）。
 *   --actor-email 寫進 bank_statement_lines.imported_by_user_id 的成員（選填）；操作紀錄一律記成 system。
 *
 * bun 會自動讀 .env.local 的 DATABASE_URL；要指定別的環境檔用 `bun --env-file=… scripts/…`。
 * 檔案可以是 CSV、TSV 或 .xlsx（第一張工作表）。
 *
 * 建議流程：先 --dry-run 看「新建待確認」那一段是不是真的對不到，再拿掉 --dry-run 跑一次。
 * 重跑是安全的：已匯入的行會算成「已匯入過」，中途失敗的行下次會再處理。
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { organization, user } from "@/db/auth-schema";
import { logSystem } from "@/db/activity";
import {
  applySinopacImport,
  planSinopacImport,
  type PlannedLine,
  type SinopacPlan,
} from "@/db/bank-import";
import { parseAccountMapArg, parseSinopacFile, SinopacFileError } from "@/lib/bank-import/sinopac";

function fail(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    org: { type: "string" },
    file: { type: "string" },
    map: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    "actor-email": { type: "string" },
  },
  strict: true,
});

if (!values.org) fail("--org <組織 id 或 slug> 必填");
if (!values.file) fail("--file <明細檔> 必填");
if (!values.map) fail("--map 必填，例如 --map 9228=1,4952=15");
const dryRun = values["dry-run"] === true;

const SKIP_LABEL: Record<string, string> = {
  correction_unpaired: "沖正找不到原交易",
  unmapped: "帳戶未對應（--map 沒列）",
  currency_mismatch: "帳本帳戶幣別不同",
  created_deleted: "之前建的交易已被刪除",
};

function describe(l: PlannedLine): string {
  const sign = l.direction === "in" ? "+" : "-";
  const ref = l.ref ? ` [${l.ref}]` : "";
  return `  第 ${String(l.lineNo).padStart(4)} 行  ${l.localDateTime.slice(0, 16)}  ··${l.last4}  ${sign}${l.amount} ${l.currency}  ${l.remarks ?? "（無備註）"}${ref}`;
}

function printSection<T>(title: string, items: T[], line: (item: T) => string) {
  if (items.length === 0) return;
  console.log(`\n${title}`);
  for (const item of items) console.log(line(item));
}

function recoverSuffix(l: PlannedLine): string {
  return l.decision === "recover" ? `  （補記既有 #${l.transactionId}）` : "";
}

function printAccounts(plan: SinopacPlan) {
  console.log("\n帳戶對應：");
  for (const a of plan.accounts) {
    const target = a.bankAccountId ? `#${a.bankAccountId} ${a.bankAccountName ?? "（找不到）"}` : "（未對應，略過）";
    const problem = a.problem && a.problem !== "unmapped" ? `  ⚠ ${a.problem}` : "";
    console.log(`  ··${a.last4} ${a.currency}  ${a.count} 行  →  ${target}${problem}`);
  }
}

function printCounts(c: SinopacPlan["counts"]) {
  console.log("\n筆數：");
  console.log(`  配對補備註   ${c.matched}`);
  console.log(`  新建待確認   ${c.created}`);
  console.log(`  沖正抵銷     ${c.correctionPair}`);
  console.log(`  已匯入過     ${c.duplicate}`);
  console.log(`  略過         ${c.skipped}`);
  console.log(`  讀不懂的行   ${c.parseErrors}`);
  console.log(`  合計         ${c.total + c.parseErrors}`);
}

function printPlan(plan: SinopacPlan) {
  printAccounts(plan);
  printCounts(plan.counts);
  const created = plan.lines.filter((l) => l.decision === "create" || l.decision === "recover");
  printSection(`對不到既有交易、會新建待確認的 ${created.length} 行：`, created, (l) => `${describe(l)}${recoverSuffix(l)}`);
  printSection(
    "沖正抵銷（不建、不對交易）：",
    plan.lines.filter((l) => l.decision === "correction_pair"),
    (l) => `${describe(l)}  ↔ 第 ${l.partnerLineNo} 行`,
  );
  printSection(
    "略過：",
    plan.lines.filter((l) => l.decision === "skip"),
    (l) => `${describe(l)}  — ${SKIP_LABEL[l.skipReason ?? ""] ?? l.skipReason}`,
  );
  printSection("讀不懂、不會匯入的行：", plan.parseErrors, (e) => `  第 ${e.lineNo} 行  ${e.code}  「${e.value}」`);
}

type Db = ReturnType<typeof getDb>;

async function resolveOrg(db: Db, orgArg: string) {
  const [org] = await db
    .select({ id: organization.id, name: organization.name, slug: organization.slug })
    .from(organization)
    .where(or(eq(organization.id, orgArg), eq(organization.slug, orgArg)))
    .limit(1);
  if (!org) fail(`找不到組織「${orgArg}」（用 id 或 slug）`);
  return org;
}

function readAccountMap(arg: string): Record<string, number> {
  try {
    return parseAccountMapArg(arg);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

async function resolveActor(db: Db, email: string | undefined): Promise<string | null> {
  if (!email) return null;
  const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
  if (!u) fail(`找不到使用者 ${email}`);
  return u.id;
}

async function readStatement(path: string) {
  const buf = readFileSync(path);
  try {
    return await parseSinopacFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  } catch (e) {
    if (e instanceof SinopacFileError) fail(`讀不了檔案：${e.message}`);
    throw e;
  }
}

async function main() {
  const db = getDb();
  const org = await resolveOrg(db, (values.org as string).trim());
  const accountMap = readAccountMap(values.map as string);
  const actorId = await resolveActor(db, values["actor-email"]);
  const parsed = await readStatement(values.file as string);

  console.log(`組織：${org.name}（${org.slug ?? org.id}）`);
  console.log(`檔案：${values.file}（${parsed.lines.length} 行可讀、${parsed.errors.length} 行讀不懂）`);
  console.log(dryRun ? "模式：--dry-run（只試算，不寫入任何東西）" : "模式：寫入");

  if (dryRun) {
    printPlan(await planSinopacImport(db, org.id, parsed, accountMap));
    console.log("\n（--dry-run：沒有寫入任何資料。確認無誤後拿掉 --dry-run 再跑一次。）");
    return;
  }

  const res = await applySinopacImport(db, org.id, parsed, accountMap, {
    userId: actorId,
    log: (summary) => logSystem(org.id, "create", "transaction", null, `${summary}（scripts/import-sinopac-statement.ts）`),
  });
  printPlan(res.plan);
  const w = res.written;
  console.log("\n實際寫入：");
  console.log(`  配對補備註   ${w.matched}（其中 ${res.filled} 筆交易真的補上了備註或參考號）`);
  console.log(`  新建待確認   ${w.created}`);
  console.log(`  沖正抵銷     ${w.correctionPair}`);
  console.log(`  略過（記錄） ${w.skipped}`);
  if (res.failures.length > 0) {
    console.log(`\n✗ ${res.failures.length} 行寫入失敗（沒有記錄，修正後重跑同一份檔案即可）：`);
    for (const f of res.failures) console.log(`  第 ${f.lineNo} 行  ${f.message}`);
    process.exitCode = 2;
  } else {
    console.log("\n✓ 完成。新建的交易在收支紀錄的「待確認」裡，指定分類後就會清掉。");
  }
}

await main();
process.exit(process.exitCode ?? 0);
