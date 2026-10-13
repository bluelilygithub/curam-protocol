'use strict';

// Australian financial year (1 Jul–30 Jun) as "YYYY-YY", e.g. 2025-11-03 -> "2025-26".
// The single server-side definition (finance routes and the finance crons both use it). The
// browser copy is client/src/utils/finYear.mjs; client/src/utils/finYear.test.mjs fails if the
// two ever disagree.
function finYearForDate(dateStr) {
  const d = new Date(dateStr);
  const y = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 6 ? y : y - 1; // month 6 = July (0-indexed)
  const endYY = String((startYear + 1) % 100).padStart(2, '0');
  return `${startYear}-${endYY}`;
}

module.exports = { finYearForDate };
