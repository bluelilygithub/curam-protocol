# HTML Content Check

**HTML Content Check** (Web & SEO menu, `/html-content-check`, flag `htmlContentCheck`, default **off**, lifecycle `preview`) checks whether a requested set of edits was made to a web page. Code works out the differences; the AI (from milestone 4) only labels which change seems to answer which request line; the person judges. Nothing in the tool ever says an edit is "done". It is built milestone by milestone from the owner's brief, `docs/html-content-check-brief.md`, and in time replaces DocCompare's web-page mode.

## Status

- **Milestone 1 (done, 2026-11-26):** jobs, request lines, the page and the recycle bin.
- **Milestone 2 (done, 2026-11-26):** fetching and reading the page. Round 0 is read when a job is made; **Check again** keeps a new round; a saved copy can be uploaded instead; failed rounds keep their reason; the Rounds screen lists them.
- **Milestone 3 (done, 2026-11-26):** what changed between rounds. Each round keeps its changes against the starting point and the round before; the Changes screen shows them word by word beside the request; content that changes by itself is grouped; the Rounds timeline shows the counts; comparison jobs work end to end.
- **Milestone 4 (done, 2026-11-26):** matching the request. **Match to request** asks the standard model which changes look like they answer each line; code checks its answer and lists the lines with no change found and the changes nobody asked for; the person links and unlinks by hand. A self-changing change a line links to moves into the main list. A later round with far less text than the starting point is read again in the real browser and flagged. Diff speed tested near the size cap; two worst-case slowdowns fixed.
- **Help (2026-11-26, before the owner's first test):** the page now follows the Video Tools / PDF Tools conventions: a Tooltip on every control, the (i) "How HTML Content Check Works" box (opens once per browser, and from the (i) beside the title), a 12-step compass tour (also Settings → HTML Content Check Tour, or `/html-content-check?tour=1`) and the guide chat. Code Map scores the tool 100.
- Not yet: the client report PDF (M5), returned reports (M6, M7), the (i) box, tour and guide chat (M8).

## Where it lives

| Piece | Where |
|---|---|
| Tables | `server/db.js`: `content_check_jobs`, `content_check_items`, `content_check_rounds` (with `"rawHtml"`), `content_check_client_notes` |
| API | `server/routes/htmlContentCheck.js`, mounted at `/api/html-content-check` behind `requireAuth` and `requireFeature('htmlContentCheck')`. No model call yet, so no `aiLimiter`. Fetching has its own limit (30 per person per 10 minutes). |
| Reading a page | `server/services/htmlContentCheck/`: `lib/` (loads the bundled reader, jsdom, boot check), `extract.js` (snapshot, `normalizeText`), `fetchPage.js` (plain fetch, real browser, saved copy), `config.js` (limits) |
| Matching | `server/services/htmlContentCheck/match.js` (prompt, checking the reply, batching, `matchRound`, `setByPerson`, `summarize`) |
| What changed | `server/services/htmlContentCheck/diff.js` (pure: `diffSnapshots`, the self-changing rules) and `roundDiff.js` (`ensureDiffs`: stores `results.diff`, fills in rounds that lack one) |
| The bundled reader | `scripts/buildHtmlContentCheckLib.js` makes `dist/html-content-check-lib/index.cjs` from `server/services/htmlContentCheck/lib/entry.mjs`; run by `scripts/buildDocCompare.js` |
| Request splitter | `server/services/htmlContentCheck/splitRequest.js` (pure, no model) |
| Recycle bin | `server/services/recycleBin/adapters/htmlContentCheck.js`, kind `html-content-check-job` |
| Page | `client/src/pages/HtmlContentCheckPage.jsx` + `client/src/pages/htmlContentCheck/` (tools list `htmlContentCheckTools.mjs`, `JobForm.jsx`, `JobsView.jsx`, `LinesView.jsx`, `RoundsView.jsx`, `ChangesView.jsx`, `RequestPanel.jsx`, `shared.jsx`) |
| Help | The (i) text `HOW_IT_WORKS` and the guide's Open buttons `GUIDE_TOOLS` in `htmlContentCheckTools.mjs`; the tour `client/src/utils/tours/htmlContentCheckTour.js` (key `vault_tour_html_content_check_completed`); the guide `server/services/htmlContentCheckTutor.js` (on `guideCore.js`) + `server/routes/htmlContentCheckTutor.js`, `POST /api/html-content-check-tutor` behind `requireFeature('htmlContentCheck')` and `aiLimiter`, wrapper `client/src/pages/htmlContentCheck/HtmlContentCheckTutorChat.jsx`, registry id `html-content-check`. Parts the guide and tour point at carry `data-guide` (new, saved-copy, real-browser, check-again, self-changing, match, change-links) and `data-tour` (html-content-check-main, -jobs, -menu). |
| Menu | `client/src/config/appNavigation.js` (Web & SEO, after AI Visibility; `navSeed.js` places it once in a saved layout) |

## Tests

No automated test calls a live site or a model.

- `node server/services/htmlContentCheck/splitRequest.test.js`: the splitter on fixtures.
- `node server/services/htmlContentCheck/lib.test.js`: the bundle loads and reads; a hostile page makes no request to a local server and runs no script or handler; a missing bundle is reported by the boot check.
- `node server/services/htmlContentCheck/extract.test.js`: on `fixtures/artist-before.html` and `artist-after.html`, edits in the menu, heading, caption, list, sidebar and footer all survive; hidden, script, `noscript` and `template` content is dropped; ids, section paths, absolute addresses; normalisation; the size cap fails.
- `node server/services/htmlContentCheck/diff.test.js`: the fixture pages before and after; added, removed, changed, moved; case and dash changes reported; whitespace, non-breaking spaces, soft hyphens and curly quotes ignored; stable change ids; link, picture and heading changes; which changes count as changing by themselves, and which real edits (a phone number, an opening day, a price, a year in a sentence) must not.
- `node server/services/htmlContentCheckTutor.test.js`: the guide (with `guideTestKit.js`): its catalogue matches the page's tools and Open buttons, every tool has a tip and blurb, the (i) text exists, the jobs' steps are real tools, and the rules and prompt say it never judges an edit and cannot see the jobs. No model is called.
- `node server/services/htmlContentCheck/match.test.js`: matching with a stand-in model and a fixed reply (`fixtures/match-reply.json`, hand-written in the shape the prompt asks for, since no live model was available): injected instructions stay data and cannot close the data block; unknown ids and refs dropped, an unreadable line marked; lines with no change and changes nobody asked for; the person's links kept over a new run; batching, the cap and one token log per call.
- `node server/services/htmlContentCheck/diff.speed.test.js`: reading and comparing a page near the size cap (458,000 characters, 978 blocks: read 0.4 s, diff 20 ms with a few edits, 0.13 s with 441 changes), and the worst case, 20,000 short list items all different (read 1.7 s, diff 1.8 s, marked rough). Prints its timings.
- `DATABASE_URL=… node server/routes/htmlContentCheck.match.db.test.js`: the match and link routes (stand-in fetchers and model): stored links, round 0 and comparisons refused, another member refused, a model failure leaves the links as they were, edited lines re-summarised, links still fitting after a recycle-bin restore, and the far-less-text retry and flag.
- `DATABASE_URL=… node server/services/htmlContentCheck/bootCheck.db.test.js`: a broken bundle files one inbox alert however many times the server starts; a working one files none.
- `node server/services/htmlContentCheck/fetchPage.test.js`: when the real browser is and is not used; a real redirect through `safeFetch` to a local test site is stored as `finalUrl`; saved copies.
- `DATABASE_URL=… node server/routes/htmlContentCheck.db.test.js` (jobs, lines, ownership, refs, bin) and `DATABASE_URL=… node server/routes/htmlContentCheck.rounds.db.test.js` (rounds with stand-in fetchers: round 0 on create, Check again, failed rounds replaced, uploads, no `rawHtml` in the bin copy, another member refused; stored changes and their counts, a round without changes filled in on read, a browser-read starting point keeping later rounds on the browser).
- The cross-user tests cover the eight routes (`ownershipBindings.json` maps `/jobs/:id` to `content_check_jobs`).
- **Node 20**: the pure tests above (`lib`, `extract`, `fetchPage`, `splitRequest`, `diff`, `match`, `diff.speed`) were run inside the production base image (`ghcr.io/bluelilygithub/curam-vault-base:latest`, Node 20.20.2), after building the bundle there with the image's own Linux `esbuild`. How: mount the repo read-only, copy `server/`, `scripts/` and `doc-compare/src/` into the container, link `node_modules` and `doc-compare/node_modules` to `/app`'s, run `node scripts/buildHtmlContentCheckLib.js`, then the tests with `NODE_ENV=production`.

## API

| Route | Does |
|---|---|
| `GET /jobs?q=` | The caller's jobs, newest first, with counts of lines, rounds and open client notes, and the last fetch time. `q` searches name and address as one phrase. |
| `POST /jobs` | `{ kind: 'request'|'compare', url, name?, requestText, previousText?, clientId?, ticketId?, fetchMode?, fetch? }`. An address without a scheme gets `https://`; only http and https. A missing name becomes the address. A `request` job's text is split into lines R1, R2 …; a `compare` job keeps no request. Then round 0 is read, unless `fetch: false` (the page then uploads a saved copy). A failed first fetch still makes the job, with round 0 stored as failed. |
| `GET /jobs/:id` | The job with its lines, round summaries (number, when, how, final address, status, error, title, words, blocks, and the change counts `sincePrevious` / `sinceBaseline` with `previousNumber`), client name, ticket title and open-note count. |
| `PATCH /jobs/:id` | Name, address (refused with 409 once a round exists), request text, previous text, client, ticket, status (`open`/`with_client`/`closed`), fetch mode (`auto`/`plain`/`browser`), settings (an object, 20 KB at most). Changing the request text does not change the lines. |
| `PUT /jobs/:id/items` | `{ items: [{ id?, lineText }] }` replaces the lines in that order; an `id` must be one of this job's lines. Or `{ resplit: true }` splits the stored request again (refused with 409 once refs are locked). |
| `POST /jobs/:id/rounds` | Check again: reads the page the way the job's fetch mode says, or, with a multipart field `file`, an uploaded saved copy (`.html`/`.htm`, 5 MB at most). Returns `{ round, job }`. |
| `GET /jobs/:id/rounds/:number` | One round with its snapshot and results (`results.diff`, see Changes). The stored page is never sent back. |
| `POST /jobs/:id/rounds/:number/match` | Match to request (behind `aiLimiter`; the only route that calls a model). Links the job's request lines to the round's changes since the starting point. Returns `{ matches }`. Round 0 and comparison jobs answer 400. |
| `PUT /jobs/:id/rounds/:number/matches/:ref` | `{ changeIds }` replaces that line's links, by the person. |
| `DELETE /jobs/:id` | Moves the job with its lines, rounds and client notes to the recycle bin (25 MB at most; a bigger job answers 413). The stored pages and the worked-out changes are left out of the bin copy (changes are worked out again on read, with the same ids). |

Limits: 200 lines a job, 5,000 characters a line, 50,000 for the request, 200,000 for the previous text, 5 MB of page HTML, **500,000 characters of extracted text per round** (`MAX_SNAPSHOT_CHARS` in `server/services/htmlContentCheck/config.js`). Over a limit is refused with a plain message, never cut. A client must be in the caller's CRM; a ticket needs Tickets switched on for the caller (tickets are shared across the workspace by design). Logs never carry request text or page content.

## R numbers

Until the first client report is made, the lines are renumbered R1, R2 … in list order on every save, so a draft never has gaps. The report (milestone 5) sets `"refsLockedAt"`; from then on a line keeps its R number, a new line gets the next number never issued (`"refCounter"`), a removed line's number is never used again, and splitting the request again is refused.

## The splitter

A bullet or number (`-`, `*`, `•`, `1.`, `2)`, `a)`, `(iv)`) starts a line and a plain line straight after it continues it; a blank line ends a line, so paragraphs separated by blank lines are one line each (wrapped email text stays together); with no bullets and no blank lines every line is its own. Nothing is dropped: an intro such as "Hi, please make these changes:" becomes a line the person deletes.

## Rounds and fetching

Round 0 is the starting point every later round is compared with. Numbers run 0, 1, 2 … without gaps: a failed round is stored with its reason (and how it was tried) and the next attempt replaces it. **An unchanged page is still stored as a round**, so a check that found nothing done is on record.

How a page is read (`fetchPage.js`, brief decision 6):

- **`auto`** (the default): a plain fetch through `safeFetch.fetchPublicFile` (Vault's SSRF guard; 5 MB, 10 s of silence or 20 s in all, HTML only, 5 redirects at most, each checked). The real browser (`server/services/restyle/renderPage.js`, every request SSRF-checked) is used instead when the plain copy has almost no text (under 30 words, DocCompare's `THIN_WORDS`), or the site turns the plain fetch away (HTTP 403, 406, 429, 503). Never for an address the guard refused.
- **`plain`**: the plain fetch only. **`browser`** ("Load in a real browser"): the real browser only.
- **A saved copy** (`fetchedVia: 'upload'`): its own address, from the browser's "saved from url" comment, `<base>`, canonical or `og:url`, is used as `finalUrl`.

**Far less text than the starting point** (under 40% of its words, when it had 100 or more): usually a site rebuilt to draw itself with JavaScript, or one blocking the check, not the client deleting most of the page. In `auto` mode the page is read again in the real browser and the fuller copy kept. Whatever is kept, if it still has far less text, the round is flagged (`results.fetch.lessText`, `retriedInBrowser`) on Rounds and Changes ("the removals below may not be real"), so it is not read as mass removal. Before milestone 4 only an almost empty copy (under 30 words) went to the browser.

**Later rounds are read the same way as the starting point where they can be**: in `auto` mode, a starting point that needed the real browser makes every later round use it. A plain copy and a browser copy of the same page differ by themselves (see Live checks), and that would look like edits. A round read differently from the round it is compared with (a saved copy, or `plain`/`browser` set by hand) is flagged on Rounds and Changes.

Each round records `fetchedVia` (`plain`, `browser`, `upload`) and `finalUrl` (after redirects). The page's HTML is kept gzipped in `"rawHtml"` (usually 20 to 150 KB), so a better reader can re-read an old round later; it is never sent to the browser and is **left out of the recycle-bin copy** (a restored job's rounds have their snapshots but no stored page).

