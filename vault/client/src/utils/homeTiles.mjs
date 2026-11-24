// The Home page (/home): the admin's tile groups (Settings → Navigation → Home page tiles, server/utils/homeTiles.js) cut down to the
// apps this person can open. `visible` is id → nav item, from getAppsNavGroups (already filtered by feature switches and admin).
//   node client/src/utils/homeTiles.test.mjs

/** Groups in the admin's order, each with its tiles in order; apps this person cannot use are left out, and so are groups left empty. */
export function homeGroupsFor(homeTiles, visible) {
  const groups = homeTiles?.sets?.[0]?.groups || [];
  return groups
    .map((g) => ({ id: g.id, label: g.label, items: g.itemIds.map((id) => visible[id]).filter(Boolean) }))
    .filter((g) => g.items.length > 0);
}
