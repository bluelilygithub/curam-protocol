# Home page tiles

`/home` is a page of app tiles in named groups, arranged by an admin for the whole workspace. It is meant as the page Vault opens on.

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

## Storage

`workspace_settings` key `home_tiles`, the same shape as the nav layout with one set:
`{ sets: [{ id: 'home', label: 'Home', groups: [{ id, label, itemIds }] }] }`. `GET /api/settings/home-tiles` (anyone signed in) and
`POST /api/settings/home-tiles` (admin; `null` removes it). The server cleans what is saved (`server/utils/homeTiles.js`): one set, at most
40 groups, ids checked, an app kept only in its first place, blank group names become "Apps".

## Tests

`node server/utils/homeTiles.test.js` (what the server accepts) and `node client/src/utils/homeTiles.test.mjs` (what a person sees).

## Not built

Custom tiles (links that are not Vault apps), tile descriptions or sizes, badges on tiles, and per-person Home pages.
