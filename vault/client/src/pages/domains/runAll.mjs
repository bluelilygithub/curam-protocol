// "Run every tool on the preferred name": which lookups to make and how to file what comes back. Pure (no network): the page makes
// the calls from this plan, so the choices can be tested.
//
// Score and Social Handles run on the preferred name. Registrar Pricing runs for the endings an Australian business usually weighs
// (.com and .com.au). Compare Names uses the shortlist. Domain Profile only makes sense for a domain that is already registered, so it
// uses the first ending the availability check found TAKEN, and is skipped (with the reason) when they are all free or unchecked.

export const PRICING_ENDINGS = ['com', 'com.au'];
export const RESULT_TITLES = {
  score: 'Name Scorer',
  compare: 'Compare Names',
  overview: 'Domain Profile',
  social: 'Social Handles',
  pricing: 'Registrar Pricing',
};
export const RESULT_ORDER = ['score', 'social', 'pricing', 'overview', 'compare'];

const enc = encodeURIComponent;

/** A social handle from a brand name: letters, numbers and underscores only. */
export function handleOf(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** The first registered (taken) domain of a suggestion, preferring .com then .com.au; null when none is known to be taken. */
export function takenDomain(suggestion) {
  const taken = ((suggestion && suggestion.results) || []).filter((r) => r && r.available === false && r.domain);
  if (!taken.length) return null;
  const order = ['com', 'com.au'];
  taken.sort((a, b) => {
    const ia = order.indexOf(a.tld); const ib = order.indexOf(b.tld);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
  });
  return taken[0].domain;
}

/**
 * @param {{ preferred: string, shortlist?: string[], suggestions?: Array }} ws
 * @returns {{ jobs: Array<{key, label, method, url, body?, ending?}>, skipped: Array<{key, reason}> }}
 */
export function planRun(ws) {
  const preferred = String(ws && ws.preferred || '').trim();
  if (!preferred) return { jobs: [], skipped: [{ key: 'all', reason: 'Choose a preferred name first.' }] };
  const jobs = [];
  const skipped = [];

  // First, a live check of the name's domain endings (never a saved answer), so the rest is judged on what is true now.
  jobs.push({ key: 'verify', label: 'Fresh availability check', method: 'POST', url: '/api/domains/verify', body: { names: [preferred], social: false } });
  jobs.push({ key: 'score', label: 'Name Scorer', method: 'GET', url: `/api/domains/score?domain=${enc(preferred)}` });
  jobs.push({ key: 'social', label: 'Social Handles', method: 'GET', url: `/api/domains/social?username=${enc(handleOf(preferred))}` });
  for (const ending of PRICING_ENDINGS) {
    jobs.push({ key: 'pricing', ending, label: `Registrar Pricing (.${ending})`, method: 'GET', url: `/api/domains/pricing?domain=${enc(`${preferred}.${ending}`)}` });
  }

  const shortlist = [...new Set((ws.shortlist || []).map((n) => String(n).trim()).filter(Boolean))];
  if (shortlist.length >= 2) {
    jobs.push({ key: 'compare', label: 'Compare Names', method: 'POST', url: '/api/domains/score/compare', body: { domains: shortlist.slice(0, 5) } });
  } else {
    skipped.push({ key: 'compare', reason: 'Star at least two names on the Name Generator to compare them.' });
  }

  const suggestion = (ws.suggestions || []).find((s) => s && s.name === preferred);
  const taken = takenDomain(suggestion);
  if (taken) {
    jobs.push({ key: 'overview', label: 'Domain Profile', method: 'GET', url: `/api/domains/overview?domain=${enc(taken)}` });
  } else if (suggestion && (suggestion.results || []).length) {
    skipped.push({ key: 'overview', reason: 'Every ending checked is free, so there is no registered domain to profile.' });
  } else {
    skipped.push({ key: 'overview', reason: 'Availability was not checked for this name, so there is no registered domain to profile. Use Domain Profile on its own for a domain you know.' });
  }
  return { jobs, skipped };
}

/**
 * File what the lookups returned. `outcomes` is one entry per job, in the same order: { ok: true, data } or { ok: false, error }.
 * Pricing from several endings becomes { com: ..., 'com.au': ... }. The fresh availability check is not a result to show: its answers go
 * back into the suggestions (see applyVerification in clearance.mjs). Returns { results, errors, verified }.
 */
export function assemble(plan, outcomes) {
  const results = {};
  const errors = {};
  let verified = null;
  plan.jobs.forEach((job, i) => {
    const o = outcomes[i];
    if (!o) return;
    if (job.key === 'verify') {
      if (o.ok) verified = (o.data && o.data.checks) || null; else errors.verify = String(o.error || 'Could not be checked.');
      return;
    }
    if (o.ok) {
      if (job.key === 'pricing') results.pricing = { ...(results.pricing || {}), [job.ending]: o.data };
      else results[job.key] = o.data;
    } else {
      const msg = String(o.error || 'Could not be checked.');
      errors[job.key] = job.key === 'pricing' ? [errors.pricing, `.${job.ending}: ${msg}`].filter(Boolean).join(' ') : msg;
    }
  });
  for (const s of plan.skipped) if (s.key !== 'all') errors[s.key] = s.reason;
  return { results, errors, verified };
}

// ── The side-by-side table ───────────────────────────────────────────────────
// Three candidates, one per column, each with its domain endings and its social handles, so they can be weighed at a glance.

export const TABLE_SLOTS = 3;
export const DOMAIN_ENDINGS = ['com', 'com.au', 'org', 'io', 'ai', 'co', 'app'];

/** The names to show: the shortlist first, then the best of the rest (most free endings, a free .com or .com.au first). Up to three. */
export function tableDefaults(ws) {
  const list = (ws && ws.suggestions) || [];
  const byName = new Map(list.map((s) => [s.name, s]));
  const picked = [];
  const add = (n) => { if (n && byName.has(n) && !picked.includes(n) && picked.length < TABLE_SLOTS) picked.push(n); };
  add(ws && ws.preferred);
  (ws && ws.shortlist || []).forEach(add);
  const score = (s) => {
    const free = (s.results || []).filter((r) => r.available === true);
    const prime = free.some((r) => r.tld === 'com' || r.tld === 'com.au') ? 100 : 0;
    return prime + free.length;
  };
  [...list].sort((a, b) => score(b) - score(a)).forEach((s) => add(s.name));
  return picked;
}

/** The names the table uses now: the person's own choice where it is still valid, otherwise the defaults. */
export function tableNames(ws) {
  const valid = new Set(((ws && ws.suggestions) || []).map((s) => s.name));
  const chosen = ((ws && ws.tableNames) || []).filter((n) => valid.has(n));
  const out = chosen.slice(0, TABLE_SLOTS);
  if (out.length >= TABLE_SLOTS) return out;
  for (const n of tableDefaults(ws)) if (!out.includes(n) && out.length < TABLE_SLOTS) out.push(n);
  return out;
}

/** The names Verify now checks live: the preferred name, the shortlist and the table's three, five at most (each costs lookup credits). */
export function verifyTargets(ws) {
  const have = new Set(((ws && ws.suggestions) || []).map((s) => s.name));
  const out = [];
  for (const n of [ws && ws.preferred, ...((ws && ws.shortlist) || []), ...tableNames(ws || {})]) {
    if (n && have.has(n) && !out.includes(n) && out.length < 5) out.push(n);
  }
  return out;
}

/** Domain rows: one per ending, with each name's state ('free', 'taken' or 'unknown'). */
export function domainRows(ws, names) {
  const byName = new Map(((ws && ws.suggestions) || []).map((s) => [s.name, s]));
  const seen = new Set(DOMAIN_ENDINGS);
  const extra = [];
  for (const n of names) for (const r of (byName.get(n) || {}).results || []) if (r.tld && !seen.has(r.tld)) { seen.add(r.tld); extra.push(r.tld); }
  return [...DOMAIN_ENDINGS, ...extra].map((tld) => ({
    tld,
    cells: names.map((n) => {
      const r = ((byName.get(n) || {}).results || []).find((x) => x.tld === tld);
      return { domain: r ? r.domain : null, state: !r ? 'unknown' : r.available === true ? 'free' : r.available === false ? 'taken' : 'unknown' };
    }),
  }));
}

/** Social rows: every platform any of the names was checked on, with each name's state; null where that name has not been checked yet. */
export function socialRows(handles, names) {
  const platforms = [];
  for (const n of names) {
    for (const p of Object.keys(((handles || {})[n] || {}).availability || {})) if (!platforms.includes(p)) platforms.push(p);
  }
  platforms.sort();
  return platforms.map((platform) => ({
    platform,
    cells: names.map((n) => {
      const d = (handles || {})[n];
      if (!d || !d.availability) return { state: 'unchecked' };
      const a = d.availability[platform];
      return { state: !a ? 'unknown' : a.available === true ? 'free' : a.available === false ? 'taken' : 'unknown', url: a && a.profile_url ? a.profile_url : null };
    }),
  }));
}

/** Which of the table's names still need their handles checked. */
export function needHandles(handles, names) {
  return names.filter((n) => !(handles && handles[n] && handles[n].availability));
}

/** A line under each column: how many endings and handles are free. */
export function columnSummary(domainRowsList, socialRowsList, index) {
  const count = (rows) => rows.filter((r) => r.cells[index] && r.cells[index].state === 'free').length;
  const known = socialRowsList.some((r) => r.cells[index] && r.cells[index].state !== 'unchecked');
  return { domainsFree: count(domainRowsList), domainsTotal: domainRowsList.length, handlesFree: known ? count(socialRowsList) : null, handlesTotal: socialRowsList.length };
}
