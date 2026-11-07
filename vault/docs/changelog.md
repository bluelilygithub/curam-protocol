# Admin changelog

**Changelog** (Business menu, admin only, `/changelog`) lists what each update did, grouped by Day, Week (Monday start), Month or Year. Click an update to open its details: what changed, the code impacted, the goal, the benefit and any concerns. A "Concerns" tag shows on the row when there is one; Expand all / Collapse all opens every update at once. The grouping choice is kept in `localStorage` (`vault:changelogGrouping`). Built 2026-11-07; the first 25 entries cover commits `06408d2b` to `efe5db8f` (2026-11-04 to 2026-11-07).

## Where the entries come from

`server/config/changelogEntries.json`, written by Claude from each commit's message, file list and size. The date, author, full hash and line counts come straight from git; the goal, benefit and concerns are Claude's reading of the commit, so they describe what a commit says it did and are not proof that it works. The server inserts any entry whose `commit` is not in the table on boot (`server/services/changelog.js`, called from `server/db.js`) and **never overwrites an existing row**, so editing a row in the database is kept. The deployed app has no git history, which is why the entries live in a file in the repo and not in a `git log` call.

## The rule: every commit gets an entry

This is mandatory, not optional. It is also written in `CLAUDE.md` ("CHANGELOG — MANDATORY, EVERY COMMIT") so every session sees it.

1. Make the commit as usual.
2. **Before `git push`**, add an entry for each new commit and commit the file on its own with a subject starting `Changelog:` (for example `Changelog: Shares Thesis tab`). Push the code commit and the changelog commit together so one deploy carries both.
3. The `Changelog:` commits are the only exemption, because an entry needs the commit's hash and so can only be written after that commit exists; without the exemption every changelog commit would need another one. Reverts, docs-only commits, one-line fixes and commits the owner makes by hand all still need an entry.
4. Before pushing, find what is missing: list `git log --format=%h origin/<branch>..HEAD` and check each hash (and each earlier unpushed one) has a `commit` in `server/config/changelogEntries.json`. If a push goes out without entries, say so in the reply and add them next.
5. Write the concerns honestly. Costs, risks, untested paths, things the commit says it did but nobody has run: put them in `concerns`. `None noted.` only when it is true. Do not claim a commit was verified unless it was.
6. Date, author, full hash and line counts come from `git log --shortstat`, never typed by hand.

## Adding entries

Ask Claude to "add changelog entries for the latest commits" (or just let it do so as part of the rule above). It appends objects to the top of the `entries` array in the JSON file (fields: `commit` short hash, `fullHash`, `committedAt`, `author`, `subject`, `area`, `goal`, `whatChanged`, `filesImpacted` list, `benefit`, `concerns`, `filesChanged`, `insertions`, `deletions`) and the next deploy adds them. The changelog commit itself is one more commit to describe later. Nothing writes entries automatically yet; that could be a later step (for example a script run after each push).

## Pieces

- Table `changelog_entries` in `server/db.js`: global, not per user (it is a log of the app, not of a person's data), so it has no `"userId"`. Unique on `commit`.
- `GET /api/changelog`, behind `requireAdmin` in `server/index.js` (class `admin` in `server/testing/routeManifest.json`; the route test confirms an ordinary member gets 403). Read-only: there is no write route.
- `client/src/pages/ChangelogPage.jsx`; grouping logic in `client/src/pages/changelog/groupEntries.mjs` (test: `node client/src/pages/changelog/groupEntries.test.mjs`). Weeks start on Monday and dates are read in the viewer's time zone.
- Nav item `changelog` (admin only) in `client/src/config/appNavigation.js`, route in `App.jsx`. The page also redirects a non-admin home.
- Help: Tooltips on the controls and an (i) box that opens once. Not built: a tour, a guide chat and a microphone (there is nothing to type on this page).
