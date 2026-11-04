// Is a suggested name actually clear? Pure rules (no network) for the Domain page: what the person insists on being free (some domain
// endings and some social platforms), whether each suggestion meets that, how old its check is, and which suggestions to show.
//
// A name is only CLEAR when every required ending and platform is positively free. A taken one makes it BLOCKED. Anything unknown or
// not yet checked leaves it UNCONFIRMED: never treated as free. Free means not registered or claimed right now; it is not a trademark check.

export const REQUIRABLE_PLATFORMS = [
  ['instagram', 'Instagram'], ['twitter', 'X (Twitter)'], ['tiktok', 'TikTok'], ['facebook', 'Facebook'],
  ['youtube', 'YouTube'], ['linkedin', 'LinkedIn'], ['github', 'GitHub'], ['threads', 'Threads'],
];
const PLATFORM_LABEL = Object.fromEntries(REQUIRABLE_PLATFORMS);
const ALIASES = { twitter: ['twitter', 'x'], x: ['twitter', 'x'] };

export const FILTER_MODES = [
  ['all', 'All names'],
  ['main-free', 'Free .com or .com.au'],
  ['not-blocked', 'Not blocked by my requirements'],
  ['clear', 'Meets all my requirements'],
];

export const STALE_HOURS = 24;

/** The data service's entry for a platform (it may spell it any way round), or null. */
export function findPlatform(availability, platform) {
  const wanted = ALIASES[String(platform).toLowerCase()] || [String(platform).toLowerCase()];
  for (const [key, entry] of Object.entries(availability || {})) {
    if (wanted.includes(String(key).toLowerCase())) return entry || null;
  }
  return null;
}

export function stateOf(entry) {
  if (!entry) return 'unknown';
  return entry.available === true ? 'free' : entry.available === false ? 'taken' : 'unknown';
}

const endingLabel = (tld) => `.${tld}`;
const platformLabel = (p) => PLATFORM_LABEL[p] || p;

/**
 * @param suggestion { name, results:[{tld, available}] }
 * @param handles    the Social Handles answer for this name ({ availability }) or undefined when not checked
 * @param req        { tlds:[], platforms:[] }
 * @returns { status: 'none'|'clear'|'blocked'|'unconfirmed', failed:[text], unconfirmed:[text] }
 */
export function clearance(suggestion, handles, req) {
  const tlds = (req && req.tlds) || [];
  const platforms = (req && req.platforms) || [];
  if (!tlds.length && !platforms.length) return { status: 'none', failed: [], unconfirmed: [] };
  const failed = [];
  const unconfirmed = [];
  for (const tld of tlds) {
    const r = ((suggestion && suggestion.results) || []).find((x) => x.tld === tld);
    const st = r ? stateOf(r) : 'unknown';
    if (st === 'taken') failed.push(`${endingLabel(tld)} is taken`);
    else if (st !== 'free') unconfirmed.push(`${endingLabel(tld)} is not confirmed`);
  }
  for (const p of platforms) {
    if (!handles || !handles.availability) { unconfirmed.push(`${platformLabel(p)} has not been checked`); continue; }
    const st = stateOf(findPlatform(handles.availability, p));
    if (st === 'taken') failed.push(`${platformLabel(p)} is taken`);
    else if (st !== 'free') unconfirmed.push(`${platformLabel(p)} is not confirmed`);
  }
  return { status: failed.length ? 'blocked' : unconfirmed.length ? 'unconfirmed' : 'clear', failed, unconfirmed };
}

/** Which suggestions to show. `handlesMap` is { [name]: Social Handles answer }. Order is kept. */
export function filterSuggestions(list, mode, req, handlesMap) {
  const items = list || [];
  if (mode === 'main-free') {
    return items.filter((s) => (s.results || []).some((r) => (r.tld === 'com' || r.tld === 'com.au') && r.available === true));
  }
  if (mode === 'not-blocked') return items.filter((s) => clearance(s, (handlesMap || {})[s.name], req).status !== 'blocked');
  if (mode === 'clear') return items.filter((s) => clearance(s, (handlesMap || {})[s.name], req).status === 'clear');
  return items;
}

/** "just now", "5 min ago", "3 h ago", "2 days ago"; '' when there is no time. */
export function ageLabel(iso, now = Date.now()) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.floor((new Date(now).getTime() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** An answer with no time, or older than a day, may be out of date. */
export function isStale(iso, now = Date.now(), hours = STALE_HOURS) {
  const t = iso ? new Date(iso).getTime() : NaN;
  if (!Number.isFinite(t)) return true;
  return new Date(now).getTime() - t > hours * 3600 * 1000;
}

/** Where a name's domain answers came from: 'live' (the registry), 'saved' (a saved answer was used) or 'unknown' (nothing came back). */
export function freshness(suggestion) {
  const rs = (suggestion && suggestion.results) || [];
  if (!rs.length) return 'unknown';
  return rs.some((r) => r.source === 'cache') ? 'saved' : 'live';
}

/** The oldest check among the given suggestions (an ISO string), or null when any has no time. */
export function oldestCheck(list) {
  let oldest = null;
  for (const s of list || []) {
    if (!s.checkedAt) return null;
    if (!oldest || new Date(s.checkedAt) < new Date(oldest)) oldest = s.checkedAt;
  }
  return oldest;
}

/** Put fresh answers from Verify now into the set's suggestions and handle checks. */
export function applyVerification(ws, checks) {
  const byName = new Map((checks || []).map((c) => [c.name, c]));
  const suggestions = (ws.suggestions || []).map((s) => {
    const key = String(s.name).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
    const c = byName.get(key);
    return c && c.domains ? { ...c.domains, name: s.name } : s;
  });
  const handles = { ...((ws.results && ws.results.handles) || {}) };
  for (const s of ws.suggestions || []) {
    const key = String(s.name).toLowerCase().replace(/[^a-z0-9-]/g, '').replace(/^-+|-+$/g, '');
    const c = byName.get(key);
    if (c && c.social && c.social.availability) handles[s.name] = c.social;
  }
  return { suggestions, handles };
}
