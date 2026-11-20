'use strict';

// Places a newly shipped menu item into the admin's saved menu layout (workspace_settings 'nav_layout', edited in Settings -> the menu layout
// editor) ONCE, next to a neighbour, so a new tool shows up in its proper menu instead of only in the auto "Unsorted" group. Each item is placed
// at most once: its id is remembered in workspace_settings 'nav_layout_seeded', so if the admin later moves it to the pool, it stays there.
// No layout saved = nothing to do (the single Apps menu already lists everything). Runs on boot from db.js.

// id: the nav item id (client/src/config/appNavigation.js); after: the item it goes next to (falls back to the end of the first group).
const NEW_NAV_ITEMS = [
  { id: 'docCompare', after: 'contractReview' },
];

/** Pure: returns { layout, placed } with each not-yet-seeded, not-yet-placed item put after its neighbour. Does not mutate the input. */
function placeNewItems(layout, items, seeded) {
  const next = JSON.parse(JSON.stringify(layout));
  const placed = [];
  const groups = (next.sets || []).flatMap((s) => s.groups || []);
  if (!groups.length) return { layout: next, placed };
  for (const { id, after } of items) {
    if (seeded.includes(id) || groups.some((g) => (g.itemIds || []).includes(id))) continue;
    const home = groups.find((g) => (g.itemIds || []).includes(after)) || groups[0];
    home.itemIds = home.itemIds || [];
    const at = home.itemIds.indexOf(after);
    home.itemIds.splice(at === -1 ? home.itemIds.length : at + 1, 0, id);
    placed.push(id);
  }
  return { layout: next, placed };
}

// db.js calls this while it boots, so the pool is required lazily (as services/changelog.js is)
async function seedNavItems(pool = require('../db').pool, items = NEW_NAV_ITEMS) {
  const { rows } = await pool.query("SELECT key, value FROM workspace_settings WHERE key IN ('nav_layout', 'nav_layout_seeded')");
  const get = (k) => rows.find((r) => r.key === k)?.value;
  let seeded = [];
  try { seeded = JSON.parse(get('nav_layout_seeded') || '[]'); } catch { seeded = []; }
  const todo = items.filter((i) => !seeded.includes(i.id));
  if (!todo.length) return [];
  let layout = null;
  try { layout = JSON.parse(get('nav_layout') || 'null'); } catch { layout = null; }
  // With no saved layout every item already shows in the single Apps menu: mark them done so a layout saved later is not changed.
  const { layout: next, placed } = layout && Array.isArray(layout.sets) ? placeNewItems(layout, todo, seeded) : { layout: null, placed: [] };
  if (next && placed.length) {
    await pool.query(`INSERT INTO workspace_settings (key, value, "updatedAt") VALUES ('nav_layout', $1, NOW())
                      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`, [JSON.stringify(next)]);
  }
  await pool.query(`INSERT INTO workspace_settings (key, value, "updatedAt") VALUES ('nav_layout_seeded', $1, NOW())
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`, [JSON.stringify([...seeded, ...todo.map((i) => i.id)])]);
  return placed;
}

module.exports = { NEW_NAV_ITEMS, placeNewItems, seedNavItems };
