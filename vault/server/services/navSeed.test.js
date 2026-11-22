'use strict';

// node server/services/navSeed.test.js   (no database: a fake pool)

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const { NEW_NAV_ITEMS, placeNewItems, seedNavItems } = require('./navSeed');

const layout = () => ({ sets: [
  { id: 'set1', label: 'Apps', groups: [{ id: 'g1', label: 'Work', itemIds: ['notes'] }, { id: 'g2', label: 'AI', itemIds: ['documentRedaction', 'contractReview', 'pdf'] }] },
  { id: 'set2', label: 'More', groups: [] },
] });

// ---- placed right after its neighbour, input untouched ----
const input = layout();
let r = placeNewItems(input, [{ id: 'docCompare', after: 'contractReview' }], []);
assert.deepStrictEqual(r.layout.sets[0].groups[1].itemIds, ['documentRedaction', 'contractReview', 'docCompare', 'pdf']);
assert.deepStrictEqual(r.placed, ['docCompare']);
assert.deepStrictEqual(input.sets[0].groups[1].itemIds, ['documentRedaction', 'contractReview', 'pdf'], 'input not mutated');

// ---- neighbour missing: end of the first group; already placed or already seeded: left alone ----
r = placeNewItems(layout(), [{ id: 'docCompare', after: 'nothere' }], []);
assert.deepStrictEqual(r.layout.sets[0].groups[0].itemIds, ['notes', 'docCompare']);
const placedAlready = layout(); placedAlready.sets[1].groups.push({ id: 'g3', label: 'X', itemIds: ['docCompare'] });
assert.deepStrictEqual(placeNewItems(placedAlready, [{ id: 'docCompare', after: 'contractReview' }], []).placed, []);
assert.deepStrictEqual(placeNewItems(layout(), [{ id: 'docCompare', after: 'contractReview' }], ['docCompare']).placed, [], 'moved to the pool by the admin: stays there');

(async () => {
  // ---- every seeded id is a real nav item, and so is its neighbour ----
  const { getNavItemCatalog } = await import(pathToFileURL(path.join(__dirname, '../../client/src/config/appNavigation.js')).href);
  const catalog = getNavItemCatalog();
  for (const i of NEW_NAV_ITEMS) { assert.ok(catalog[i.id], `${i.id} is in the nav catalog`); assert.ok(catalog[i.after], `${i.after} is in the nav catalog`); }

  // ---- seedNavItems against a fake pool: writes once, then never again ----
  const store = { nav_layout: JSON.stringify(layout()) };
  const pool = { query: async (sql, params) => {
    if (/^SELECT/.test(sql)) return { rows: Object.entries(store).map(([key, value]) => ({ key, value })) };
    const key = /VALUES \('([a-z_]+)'/.exec(sql)[1]; store[key] = params[0]; return { rows: [] };
  } };
  assert.deepStrictEqual(await seedNavItems(pool), ['docCompare', 'knowledgeGraph']);
  assert.ok(JSON.parse(store.nav_layout).sets[0].groups[1].itemIds.includes('docCompare'));
  assert.ok(JSON.parse(store.nav_layout).sets[0].groups[0].itemIds.includes('knowledgeGraph'), 'neighbour missing: end of the first group');
  assert.deepStrictEqual(JSON.parse(store.nav_layout_seeded), ['docCompare', 'knowledgeGraph']);
  // the admin moves it to the pool; a restart must not put it back
  const l = JSON.parse(store.nav_layout); l.sets[0].groups[1].itemIds = l.sets[0].groups[1].itemIds.filter((x) => x !== 'docCompare'); store.nav_layout = JSON.stringify(l);
  assert.deepStrictEqual(await seedNavItems(pool), []);
  assert.ok(!JSON.parse(store.nav_layout).sets[0].groups[1].itemIds.includes('docCompare'));
  // no saved layout: nothing written to the layout, item marked done
  const empty = {}; const pool2 = { query: async (sql, params) => { if (/^SELECT/.test(sql)) return { rows: Object.entries(empty).map(([key, value]) => ({ key, value })) }; const key = /VALUES \('([a-z_]+)'/.exec(sql)[1]; empty[key] = params[0]; return { rows: [] }; } };
  assert.deepStrictEqual(await seedNavItems(pool2), []);
  assert.ok(!empty.nav_layout && JSON.parse(empty.nav_layout_seeded).includes('docCompare'));
  console.log('navSeed tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
