'use strict';

// PC Health: Safe clean-up. The ONLY place this agent can change anything, and only for a short fixed list of things that rebuild
// themselves (temporary files, package download caches). Layers of safety, each enforced separately:
//   1. The list is fixed here (CLEANABLE). Candidates come only from the latest scan and only when the scanned path matches the
//      known location of that cache, so nothing else can ever be offered.
//   2. The server sends item IDS to the helper, never paths. The helper has the real locations written into the script itself.
//   3. The helper only cleans when the person started it with -AllowCleanup, and only after the person has switched the items on and
//      confirmed in Vault.
// Everything else the scan finds stays advice only. See docs/pc-health.md.

const CLEANABLE = {
  'temp-user': {
    label: 'Your temporary files', kind: 'temp', pathRe: /^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Temp$/i,
    removes: 'Files and empty folders in your Temp folder that have not been changed for over a day. Anything in use is skipped.',
    safe: 'Programs use Temp for short-lived scratch files and make new ones when they need them.',
    after: 'Nothing to do. Programs create new temporary files as they work.',
  },
  'npm-cache': {
    label: 'npm download cache', kind: 'package-cache', pathRe: /^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\npm-cache$/i,
    removes: 'The cached package downloads inside npm\'s cache folder.',
    safe: 'It is only a copy of packages npm downloaded earlier. Your projects and their node_modules folders are not touched.',
    after: 'The next npm install downloads what it needs again, so that first install is slower.',
  },
  'pip-cache': {
    label: 'pip download cache', kind: 'package-cache', pathRe: /^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\pip\\Cache$/i,
    removes: 'The cached package downloads inside pip\'s cache folder.',
    safe: 'It is only a copy of packages pip downloaded earlier. Installed Python packages are not touched.',
    after: 'The next pip install downloads what it needs again.',
  },
  'yarn-cache': {
    label: 'Yarn download cache', kind: 'package-cache', pathRe: /^[A-Za-z]:\\Users\\[^\\]+\\AppData\\Local\\Yarn\\Cache$/i,
    removes: 'The cached package downloads inside Yarn\'s cache folder.',
    safe: 'It is only a copy of packages Yarn downloaded earlier. Your projects are not touched.',
    after: 'The next Yarn install downloads what it needs again.',
  },
};
const CLEANABLE_IDS = Object.keys(CLEANABLE);

/** What the latest scan found that is on the fixed list. Pure. */
function candidatesFor(report) {
  const out = []; const seen = new Set();
  for (const l of (report && report.leftovers) || []) {
    for (const id of CLEANABLE_IDS) {
      const c = CLEANABLE[id];
      if (seen.has(id) || l.kind !== c.kind || !c.pathRe.test(String(l.path || ''))) continue;
      seen.add(id);
      out.push({ id, label: c.label, path: l.path, sizeMB: l.sizeMB, removes: c.removes, safe: c.safe, after: c.after });
    }
  }
  return out.sort((a, b) => b.sizeMB - a.sizeMB);
}

/** Clean a request's item list: known ids only, no repeats. */
function cleanItemIds(raw) {
  const ids = Array.isArray(raw) ? raw : [];
  return [...new Set(ids.filter((x) => typeof x === 'string' && CLEANABLE_IDS.includes(x)))];
}

/** Clean the helper's result for a clean-up. Only the requested items are kept. */
function sanitizeResults(raw, requested) {
  const n = (v, max = 1e9) => { const x = Number(v); return Number.isFinite(x) && x >= 0 ? Math.min(x, max) : 0; };
  const t = (v, len = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, len);
  const list = Array.isArray(raw && raw.results) ? raw.results : [];
  return requested.map((id) => {
    const r = list.find((x) => x && x.id === id) || {};
    return {
      id, label: CLEANABLE[id].label, freedMB: Math.round(n(r.freedMB, 1e8) * 10) / 10, filesRemoved: Math.round(n(r.filesRemoved, 1e9)),
      skipped: Math.round(n(r.skipped, 1e9)), note: t(r.note), ok: r.ok === true,
    };
  });
}

module.exports = { CLEANABLE, CLEANABLE_IDS, candidatesFor, cleanItemIds, sanitizeResults };
