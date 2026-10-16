# Cross-user route test

Ownership in Vault is enforced route by route, by hand. This test is the safety net: it boots the real
app (`server/index.js`, every router) and checks, for **every route it serves**, that one member cannot
reach another member's data. Run it with `npm run test:cross-user` (needs a throwaway Postgres on this
machine; it refuses any other database, blanks every API key and mail setting, and refuses every
outside network connection). In CI it runs in its own step on its own database.

## What it checks

`server/routes/crossUser.test.js`

1. **Inventory.** Every route is listed in `server/testing/routeManifest.json` as `public` (no sign-in,
   by design), `admin`, or `authed`. A route added without being classified **fails the build**, so nobody
   can ship an endpoint without deciding who may call it. After adding a route run
   `node server/routes/crossUser.test.js --update`, then review the diff.
2. **Signed out.** Every route that is not `public` answers 401.
3. **Admin.** Every admin route answers 403 to an ordinary member.

`server/routes/crossUserOwnership.test.js`

User A gets a row in nearly every table (built from the database's own description of itself, see
`server/testing/ownershipFixtures.js`); every text column holds an `XMARK-` token. User B and an empty
user C are ordinary members. Then:

1. **Leak sweep.** B calls every GET route with A's real ids in the path. No response may contain a token.
   The same call as A is the control: if A cannot see the data either, the route is not counted as proven.
   A route whose answer differs between A and the empty member C is counted as "user-specific" (numbers,
   counts); if B receives exactly A's answer, that fails.
2. **Id probes.** B calls every POST/PUT/PATCH/DELETE route that has an id in the path, with A's id and a body
   copied from A's row. A's rows must be unchanged, and no new row may attach to them.
3. **Body references.** Every other write route is sent a body naming A's projects, sessions, clients and so
   on. No new row may end up attached to A's data (B filing something under A's records).

## What it does not prove

At the last run, of 413 GET routes: 181 proven with A's own tokens, 38 user-specific, 11 admin-only inside the
handler, 28 depend on outside services (blocked in the test), 37 found no row for A because the fixture does not
fit (for example a project that is not of the `client` type), and 118 gave the same answer to A and to an empty
member (global content, or lists the fixture does not populate). Run with `--vacuous` to list them. Not covered:
jobs kept in memory or on disk rather than in a table (music, video, document redaction, fonts), things keyed by
an outside service's id (Gmail, YouTube, Calendar), WebSocket routes, and the rules inside services that a route
calls. A pass means "no leak was found by these probes", not "no leak exists".

## Wiring

* `server/testing/ownershipBindings.js` / `.json`: which table an id in a path is the primary key of
  (guessed from names; overrides in the JSON, `null` = not one of our rows).
* `SHARED_BY_DESIGN` in `crossUserOwnership.test.js`: routes that show one member's rows to others on purpose
  (each needs a written reason). Currently only the workspace-shared grocery correction glossary.
* The harness turns every rate limiter into a pass-through (only in this process), because 30 AI calls a minute
  would cut the probes off.

## Found so far

PUT `/api/folders|personas|prompts/:id` returned another member's row; `POST/PUT /api/finance/invoices` accepted
another member's client id; `POST /api/translate/jobs/:id/fail` let anyone fail anyone's job. The Theme Builder
(`/tb`), which was open to the internet, was found by the inventory work and removed.
