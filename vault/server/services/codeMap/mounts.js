'use strict';

// Code Map, stage 5: the API mounts in server/index.js.
// Port of the "server mounts" block of specs/code-map/reference/analyze.py.

const { resolve } = require('./imports');
const { splitLines } = require('./files');

const INDEX_FILE = 'server/index.js';
const AUTH_LINE = "app.use('/api', requireAuth)";

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Returns [{ path, line, modules, features, aiLimiter, admin, public }] in file order.
function parseMounts(files, indexFile = INDEX_FILE) {
  const idx = files[indexFile] || '';
  const lines = splitLines(idx);
  const authIdx = lines.findIndex((l) => l.includes(AUTH_LINE));
  const authLine = authIdx === -1 ? Infinity : authIdx + 1;
  const mounts = [];
  lines.forEach((line, i0) => {
    const i = i0 + 1;
    const m = line.match(/app\.use\('(\/api\/[^']+)'\s*,(.*)\);/);
    if (!m) return;
    const body = m[2];
    const mods = [];
    for (const rm of body.matchAll(/require\('(\.\/routes\/[^']+)'\)/g)) {
      const r = resolve(files, indexFile, rm[1]);
      if (r) mods.push(r);
    }
    const feats = [...body.matchAll(/requireFeature\('(\w+)'\)/g)].map((x) => x[1]);
    for (const a of body.matchAll(/requireAnyFeature\(([^)]*)\)/g)) {
      for (const k of a[1].matchAll(/'(\w+)'/g)) feats.push(k[1]);
    }
    if (!mods.length) {
      // router objects declared earlier (cellarLiteConfig.staffRouter etc.)
      for (const nm of body.matchAll(/(\w+)\.\w+Router/g)) {
        const dm = idx.match(new RegExp(`const\\s+${escapeRe(nm[1])}\\s*=\\s*require\\('(\\./routes/[^']+)'\\)`));
        if (dm) {
          const r = resolve(files, indexFile, dm[1]);
          if (r) mods.push(r);
        }
      }
    }
    mounts.push({
      path: m[1],
      line: i,
      modules: mods,
      features: feats,
      aiLimiter: body.includes('aiLimiter'),
      admin: body.includes('requireAdmin'),
      public: i < authLine,
    });
  });
  return mounts;
}

// The mount(s) with the longest path that an /api/... string falls under.
function mountsForApi(mounts, api) {
  const best = mounts.filter((m) => api === m.path || api.startsWith(m.path + '/'));
  if (!best.length) return [];
  const L = Math.max(...best.map((m) => m.path.length));
  return best.filter((m) => m.path.length === L);
}

function seg(p) {
  return p.slice('/api/'.length).split('/')[0];
}

module.exports = { INDEX_FILE, parseMounts, mountsForApi, seg };
