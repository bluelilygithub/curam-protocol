// Australian financial year (1 Jul–30 Jun) as "YYYY-YY", e.g. 2025-11-03 -> "2025-26".
// Browser copy of server/utils/finYear.js; finYear.test.mjs fails if the two ever disagree.
export function finYearForDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 6 ? y : y - 1; // month 6 = July (0-indexed)
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}
