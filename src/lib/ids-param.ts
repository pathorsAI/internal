const ID_PATTERN = /^[1-9]\d{0,15}$/;
export const MAX_IDS_PARAM = 200;

// `?ids=1,2,3` (or repeated `?ids=1&ids=2`) → positive integer ids, deduped, capped.
// null means "no ids filter": a garbage param must not narrow the list to nothing.
export function parseIdsParam(raw: string | string[] | undefined): number[] | null {
  if (raw === undefined) return null;
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(","));
  const ids = new Set<number>();
  for (const part of parts) {
    const s = part.trim();
    if (!ID_PATTERN.test(s)) continue;
    const n = Number(s);
    if (!Number.isSafeInteger(n)) continue;
    ids.add(n);
    if (ids.size === MAX_IDS_PARAM) break;
  }
  return ids.size > 0 ? [...ids] : null;
}
