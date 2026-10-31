// The mobile menu and mobile tiles keep their own ordered lists (people reorder and hide them), but the NAMES must come from the nav catalog
// (config/appNavigation.js) so a rename in one place cannot leave the phone saying the old thing. Run: npm run test:nav
import assert from 'node:assert/strict';

const { DEFAULT_NAV_ITEMS, DEFAULT_TILES } = await import('./mobileConfig.js');
const { APP_NAV_GROUPS, TOP_BAR_LINKS, getTrailEntries, trailForPath, isNavItemActive } = await import('../config/appNavigation.js');

const items = APP_NAV_GROUPS.flatMap((g) => g.items);
const byPath = new Map(items.map((i) => [i.path, i]));
const byId = new Map(items.map((i) => [i.id, i]));

const drift = [];
for (const n of DEFAULT_NAV_ITEMS) {
  const c = byPath.get(n.path);
  if (c && c.label !== n.label) drift.push(`mobile menu "${n.label}" (${n.path}) should read "${c.label}"`);
}
for (const t of DEFAULT_TILES) {
  const c = byId.get(t.id);
  if (c && c.label !== t.label) drift.push(`mobile tile "${t.label}" (${t.id}) should read "${c.label}"`);
}
assert.deepEqual(drift, [], 'mobile names drifted from the nav catalog:\n  ' + drift.join('\n  '));

// the top-bar quick links are real and unique
assert.equal(new Set(TOP_BAR_LINKS.map((l) => l.id)).size, TOP_BAR_LINKS.length);
for (const l of TOP_BAR_LINKS) assert.ok(l.path.startsWith('/') && l.label && l.icon, `top bar link ${l.id} is complete`);

// active states: a section stays lit on its detail pages and on every page it owns
const crm = byId.get('clients');
const work = byId.get('clientProjects');
const student = byId.get('student');
assert.equal(isNavItemActive(crm, '/clients/12'), true);
assert.equal(isNavItemActive(crm, '/client-projects/3'), false, 'CRM is not lit on Client work');
assert.equal(isNavItemActive(work, '/client-projects/3'), true);
assert.equal(isNavItemActive(student, '/student/cards'), true);
assert.equal(isNavItemActive(student, '/student/results/9'), true);
assert.equal(isNavItemActive(TOP_BAR_LINKS.find((l) => l.id === 'notes'), '/notes'), true);

// every page the catalog links to gets a trail, and a detail page points back to its front page
for (const e of getTrailEntries().filter((x) => !x.path.includes('?') && x.path !== '/')) {
  const t = trailForPath(e.path);
  assert.ok(t, `${e.path} has a trail`);
}
assert.deepEqual(trailForPath('/clients/12'), { group: 'Business', label: 'CRM', to: '/clients', deeper: true });
assert.equal(trailForPath('/mobile-dashboard'), null);

console.log('navCatalog: ok');
