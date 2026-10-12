import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { getDb } from "@/db";
import { parties } from "@/db/schema";
import { foldPartyName, matchParty, type PartyCandidate } from "./party-aliases";

type Db = ReturnType<typeof getDb>;

/**
 * 撈可能對得上這些名稱的交易對象：同組織、未刪除，而且「名稱（不分大小寫）在清單裡」或「有設別名」。
 * 前綴別名沒辦法在 SQL 端先篩，所以有別名的一律帶回來，交給 matchParty 判斷。
 */
export async function loadPartyCandidates(
  db: Db,
  orgId: string,
  names: readonly string[],
): Promise<PartyCandidate[]> {
  const folded = [...new Set(names.map(foldPartyName).filter(Boolean))];
  if (folded.length === 0) return [];
  return db
    .select({ id: parties.id, name: parties.name, aliases: parties.aliases })
    .from(parties)
    .where(
      and(
        eq(parties.organizationId, orgId),
        isNull(parties.deletedAt),
        or(
          inArray(sql`lower(btrim(${parties.name}))`, folded),
          sql`cardinality(${parties.aliases}) > 0`,
        ),
      ),
    );
}

/**
 * 名稱 → 交易對象 id，查無就新建（名稱、label 照 `labelByName`）。
 *
 * 比對走 matchParty（名稱 > 別名 > 前綴別名，只看未刪除的）。同一批裡只差大小寫的新名稱
 * 只建一筆、共用同一個 id。一次 select + 至多一次 insert。
 */
export async function resolveOrCreateParties(
  db: Db,
  orgId: string,
  labelByName: ReadonlyMap<string, string>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const names = [...labelByName.keys()].filter((n) => foldPartyName(n));
  if (names.length === 0) return map;

  const candidates = await loadPartyCandidates(db, orgId, names);
  const toCreate = new Map<string, string>(); // folded → 第一次出現的寫法
  for (const name of names) {
    const id = matchParty(candidates, name);
    if (id !== null) map.set(name, id);
    else if (!toCreate.has(foldPartyName(name))) toCreate.set(foldPartyName(name), name);
  }
  if (toCreate.size === 0) return map;

  const created = await db
    .insert(parties)
    .values([...toCreate.values()].map((name) => ({ organizationId: orgId, name, label: labelByName.get(name)! })))
    .returning({ id: parties.id, name: parties.name });
  const idByFolded = new Map(created.map((r) => [foldPartyName(r.name), r.id]));
  for (const name of names) {
    if (map.has(name)) continue;
    const id = idByFolded.get(foldPartyName(name));
    if (id !== undefined) map.set(name, id);
  }
  return map;
}

/** 單一名稱版的 resolveOrCreateParties；`created` 讓呼叫端決定要不要 revalidate。 */
export async function resolveOrCreateParty(
  db: Db,
  orgId: string,
  name: string,
  label: string,
): Promise<{ id: number; created: boolean }> {
  const candidates = await loadPartyCandidates(db, orgId, [name]);
  const found = matchParty(candidates, name);
  if (found !== null) return { id: found, created: false };
  const [row] = await db
    .insert(parties)
    .values({ organizationId: orgId, name, label })
    .returning({ id: parties.id });
  return { id: row.id, created: true };
}
