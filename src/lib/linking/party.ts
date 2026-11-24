import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { parties } from "@/db/schema";
import { foldPartyName, matchParty, type PartyCandidate } from "@/lib/party-aliases";
import { rankSimilarParties, type SimilarParty } from "./party-similarity";

/**
 * 寫入交易時的「對象名稱 → id」。跟 src/lib/party-resolve.ts 的差別：查無完全相同的名稱 / 別名時，
 * 先找相似的既有對象。
 *
 * - mode "create"（網頁、MCP：人或 AI 明確打了這個名字）：照樣新建，但把相似候選回傳，
 *   讓呼叫端提示「要不要合併」。
 * - mode "hold"（自動同步）：有相似的就**不新建**，partyId 留空、held = true，呼叫端把交易
 *   標成 party_similar 待確認，候選寫進 link_candidates，由人在待連結頁選。
 *   沒有相似的才新建。
 */
export type PartyWriteMode = "create" | "hold";

export type PartyResolution = {
  partyId: number | null;
  created: boolean;
  held: boolean;
  similar: SimilarParty[];
};

export type PendingParty = { name: string; label: string; candidates: SimilarParty[] };

async function loadAllParties(db: Db, orgId: string): Promise<PartyCandidate[]> {
  return db
    .select({ id: parties.id, name: parties.name, aliases: parties.aliases })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), isNull(parties.deletedAt)));
}

/** 跟 name 相似、但不完全相同的既有對象（完全相同的會被 matchParty 直接用掉，不會走到這）。 */
export async function findSimilarParties(db: Db, orgId: string, name: string, limit = 5): Promise<SimilarParty[]> {
  const all = await loadAllParties(db, orgId);
  const exact = matchParty(all, name);
  return rankSimilarParties(all.filter((p) => p.id !== exact), name, limit);
}

/** 一批名稱一起解析（同步一次幾百筆，只查一次對象表）。同一批裡只差大小寫的新名稱只建一筆。 */
export async function resolvePartiesForWrite(
  db: Db,
  orgId: string,
  labelByName: ReadonlyMap<string, string>,
  mode: PartyWriteMode,
): Promise<Map<string, PartyResolution>> {
  const out = new Map<string, PartyResolution>();
  const names = [...labelByName.keys()].filter((n) => foldPartyName(n));
  if (names.length === 0) return out;
  const all = await loadAllParties(db, orgId);

  const toCreate = new Map<string, { name: string; label: string }>(); // folded → 第一次出現的寫法
  const similarByFolded = new Map<string, SimilarParty[]>();
  for (const name of names) {
    const id = matchParty(all, name);
    if (id !== null) {
      out.set(name, { partyId: id, created: false, held: false, similar: [] });
      continue;
    }
    const folded = foldPartyName(name);
    const similar = similarByFolded.get(folded) ?? rankSimilarParties(all, name);
    similarByFolded.set(folded, similar);
    if (mode === "hold" && similar.length > 0) {
      out.set(name, { partyId: null, created: false, held: true, similar });
      continue;
    }
    if (!toCreate.has(folded)) toCreate.set(folded, { name, label: labelByName.get(name)! });
  }
  if (toCreate.size === 0) return out;

  const created = await db
    .insert(parties)
    .values([...toCreate.values()].map((p) => ({ organizationId: orgId, name: p.name, label: p.label })))
    .returning({ id: parties.id, name: parties.name });
  const idByFolded = new Map(created.map((r) => [foldPartyName(r.name), r.id]));
  for (const name of names) {
    if (out.has(name)) continue;
    const folded = foldPartyName(name);
    const id = idByFolded.get(folded);
    if (id !== undefined) {
      out.set(name, { partyId: id, created: true, held: false, similar: similarByFolded.get(folded) ?? [] });
    }
  }
  return out;
}

/** 單一名稱版。 */
export async function resolvePartyForWrite(
  db: Db,
  orgId: string,
  name: string,
  label: string,
  mode: PartyWriteMode,
): Promise<PartyResolution> {
  const map = await resolvePartiesForWrite(db, orgId, new Map([[name, label]]), mode);
  return map.get(name) ?? { partyId: null, created: false, held: false, similar: [] };
}

/** held 的結果 → 交給連結層的 pendingParty（寫進 link_candidates.party）。 */
export function pendingPartyOf(name: string, label: string, r: PartyResolution | undefined): PendingParty | null {
  return r?.held ? { name, label, candidates: r.similar } : null;
}
