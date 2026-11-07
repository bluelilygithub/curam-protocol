// SERP Tracker, daily tracking: the cost estimate the page shows BEFORE the job is switched on, and the small texts for the Rankings table. Pure, so
// `node client/src/pages/serpTracker/trackingHelpers.test.mjs` checks them. The server keeps its own copy of the arithmetic
// (server/services/serpTracker/costs.js estimateTrackingUsd); the page gets the prices from GET /status, so the two cannot drift on a price.

const usd = (n) => `US$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

/**
 * @param input    { keywords, devices, depth }
 * @param pricing  { queuedPerTenResultsUsd, trackDepthCap, maxTrackReads } (from /status)
 * @returns {{ searches, pages, perDayLow, perDayHigh, perMonthLow, perMonthHigh, text }|null} null when there is nothing to track or no prices yet
 */
export function trackingEstimate({ keywords, devices, depth }, pricing) {
  if (!pricing || !pricing.queuedPerTenResultsUsd) return null;
  const k = Number(keywords) || 0;
  const d = Number(devices) || 0;
  if (k < 1 || d < 1) return null;
  const cap = pricing.trackDepthCap || 30;
  const pages = Math.ceil(Math.min(Number(depth) || cap, cap) / 10);
  const reads = pricing.maxTrackReads || 3;
  const perRead = k * d * pages * pricing.queuedPerTenResultsUsd;
  const out = { searches: k * d, pages, perDayLow: perRead, perDayHigh: perRead * reads, perMonthLow: perRead * 30, perMonthHigh: perRead * reads * 30 };
  out.text = `${out.searches} search${out.searches === 1 ? '' : 'es'} a day (${k} keyword${k === 1 ? '' : 's'} x ${d} device${d === 1 ? '' : 's'}, top ${pages * 10}): about ${usd(out.perDayLow)} a day, ${usd(out.perMonthLow)} a month, when every keyword is found on the first read. A keyword that misses your site is read again, up to ${reads} reads, so the most it can cost is about ${usd(out.perDayHigh)} a day, ${usd(out.perMonthHigh)} a month.`;
  return out;
}

/** Will the worst case pass the monthly limit (which Lookups share)? */
export function trackingWarning(estimate, capUsd) {
  if (!estimate || !(capUsd > 0)) return '';
  if (estimate.perMonthHigh > capUsd) return `The worst case (${usd(estimate.perMonthHigh)} a month) is more than the monthly limit of ${usd(capUsd)}, which Lookups share. The limit stops searches when it is reached, and a run says so, so raise the limit or track fewer keywords.`;
  return '';
}

/** "#5", "Not found", "Failed" for a tracked row's latest result. */
export function rankText(row) {
  if (!row) return '—';
  if (row.status === 'found') return `#${row.position}`;
  if (row.status === 'not_found') return `Not in top ${row.depth || 30}`;
  return 'Failed';
}

/** The change between the latest and the previous check; positive = moved up. Only between two found results. */
export function rankChange(latest, previous) {
  if (!latest || !previous || latest.status !== 'found' || previous.status !== 'found') return null;
  return previous.position - latest.position;
}

/** "Found on 1 of 2 reads" etc. for the reads kept on a row. */
export function readsLine(reads) {
  const list = Array.isArray(reads) ? reads : [];
  if (!list.length) return '';
  const found = list.filter((r) => r && r.position != null).length;
  if (list.length === 1) return found ? '1 read' : '1 read, not found';
  return found ? `Found on ${found} of ${list.length} reads` : `Not found on any of ${list.length} reads`;
}
