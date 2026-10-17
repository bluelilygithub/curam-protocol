'use strict';
/**
 * Which database table does each id in a route path point at? Guessed from names
 * (/api/finance/invoices/:id -> fin_invoices), with explicit answers in ownershipBindings.json for the
 * ones names cannot give. A binding of null means "not a row id" (a language code, a map tile...).
 * The probe test proves a binding is real by checking that the owner can read the row through it.
 */
const fs = require('fs');
const path = require('path');

const OVERRIDES = JSON.parse(fs.readFileSync(path.join(__dirname, 'ownershipBindings.json'), 'utf8')).bindings;

const snake = (s) => s.replace(/-/g, '_').replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase();
const sing = (s) => s.replace(/ies$/, 'y').replace(/s$/, '');

// values for ids that are not rows
const HINTS = { lang: 'en', slug: 'x', name: 'x', stem: 'vocals', n: '1', z: '1', x: '1', y: '1', token: 'x', category: 'x', artifact: 'x', entityType: 'x', ref: 'x' };

function segmentsOf(p) { return p.split('/').filter(Boolean); }

/** [{ param, index, key, table|null|undefined }] for one route path. undefined = could not decide. */
function bindingsFor(routePath, tableNames) {
  const segs = segmentsOf(routePath);
  const out = [];
  segs.forEach((s, i) => {
    if (!s.startsWith(':')) return;
    const param = s.slice(1).replace(/\(.*$/, '').replace(/\?$/, '');
    const key = segs.slice(0, i + 1).join('/');
    let table;
    if (Object.prototype.hasOwnProperty.call(OVERRIDES, key)) table = OVERRIDES[key];
    else {
      const area = snake(segs[1] || ''); const owner = snake(segs[i - 1] || '');
      const cands = [owner, sing(owner), `${area}_${owner}`, `${area}_${sing(owner)}`, `${sing(area)}_${owner}`, `${sing(area)}_${sing(owner)}`, `fin_${owner}`, `fin_${sing(owner)}`, area, sing(area), `${area}s`];
      table = cands.find((c) => tableNames.has(c));
      if (table === undefined && param in HINTS) table = null;
    }
    out.push({ param, index: i, key, table });
  });
  return out;
}

module.exports = { bindingsFor, HINTS, segmentsOf };
