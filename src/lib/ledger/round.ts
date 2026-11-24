/** 金額一律四捨五入到小數 2 位；加 1e-9 是為了 1.005 這種浮點誤差，並且不回傳 -0。 */
export function round2(n: number): number {
  const r = Math.round((Math.abs(n) + 1e-9) * 100) / 100;
  if (r === 0) return 0;
  return n < 0 ? -r : r;
}

/** 視為 0（小於半分錢）。 */
export function isZero(n: number): boolean {
  return Math.abs(n) < 0.005;
}
