// Navigation helpers shared by the top bar, the Apps menu and the page trail. Pure, so they run in node tests (utils/navTrail.test.mjs).
// An entry is { path, label, group?, activeUnder? }. `path` is where it links; `activeUnder` (optional) is the folder it counts as being in
// when that differs from `path` (Student links to /student/quiz but also owns /student/cards).

const strip = (p) => String(p || '').split('?')[0].replace(/\/+$/, '') || '/';

/** Is this page inside that section? Whole path segments only: /clients covers /clients and /clients/12 but not /client-projects. */
export function isPathActive(base, pathname) {
  const b = strip(base);
  const p = strip(pathname);
  if (b === '/') return p === '/';
  return p === b || p.startsWith(b + '/');
}

/** The entry whose section the page is in; the most specific one wins (/client-projects/3 -> Client work, not CRM). Null when none match. */
export function matchEntry(pathname, entries) {
  let best = null;
  let bestLen = -1;
  for (const e of entries) {
    if (!e || !e.path || String(e.path).includes('?')) continue;
    const base = strip(e.activeUnder || e.path);
    if (base === '/' || !isPathActive(base, pathname)) continue;
    if (base.length > bestLen) { best = e; bestLen = base.length; }
  }
  return best;
}

/**
 * What to show in the header after the app name: `{ group, label, to, deeper }`, or null on pages that are not part of a section.
 * `deeper` = the page is inside the section but not its front page (a client, a saved audit), so the label becomes a link back to `to`.
 */
export function trailFor(pathname, entries) {
  const e = matchEntry(pathname, entries);
  if (!e) return null;
  const front = strip(e.path);
  return { group: e.group || '', label: e.label, to: e.path, deeper: strip(pathname) !== front };
}
