# Home page tiles

`/home` is a page of app tiles in named groups, arranged by an admin for the whole workspace. Vault opens on it: a one-time step at boot (server/db.js, marker home_landing_2026_11_24) set the workspace start page to /home and
cleared admins' own start page where it was Shares. Members with their own start page keep it; change any of it under Members.

## Arranging it (admin)

Settings → Navigation → **Home page tiles**. It is the same drag-and-drop editor as the Apps menu split above it
(`components/settings/NavLayoutEditor.jsx`, used with `setCount={1}` by `components/settings/HomeTilesSettings.jsx`):

- type a group name and press **+ Add**;
- drag apps from the pool of unplaced apps into a group; drag a tile onto another to put it before that one;
- drag a group by its grip handle onto another group's header to reorder groups; rename a group in place, or delete it (its apps go back
  to the pool);
- **Save tiles**. **Remove all tiles** empties the page.

**Open Vault on Home for everyone** sets the workspace start page (the same setting as under Members) to `/home`. Members who have their
own start page keep it.

## What people see

Tiles come from the nav catalogue (`config/appNavigation.js`), so a tile has the app's own name, icon and link. Each person sees only the
apps they can use (feature switches, admin-only apps), via `getAppsNavGroups`; a group with none of them is hidden
(`utils/homeTiles.mjs`). An app is in at most one group. Admins get a "Change these tiles" link at the bottom.

## Needs attention sidebar

`components/AttentionSidebar.jsx`, on the right (above the tiles on a phone): one box each for Tasks (overdue, due today), Notes
(reminders due), Plans (steps of active plans past their end date), Invoices (overdue invoices, bills from email to review), Tickets
(yours overdue, assigned to you) and Emails (Inbox Intel threads marked urgent or waiting on you in the last 14 days and not yet actioned,
Email Follow-Up drafts to approve). An app the person cannot use has no box; a box with nothing waiting says so. Data: `GET
/api/attention/summary` (routes/attention.js, the same counts as the Needs attention list plus plans, tickets and emails), worded by
`buildAttentionSummary` in services/attention.js. Refreshes when the tab comes back into view and every five minutes. Tests:
`services/attention.test.js` and `routes/attentionSummary.db.test.js` (real database: every source query runs, and counts).

## Storage

`workspace_settings` key `home_tiles`, the same shape as the nav layout with one set:
`{ sets: [{ id: 'home', label: 'Home', groups: [{ id, label, itemIds }] }] }`. `GET /api/settings/home-tiles` (anyone signed in) and
`POST /api/settings/home-tiles` (admin; `null` removes it). The server cleans what is saved (`server/utils/homeTiles.js`): one set, at most
40 groups, ids checked, an app kept only in its first place, blank group names become "Apps".

## Tests

`node server/utils/homeTiles.test.js` (what the server accepts) and `node client/src/utils/homeTiles.test.mjs` (what a person sees).

## Not built

Custom tiles (links that are not Vault apps), tile descriptions or sizes, badges on tiles, and per-person Home pages.
