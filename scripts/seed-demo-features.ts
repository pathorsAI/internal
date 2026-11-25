/**
 * 對「既有的」示範組織補上新功能的示範資料（scripts/demo/feature-pack.ts）。
 *
 * 正式 DB 上的示範組織（示範科技、Northwind、Meridian、派斯示範公司）是一次建好後就一直留著的，
 * 不會每次重建；新功能上線後它們的頁面是空的。這支只「新增」一組自成一體的資料（自己的客戶、
 * 合約、交易…），不改、不刪組織裡原有的任何一列。
 *
 * 用法：
 *   bun --env-file=<env> scripts/seed-demo-features.ts --org demo --org northwind --dry-run
 *   bun --env-file=<env> scripts/seed-demo-features.ts --org demo --org northwind
 *   bun --env-file=<env> scripts/seed-demo-features.ts --all-demo        # 下面 DEMO_SLUGS 全部
 *
 * --org 可以給 slug 或 id。資料掛在組織 owner 名下（AI 對話只有本人看得到，也是復原的操作人）；
 * 有多位 owner 時用 --owner-email 指定。
 *
 * 安全性質（刻意的，不要拿掉）：
 *   - 只動示範組織：slug 在 DEMO_SLUGS 裡、或 metadata.demo = true。真實組織（派斯、東蜂）就算
 *     明確指定也拒絕。
 *   - 已經補過（有統編 DEMOF001 的對象）就跳過那個組織，不會倒第二份。
 *   - --dry-run 只檢查與列出要動哪些組織，不寫任何東西。
 */
import { parseArgs } from "node:util";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import { featurePackApplied, seedFeaturePack } from "./demo/feature-pack";

/** 正式 DB 上的示範組織。新增示範組織時加進來，或在 metadata 帶 demo: true。 */
const DEMO_SLUGS = ["demo", "northwind", "acme-demo", "pathors-demo-emba"];
/** 真實組織：無論如何都不碰。 */
const REAL_ORG_IDS = new Set(["org_pathors"]);
const REAL_ORG_SLUGS = new Set(["pathors", "org-1780675700917"]);

const { values } = parseArgs({
  options: {
    org: { type: "string", multiple: true },
    "all-demo": { type: "boolean", default: false },
    "owner-email": { type: "string" },
    "dry-run": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) fail("DATABASE_URL is not set");
const wanted = values["all-demo"] ? DEMO_SLUGS : (values.org ?? []);
if (wanted.length === 0) fail("pass --org <slug|id> (repeatable) or --all-demo");
const dryRun = values["dry-run"] === true;

const db = getDb();
const host = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "").hostname;
  } catch {
    return "(unparsed)";
  }
})();
console.log(`database host: ${host}${dryRun ? "  (dry run)" : ""}`);

const orgs = await db
  .select({ id: organization.id, name: organization.name, slug: organization.slug, metadata: organization.metadata })
  .from(organization)
  .where(or(inArray(organization.slug, wanted), inArray(organization.id, wanted)));

const found = new Set(orgs.flatMap((o) => [o.id, o.slug]));
const notFound = wanted.filter((w) => !found.has(w));
if (notFound.length) fail(`organization not found: ${notFound.join(", ")}`);

function isDemo(o: (typeof orgs)[number]): boolean {
  if (REAL_ORG_IDS.has(o.id) || REAL_ORG_SLUGS.has(o.slug ?? "")) return false;
  if (DEMO_SLUGS.includes(o.slug ?? "")) return true;
  try {
    return JSON.parse(o.metadata ?? "{}")?.demo === true;
  } catch {
    return false;
  }
}

for (const o of orgs) {
  if (!isDemo(o)) fail(`refusing to touch "${o.name}" (${o.slug}): not a demo organization`);
}

let failed = 0;
for (const o of orgs) {
  const owners = await db
    .select({ id: user.id, email: user.email, name: user.name })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, o.id), eq(member.role, "owner")));
  const ownerEmail = values["owner-email"]?.trim().toLowerCase();
  const owner = ownerEmail ? owners.find((u) => u.email.toLowerCase() === ownerEmail) : owners[0];
  const label = `${o.name} (${o.slug}, ${o.id})`;
  if (!owner) {
    console.error(`✗ ${label}: no owner${ownerEmail ? ` with email ${ownerEmail}` : ""}`);
    failed++;
    continue;
  }
  if (await featurePackApplied(db, o.id)) {
    console.log(`- ${label}: already has the feature pack, skipped`);
    continue;
  }
  if (dryRun) {
    console.log(`• ${label}: would seed the feature pack as ${owner.email}`);
    continue;
  }
  console.log(`• ${label}: seeding as ${owner.email}`);
  try {
    const summary = await seedFeaturePack({ db, orgId: o.id, owner, log: (l) => console.log(l) });
    for (const [k, n] of Object.entries(summary)) console.log(`    ${k.padEnd(26)} ${n}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${label}: ${e instanceof Error ? e.message : String(e)}`);
    console.error("  (neon-http has no interactive transactions — rows written before the failure stay; see the summary above)");
  }
}

process.exit(failed ? 1 : 0);
