'use strict';

// Topic Research: one canonical form of a web address, so the same article found through two feeds (or with and without tracking
// parameters) is stored once. Pure. See docs/topic-research.md.

// Only parameters that are tracking and nothing else: a name like "ref" or "source" can be the page's own id, so it stays.
const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'yclid', 'igshid', 'mc_cid', 'mc_eid', 'ref_src', 'ref_url', 'cmpid', 'ocid',
  'taid', '_hsenc', '_hsmi', 'vero_id', 'wt.mc_id',
]);

const isTracking = (key) => /^utm_/i.test(key) || TRACKING_PARAMS.has(key.toLowerCase());

/** Canonical address, or null when `raw` is not an http(s) address. */
function normaliseUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.hash = '';
  u.username = '';
  u.password = '';
  u.hostname = u.hostname.toLowerCase();
  if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
  const keep = [...u.searchParams.entries()].filter(([k]) => !isTracking(k));
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.toString();
}

/** The outlet name: the host without a leading "www.". */
function domainOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
}

module.exports = { normaliseUrl, domainOf };
