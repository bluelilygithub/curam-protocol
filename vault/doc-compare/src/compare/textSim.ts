/** Fuzzy text similarity helpers, all 0..1. */

export const words = (s: string) => s.toLowerCase().match(/[\p{L}\p{N}]+(?:['.,][\p{L}\p{N}]+)*/gu) ?? [];

/** Dice coefficient over word multisets: good for paragraphs. */
export function wordDice(a: string, b: string): number {
  const wa = words(a), wb = words(b);
  if (!wa.length && !wb.length) return 1;
  if (!wa.length || !wb.length) return 0;
  const counts = new Map<string, number>();
  for (const w of wa) counts.set(w, (counts.get(w) ?? 0) + 1);
  let common = 0;
  for (const w of wb) { const n = counts.get(w); if (n) { common++; counts.set(w, n - 1); } }
  return (2 * common) / (wa.length + wb.length);
}

/** Dice coefficient over character bigrams: good for short strings like headings. */
export function charDice(a: string, b: string): number {
  a = a.toLowerCase().replace(/\s+/g, ' ').trim();
  b = b.toLowerCase().replace(/\s+/g, ' ').trim();
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) { const g = a.slice(i, i + 2); grams.set(g, (grams.get(g) ?? 0) + 1); }
  let common = 0;
  for (let i = 0; i < b.length - 1; i++) { const g = b.slice(i, i + 2); const n = grams.get(g); if (n) { common++; grams.set(g, n - 1); } }
  return (2 * common) / (a.length + b.length - 2);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
