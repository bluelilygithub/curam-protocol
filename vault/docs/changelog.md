# Admin changelog

**Changelog** (Business menu, admin only, `/changelog`) lists what each update did, grouped by Day, Week (Monday start), Month or Year. Click an update to open its details: what changed, the code impacted, the goal, the benefit and any concerns. A "Concerns" tag shows on the row when there is one; Expand all / Collapse all opens every update at once. The grouping choice is kept in `localStorage` (`vault:changelogGrouping`). Built 2026-11-07; the first 25 entries cover commits `06408d2b` to `efe5db8f` (2026-11-04 to 2026-11-07). Search, filters and "Ask the changelog" added 2026-11-18.

## Search and filters

Above the list. All of it runs in the browser over the entries the page already loaded, so there is no extra API call (`client/src/pages/changelog/filterEntries.mjs`, test `node client/src/pages/changelog/filterEntries.test.mjs`).

- **Search**: words across subject, area, goal, what changed, benefit, concerns and the commit hash (short or full). Every word must match; a "quoted phrase" stays together. Matches are highlighted in the row and in the opened details.
- **Area**: built from the entries. A combined area such as "Graphics, Video Tools" or "Memory and SERP Tracker" counts under each part.
- **From / To**: whole days, inclusive, in the viewer's time zone (the same days the Day grouping shows).
- **Has concerns**: concerns not empty and not "None noted.", the same rule as the Concerns tag.
- **File**: any part of a path in Code impacted, for example `db.js` or `server/routes/`.

The match count shows under the bar ("12 of 136 updates match"), and Expand all / Collapse all act on the updates shown. The filters live in the URL (`/changelog?q=gst&area=Finance&from=2026-11-01&to=2026-11-18&concerns=1&file=db.js`), so a filtered view can be bookmarked or sent; only the filters that are set appear.

## Ask the changelog

A question box at the top of the page (shared mic, Tooltip, three example questions). `POST /api/changelog/ask { question }` in `server/routes/changelog.js`, behind `requireAdmin` and `aiLimiter` on the mount in `server/index.js` (the limiter also counts the page's one `GET`, which is harmless). The work is in `server/services/changelogAsk.js` (test `node server/services/changelogAsk.test.js`, no database or model needed).

1. **Pick the entries first, without a model** (`selectEntries`). Date words are read in Australia/Brisbane time: today, yesterday, this week / last week (Monday start), this month / last month, last N days or weeks, since Monday (any weekday), since / after / on 10 Nov (or Nov 10, or 2026-11-10), in November. Area names that appear in the entries, file names or paths (`db.js`, `server/routes/`) and the words concern / risk / untested narrow the set. The other words score what is left (subject matches count more; "untested" also matches "not tested", "unverified", "not run"). The keyword score narrows the set only when no date, area or file was named, or when the narrowed set is still bigger than 40. At most **40** entries go to the model, newest first.
2. **Ask the model**: `getModelsForUser(userId).standard` through `callModel` (no hardcoded model id; 503 "No AI model is set up" when there is none). Usage is logged as `changelog_ask`. When nothing matches, no model is called and the answer says so.
3. **The prompt** tells the model to answer only from the entries given, to cite every claim with its commit hash as `[abc1234]`, to say plainly when the entries do not answer the question, and never to present a concern as resolved unless a later entry says so (and to cite that entry).
4. **The answer** shows each `[hash]` it was given as a link that opens that entry in the list and scrolls to it (clearing the filters if they hide it). Under the answer: "Based on N updates" (click to list them), how many matched before the cap, how the dates, area and file were read, and a warning when the model cited a hash it was not given (those are left as plain text).

**What Ask can see**: only the changelog entries it picked for that question (subject, date, area, what changed, goal, benefit, concerns, up to 15 files each, long fields shortened). **What it cannot see**: the code, git history, the database, any entry it was not sent, or anything said in an earlier question (each question stands alone). Because the entries describe what each commit says it did, an answer is a guide to the record, not proof that something works.

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

Ask Claude to "add changelog entries for the latest commits" (or just let it do so as part of the rule above). It appends objects to the top of the `entries` array in the JSON file (fields: `commit` short hash, `fullHash`, `committedAt`, `author`, `subject`, `area`, `goal`, `whatChanged`, `filesImpacted` list, `benefit`, `concerns`, `filesChanged`, `insertions`, `deletions`) and the next deploy adds them. The changelog commit itself is one more commit to describe later.

**Correcting an entry that is already live.** Editing its text in the JSON file alone does nothing, because the row already exists. Change the field and add `replacesText` with the old wording of each corrected field, for example `"replacesText": { "concerns": "<the old text, exactly>" }`. On boot, `applyCorrection` in `server/services/changelog.js` updates the row only where it still holds exactly that old text, so an edit made in the database is kept. Fields that can be corrected: `goal`, `whatChanged`, `benefit`, `concerns`. A database that never had the row simply inserts the corrected text. Nothing writes entries automatically yet; that could be a later step (for example a script run after each push).

## Pieces

- Table `changelog_entries` in `server/db.js`: global, not per user (it is a log of the app, not of a person's data), so it has no `"userId"`. Unique on `commit`.
- `GET /api/changelog` and `POST /api/changelog/ask`, behind `requireAdmin` and `aiLimiter` in `server/index.js` (both class `admin` in `server/testing/routeManifest.json`; the route test confirms an ordinary member gets 403). There is no route that writes entries.
- `client/src/pages/ChangelogPage.jsx`; grouping logic in `client/src/pages/changelog/groupEntries.mjs` (test: `node client/src/pages/changelog/groupEntries.test.mjs`), search and filters in `filterEntries.mjs`, the question box in `AskChangelog.jsx`. Weeks start on Monday and the list's dates are read in the viewer's time zone (Ask reads date words in Brisbane time).
- Nav item `changelog` (admin only) in `client/src/config/appNavigation.js`, route in `App.jsx`. The page also redirects a non-admin home.
- Help: Tooltips on the controls, an (i) box that opens once (it now explains search, filters and Ask), and the shared microphone on the search and Ask boxes. **Ask covers the guide chat**: there is no separate guide chat, because questions about the updates go to Ask; it answers from the entries, not about how the page works (the (i) box does that). Not built: a tour.
