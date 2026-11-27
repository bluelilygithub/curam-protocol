// Number wording for charts. Pure, no React. Signs are always written (never colour alone) and negatives use the Unicode minus.
export const MINUS = '−';
const isNum = (v) => v != null && v !== '' && Number.isFinite(Number(v));
const sign = (n) => (n > 0 ? '+' : n < 0 ? MINUS : '');

/** +1.6%, −0.8%, 0.0%; '—' for nothing. */
export function fmtPct(v, digits = 1) {
  if (!isNum(v)) return '—';
  const n = Number(v);
  const r = Number(Math.abs(n).toFixed(digits));
  return `${r === 0 ? '' : sign(n)}${r.toFixed(digits)}%`;
}

/** +A$578, −A$1,204, A$0 (en-AU grouping, whole dollars unless digits given). signed=false drops the sign (for amounts like dividends). */
export function fmtAud(v, { signed = true, digits = 0 } = {}) {
  if (!isNum(v)) return '—';
  const n = Number(v);
  const body = Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const zero = Number(Math.abs(n).toFixed(digits)) === 0;
  return `${signed && !zero ? sign(n) : (!signed && n < 0 ? MINUS : '')}A$${body}`;
}

/** Holdings vs an index, in percentage points: "beat by 0.5 pts", "lagged by 0.8 pts", "level". */
export function fmtPts(diff, digits = 1) {
  if (!isNum(diff)) return '—';
  const r = Number(Math.abs(Number(diff)).toFixed(digits));
  if (r === 0) return 'level';
  return `${Number(diff) > 0 ? 'beat' : 'lagged'} by ${r.toFixed(digits)} pts`;
}
