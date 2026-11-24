'use strict';

// The Home page tiles (/home), set by an admin for everyone (workspace_settings key 'home_tiles'). Same shape as the header nav
// layout so the same editor arranges both: { sets: [{ id: 'home', label, groups: [{ id, label, itemIds: [navItemId] }] }] }.
// Item ids are nav catalogue ids (client/src/config/appNavigation.js); each viewer only sees the apps they can use.
//   node server/utils/homeTiles.test.js

const KEY = 'home_tiles';
const ID = /^[A-Za-z0-9_-]{1,60}$/;

/** The cleaned layout, or null when it is not a valid one. Duplicate apps keep their first place; blank group names become "Apps". */
function cleanHomeTiles(input) {
  const set = Array.isArray(input?.sets) && input.sets.length === 1 ? input.sets[0] : null;
  if (!set || !Array.isArray(set.groups) || set.groups.length > 40) return null;
  const seen = new Set();
  const groups = [];
  for (const g of set.groups) {
    if (!g || !ID.test(String(g.id)) || !Array.isArray(g.itemIds) || g.itemIds.length > 200) return null;
    const itemIds = g.itemIds.map(String).filter((id) => ID.test(id) && !seen.has(id) && seen.add(id));
    groups.push({ id: String(g.id), label: String(g.label ?? '').trim().slice(0, 60) || 'Apps', itemIds });
  }
  return { sets: [{ id: 'home', label: 'Home', groups }] };
}

module.exports = { KEY, cleanHomeTiles };