## The bundled reader

DocCompare's reader (`doc-compare/src/readers/html.ts`) is TypeScript in a browser app; production runs Node 20, which cannot load TypeScript, and Vault's own `package.json` has neither `diff` nor Readability. So `scripts/buildHtmlContentCheckLib.js` bundles the reader and `diff` into `dist/html-content-check-lib/index.cjs` (about 30 KB, under a second) with the `esbuild` in `doc-compare/node_modules`, which the base image installs. Readability is **left out**: full mode never uses it, and an alias puts a stand-in that refuses to run in its place (`lib/noReadability.mjs`). This matters: the base image of 2026-11-26 has no Readability in `doc-compare/node_modules` (it predates DocCompare's web-page update), and the bundle failed to build there until Readability was taken out.

- **When it is built**: by `scripts/buildDocCompare.js` during `npm run build` (its own step, so a failed DocCompare app still leaves the reader), by hand, and by the server outside production whenever the bundle is missing or older than its sources (`lib/index.js`), so local dev and tests always use the current reader.
- **When it fails**: the build log shows `[html-content-check] ERROR`, the deploy goes ahead (a preview tool must not block every deploy), and on boot the server checks the bundle by reading a short page written in the code (`lib.check()`; nothing outside is fetched), from `lib.bootCheck()` in `server/index.js`. If that fails it logs an error and files a Suggestions-inbox alert for the first admin through `SuggestionService.captureIf` ("HTML Content Check cannot read pages", source `html-content-check`, fingerprint `html-content-check` / `reader-bundle`): **one item, however many times the server restarts** (a later boot updates it; once marked Ignore it stays quiet). Fetches then fail with a plain message.
- **jsdom** is used only for its `DOMParser`, with jsdom's own defaults kept on purpose: no `runScripts` (scripts never run) and no `resources` (nothing a page names is fetched). `lib.test.js` proves it on a hostile page.

Full mode (`extract(html, { mode: 'full', baseUrl })`, added to DocCompare's reader; DocCompare's own default is unchanged and its 246 tests still pass) drops only `script`, `style`, `noscript`, `template`, `[hidden]` and inline `display:none` / `visibility:hidden`. It keeps nav (DocCompare's main mode skips it), header, footer, sidebars, captions and banners, and adds each picture's address, made absolute (http and https only; `data:` pictures and relative addresses with no base are left without one). Content hidden by a style sheet (closed tabs, accordions) is still included, as in DocCompare.

## Snapshot

```
{ v: 1,
  meta: { title, finalUrl, fetchedVia, chars, words, pageUrl, author, published, modified, generator },
  blocks: [{ id: 'b1', type, level?, style?, number?, text, runs?, src?, table?: { t, r, c }, section: ['Dorothy Stoner', 'Exhibitions'] }] }
```

Block types are DocCompare's: `heading`, `paragraph` (style `Quote` or `Code` for quotes and code; captions are paragraphs), `listItem` (style `bullet list` / `ordered list`, `level` = depth, `number` as shown), `tableCell`, `image` (text = alt text). Links stay inside `runs` (with bold, italic, underline, strikethrough); `runs` is stored only when some run carries formatting or a link. `section` is the heading path in reading order (a heading resets deeper levels); text after the last heading keeps that heading's path, footer included. `chars` and `words` leave out alt text. The original text is stored as shown; `normalizeText()` (`extract.js`) is applied only when comparing: invisible characters and soft hyphens removed, non-breaking and other spaces made plain, curly quotes made straight, whitespace collapsed. **Case and dashes are left alone**, so they still count as changes.

## Changes

`diffSnapshots(from, to)` in `diff.js`, stored on each round as `results.diff`:

```
{ v: 1, baselineNumber, previousNumber,
  vsBaseline:  { changes, stats },   // against the starting point (the first round that was read)
  vsPrevious:  { changes, stats } }  // against the last earlier round that was read (failed rounds are skipped)
change: { id: 'c1', type: 'added' | 'removed' | 'changed' | 'moved', before?: side, after?: side,
          words?: [{ op: '=' | '-' | '+', text }], links?: { before, after }, kindChanged?: true, volatile?: reason }
side:   { blockId, type, text, section, src?, level? }
stats:  { added, removed, changed, moved, volatile, total }
```

1. Blocks are lined up by a key: type, heading level, the text as compared (`normalizeText`), link addresses and, for a picture, its address (longest common subsequence, `diffArrays` from the bundled `diff`).
2. A block taken out in one place and put back in another is one **moved** change.
3. Between unchanged blocks, as many blocks replaced as put in, in the same place, are paired in order as **changed** (so "1921-2008" to "1921–2008" is one change, however short); otherwise a removed block is paired with the most alike added block (word overlap 40% or more). The rest are **added** or **removed**. A changed block carries a word diff of the original text (`diffWordsWithSpace`), a changed link address, or a note that a paragraph became a heading.
4. Change ids follow reading order, so the same two snapshots always give the same ids.

**Speed on big pages.** Lining up blocks costs time growing with blocks × differences. The unchanged start and end are taken off first; the rest gets 1.5 s (`ALIGN_MS`), and if that runs out the middle is treated as replaced, in order, and the result says `stats.rough` (the screen says the line-up was rough). The most-alike pairing is skipped for a stretch over 250,000 comparisons, and each word diff gets 200 ms (then the two texts are shown whole). Measured in `diff.speed.test.js`. Milestone 4 also fixed DocCompare's reader: it read a list's items through jsdom's `.children`, which looks every index up by name across the whole list, so 20,000 list items took about 50 s to read; it now uses `childNodes` (1.7 s). DocCompare's 246 tests still pass.

`vsBaseline` is stored as null when the round before is the starting point (the same diff, not stored twice) and filled back in when a round is read.

Worked out when a round is kept, inside the same transaction, and filled in for any round without one (rounds kept in milestone 2) when the job or the round is read (`ensureDiffs`, in round order). A newer `DIFF_VERSION` recomputes old rounds the same way.

### Content that changes by itself

Marked with `volatile` and grouped, closed, under the real changes on the Changes screen ("May have changed by itself (n)"); **never dropped**, so a real edit that looks like one is still there. The rules are narrow on purpose, because a wrongly grouped real edit is worse than an ungrouped banner:

| Reason | When |
|---|---|
| `cookie` | The text (80 words or fewer) mentions cookies, consent, GDPR, privacy settings, accept all and the like. |
| `date` | Every changed word is a date word (numbers, months, weekdays, am/pm, "ago", "updated" …) **and** the line has a date's shape: a month, a time of day, a numeric date or a relative time. So "Updated 3 hours ago" and "24 November 2026" are grouped; a new phone number or "Open Wednesday" instead of "Open Tuesday" are not. Also a copyright year (only the year changed, next to ©, "(c)" or "copyright"). |
| `counter` | Only numbers changed, in a line of six words or fewer that counts something (results, members, views, items, sold …). A price or a number in a sentence is an edit. |
| `rotating` | The new wording is wording that left the page in an earlier round and has come back, as a rotating panel or carousel does. (A change made in one round and changed again in the next is **not** marked: that is the normal edit-and-revise cycle. An edit put back exactly as it was before would be marked, and is still shown in the group.) |

Not marked: carousels whose slides have not yet come back, and news boxes or "latest posts" lists. Those wait for the ignore list (Future 6) if the real pages need it (see Live checks).

## Matching the request

`matchRound` in `match.js`, from `POST /jobs/:id/rounds/:number/match`. Stored on the round as `results.matches`:

```
{ v: 1, basis: 'vsBaseline', model, at, usage: { calls, inputTokens, outputTokens, changesSent, changesLeftOut },
  items: { R1: { changeIds, reason, by: 'ai' | 'person', model?, at, unreadable? } },
  unmatchedItems: ['R6'], unrequestedChanges: ['c1'] }      // worked out by code, again on every read against the current lines
```

- **Model**: `getModelsForUser(userId).standard` (Settings → Models; no id in code). 503 with a plain message when none is set up. Each call is logged with its tokens (`logUsage`, feature `html_content_check_match`), so Usage & Cost shows it; the route also logs the totals (calls, tokens, changes sent and left out), never the text.
- **Against what**: the round's changes **since the starting point**, because the request describes the page before the edits. The Changes screen opens on "Since the starting point" for request jobs.
- **The prompt**: the system prompt says the model only links lines to changes with one short reason, never judges whether an edit is right or done, uses only the refs and ids given, and ignores any instructions inside the data. The request lines and the changes go in as JSON inside `<request_lines>` and `<page_changes>` blocks, with every `<` written as `\u003c` so text cannot close a block.
- **Checking the reply** (`parseReply`): only the first JSON object is read; an unknown ref or change id is dropped; a repeated ref keeps its first answer; a line missing from the reply, or whose ids are not a list, is marked `unreadable` and shown as "Could not read this line"; no JSON at all makes every line unreadable.
- **Big pages**: changes go in batches of 120, real ones before self-changing ones, 600 at most (`BATCH_SIZE`, `MAX_CHANGES`); the rest are counted (`changesLeftOut`) and the screen says so. Each change's text is shortened to 400 characters in the prompt only. Answers from the batches are merged per line. Output is capped at 300 + 80 tokens a line (4,000 at most).
- **By hand**: clicking a line highlights its changes; **Change links for R3** puts Link / Unlink on every change (`PUT …/matches/:ref`, `by: 'person'`). A line linked or unlinked by hand keeps the person's choice when matching again.
- **Self-changing changes**: one that a line links to moves out of the "May have changed by itself" group into the main list, marked "Asked for: R7". Unlinked ones stay in the group and are never counted as "Changes nobody asked for".
- **Filters**: All changes / Asked for / Nobody asked for. The panel lists the lines with no change found and how many changes nobody asked for.

### A real matching run on Railway (after the deploy)

1. As an admin, Settings → Feature Access: switch **HTML Content Check** on (admins can open it anyway).
2. Settings → Models: check the default model (the `standard` slot) is one with a working key on Railway.
3. HTML Content Check → **Check a change request**: a real page address and its change request → **Create job** (round 0 is read).
4. After the edits are on the page (or for a first try, any page that has changed since round 0): **Rounds → Check again**.
5. **Changes → Match to request.** Read each line's reason; open a few linked changes; try **Change links** on one line.
6. **Usage & Cost** → By feature: `html_content_check_match` shows the tokens and cost of that run. Railway's log has one `[html-content-check] matched` line with the calls, tokens and changes sent.

**Cost to expect** (input + output tokens, at the prices in `costCalculator.js`): a page like the Dorothy Stoner fixture (about 10 changes, 7 lines: about 850 input tokens measured, a few hundred out) costs **under 1 cent** on `claude-sonnet-5-5` ($2 / $10 per million) and about 1 to 2 cents on `claude-opus-5-5` ($4 / $20). A busy page (about 60 changes, 15 lines: about 8,000 in, 800 out) is about 2.5 cents on Sonnet 5.5, 5 cents on Opus 5.5. The worst case, 600 changes in 5 calls of about 30,000 input tokens each (measured for 120 long paragraphs), is about 150,000 in and up to 7,500 out: about **38 cents** on Sonnet 5.5, 75 cents on Opus 5.5. Each Match again costs the same again.

## Live checks (2026-11-26)

Run by hand from this PC through the tool's own code (no stand-ins), not part of the automated tests:

| Page | Plain fetch | Real browser | `auto` used | Same way, fetched again minutes later |
|---|---|---|---|---|
| Squarespace site (marianadurststudio.squarespace.com, a blog post) | 2,613 words, 182 blocks, 3.4 s | 2,666 words, 195 blocks, 12.3 s | plain | no changes (both ways) |
| Wix (www.wix.com/blog/art-portfolio-website-examples, which redirects to a Wix explore page; recorded as `finalUrl`) | 1,426 words, 281 blocks | 1,436 words, 284 blocks, 11.3 s | plain | no changes (both ways) |
| Wix (a site page on www.wix.com/explore) | 1,479 words | 1,489 words, 10.5 s | plain | no changes (both ways) |
| A JavaScript-only app (hn.algolia.com) | **0 words** | 1,175 words, 89 blocks, 6.1 s | **browser** (7.7 s in all) | 1 change: the live result count, grouped as `counter` |

What it shows:

- Wix and Squarespace send their text in the page itself, so a plain fetch reads them and the browser is not needed. The fallback works on a page that is truly built in the browser: `auto` found almost no text, used the real browser and recorded `browser`. In the browser check, a job on that page kept round 0 and round 1 through the real browser, with no changes between them.
- Fetched the same way again with no edits, the pages did not change by themselves, apart from the counter, which was grouped.
- **A plain copy against a browser copy of the same page differs**: 13 changes on the Squarespace page (share buttons, the cookie banner, "Open Menu"), 22 on the Wix page ("Log In", "Skip to Main Content", lazy-loaded picture addresses). That is why later rounds now reuse the starting point's way of reading, and why a round read differently is flagged.
- **Ignore list**: not needed yet on this evidence. The noise came from mixing ways of reading (now prevented) and from counters and banners (now grouped). It should be decided on the real Dorothy Stoner page (milestone 8): if a news box or a carousel keeps showing up, the per-job `settings.ignore` (Future 6) is the next step.

## Decisions (owner, 2026-11-26)

- Proposals A to H (below) approved, with extraction on the server by bundling.
- An unchanged page is stored as a round with no changes.
- Changes nobody asked for are **left out of the client report by default**, with an **Include changes nobody asked for** option when making the report (milestone 5).
- DocCompare's document checks (claims, quotes, spelling, terms, numbering and so on) are **not** carried over. Spelling on changed text is noted as a future idea (Future 9).
- Size cap: 500,000 characters of extracted text per round.
- DocCompare import (milestone 8): **the address only**, no change to DocCompare.
- Word export dropped, and with it comparing a web page with a Word file.

## Parity with DocCompare's web-page mode

To be covered before a removal brief is written.

1. **Fetch a page by address** through `safeFetch.fetchPublicFile`, the same limits as DocCompare. *Done (M2).*
2. **Open a saved page** (`.html`/`.htm`). *Done (M2): upload a saved copy, on New job or Rounds.*
3. **Reader output**: character set, headings with levels, paragraphs, lists (numbers, `start`, depth), tables, block quotes, code, absolute links, pictures with alt text, bold/italic/underline/strikethrough. *Done (M2): the same reader, in full mode.*
4. **Page details**: title, author, dates, generator, the page's own address. *Done (M2): snapshot `meta`.*
5. **Almost-no-text refusal**. *Done (M2): the real browser is tried first, then the round fails with advice to upload a saved copy.*
6. **Rounds and a timeline**. *Done (M2, M3): every round with when and how it was read and its change counts, "Show changes" from each. An unchanged page is a round (not refused as in DocCompare).*
7. **Comparing without a request** (`compare` jobs). *Done (M3).*
8. **Review PDF for the author**. *M5's client report covers the request lines; changes nobody asked for are an option when making it.*
9. ~~Word export~~. *Dropped.*
10. ~~A web page compared with a Word file~~. *Dropped with 9.*
11. ~~The document checks on web pages~~. *Not carried over (spelling on changed text: Future 9).*
12. ~~Verdict, Accept / Fix later and the accepted state~~. *Out of scope by the brief (Future 1 and 2).*
13. ~~Project export / import~~. *Not needed: jobs live on the server.*

## Proposals (approved by the owner, 2026-11-26)

**A. Extract on the server by bundling DocCompare's reader at build time.** Built in M2: see "The bundled reader".

**B. Snapshot shape: DocCompare's blocks, not the brief's**, plus `id`, `section` and `src`. Built in M2: see "Snapshot".

**C. Full mode drops only what a browser never shows.** `aria-hidden` is kept (it hides from screen readers, not from the eye). Built in M2.

**D. Size cap.** 500,000 characters (the owner's figure, not the 2,000,000 proposed). A job too big for the recycle bin's 25 MB still answers 413 on delete; with `rawHtml` kept out of the bin copy, that needs many rounds near the cap.

**E. Keep the fetched HTML, compressed, with each round.** Built in M2 (`"rawHtml"`).

**F. Schema changes made in milestone 1**: `"refCounter"` and `"refsLockedAt"` on jobs; real foreign keys for `"clientId"`, `"ticketId"` and `"attachmentId"` (`ON DELETE SET NULL`) and every `"userId"` (`ON DELETE CASCADE`); no `CHECK` on kind or status. Milestone 2 added `"rawHtml"` and made `snapshot` nullable (a failed round has none).

**G. Routes.** `PUT /jobs/:id/items` takes `{ resplit: true }`; `POST /jobs` keeps the job when round 0 fails; downloading the client report (M5) will set `"refsLockedAt"`.

**H. Milestone 8's import from DocCompare**: the address only (decided).

## Conflicts with the house docs (noted, not acted on)

- `client/DESIGN.md` ("Every new tool") wants the (i) box, tour and guide chat on every tool; the brief put them in milestone 8. Done early, on the owner's request (2026-11-26), before the first test. Milestone 8 now only adds the DocCompare pointer and the real-page check, and updates the guide, tour and (i) text as later milestones add tools.
- The brief's job tiles include "Read a client's returned report", which is milestone 6: the tile and the tool exist and say plainly they are not built yet.

## Future (designed for, not built)

1. **Checklist engine**: new `content_check_items.kind` values (`remove`, `replace`, `insert`, `image`, `held_over`) with `oldText`, `newText`, `section` columns; a pure `server/services/htmlContentCheck/checks/` with `runChecks({ baseline, previous, current, items })`, stored under `results.checks`. Old text must be in the baseline; new text must not be; a close match counts only when nearer the new text than the old; case- and quote-only differences compared strictly.
2. **Accept and broken-again**: a `content_check_acceptances` table (item, round, by, at); re-checks compare against accepted rounds.
3. **Learned rules**: a per-person `content_check_rules` table with admin sharing, fed into the matching prompt, capped in count and length.
4. **Scheduled re-checks**: a cron in `withCronLock` fetching new rounds for open jobs, raising "page changed since approval" through `SuggestionService.captureIf()`. Possible because extraction runs on the server.
5. **Image fingerprints**: a `sharp` perceptual hash per image block under `results.images`, so a new address for the same picture is not reported (the snapshot has `src`).
6. **Ignore rules**: per-job `settings.ignore` (text patterns or sections) applied by the diff before display, for dates and news boxes.
7. **Client shared link**: a shared-link route before `requireAuth`, on Vault's shared-link pattern, instead of the PDF.
8. ~~**Word export**~~: dropped by the owner on 2026-11-26.
9. **Spelling on changed text**: flag likely misspellings in the words a round added or changed (not the whole page). DocCompare's `checks/spelling.ts` only compares Australian and American forms, so this would need a real word list.
