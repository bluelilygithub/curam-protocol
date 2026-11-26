# HTML Content Check

**HTML Content Check** (Web & SEO menu, `/html-content-check`, flag `htmlContentCheck`, default **off**, lifecycle `preview`) checks whether a requested set of edits was made to a web page. Code works out the differences; the AI (from milestone 4) only labels which change seems to answer which request line; the person judges. Nothing in the tool ever says an edit is "done". It is built milestone by milestone from the owner's brief, `docs/html-content-check-brief.md`, and in time replaces DocCompare's web-page mode.

## Status

- **Milestone 1 (done, 2026-11-26):** jobs, request lines, the page and the recycle bin.
- **Milestone 2 (done, 2026-11-26):** fetching and reading the page. Round 0 is read when a job is made; **Check again** keeps a new round; a saved copy can be uploaded instead; failed rounds keep their reason; the Rounds screen lists them.
- Not yet: what changed between rounds (M3), AI matching (M4), the client report PDF (M5), returned reports (M6, M7), the (i) box, tour and guide chat (M8).

## Where it lives

| Piece | Where |
|---|---|
| Tables | `server/db.js`: `content_check_jobs`, `content_check_items`, `content_check_rounds` (with `"rawHtml"`), `content_check_client_notes` |
| API | `server/routes/htmlContentCheck.js`, mounted at `/api/html-content-check` behind `requireAuth` and `requireFeature('htmlContentCheck')`. No model call yet, so no `aiLimiter`. Fetching has its own limit (30 per person per 10 minutes). |
| Reading a page | `server/services/htmlContentCheck/`: `lib/` (loads the bundled reader, jsdom, boot check), `extract.js` (snapshot, `normalizeText`), `fetchPage.js` (plain fetch, real browser, saved copy), `config.js` (limits) |
| The bundled reader | `scripts/buildHtmlContentCheckLib.js` makes `dist/html-content-check-lib/index.cjs` from `server/services/htmlContentCheck/lib/entry.mjs`; run by `scripts/buildDocCompare.js` |
| Request splitter | `server/services/htmlContentCheck/splitRequest.js` (pure, no model) |
| Recycle bin | `server/services/recycleBin/adapters/htmlContentCheck.js`, kind `html-content-check-job` |
| Page | `client/src/pages/HtmlContentCheckPage.jsx` + `client/src/pages/htmlContentCheck/` (tools list `htmlContentCheckTools.mjs`, `JobForm.jsx`, `JobsView.jsx`, `LinesView.jsx`, `RoundsView.jsx`, `shared.jsx`) |
| Menu | `client/src/config/appNavigation.js` (Web & SEO, after AI Visibility; `navSeed.js` places it once in a saved layout) |

## Tests

No automated test calls a live site or a model.

- `node server/services/htmlContentCheck/splitRequest.test.js`: the splitter on fixtures.
- `node server/services/htmlContentCheck/lib.test.js`: the bundle loads and reads; a hostile page makes no request to a local server and runs no script or handler; a missing bundle is reported by the boot check.
- `node server/services/htmlContentCheck/extract.test.js`: on `fixtures/artist-before.html` and `artist-after.html`, edits in the menu, heading, caption, list, sidebar and footer all survive; hidden, script, `noscript` and `template` content is dropped; ids, section paths, absolute addresses; normalisation; the size cap fails.
- `node server/services/htmlContentCheck/fetchPage.test.js`: when the real browser is and is not used; a real redirect through `safeFetch` to a local test site is stored as `finalUrl`; saved copies.
- `DATABASE_URL=… node server/routes/htmlContentCheck.db.test.js` (jobs, lines, ownership, refs, bin) and `DATABASE_URL=… node server/routes/htmlContentCheck.rounds.db.test.js` (rounds with stand-in fetchers: round 0 on create, Check again, failed rounds replaced, uploads, no `rawHtml` in the bin copy, another member refused).
- The cross-user tests cover the eight routes (`ownershipBindings.json` maps `/jobs/:id` to `content_check_jobs`).
- **Node 20**: the four pure tests above were run inside the production base image (`ghcr.io/bluelilygithub/curam-vault-base:latest`, Node 20.20.2), after building the bundle there with the image's own Linux `esbuild`. How: mount the repo read-only, copy `server/`, `scripts/` and `doc-compare/src/` into the container, link `node_modules` and `doc-compare/node_modules` to `/app`'s, run `node scripts/buildHtmlContentCheckLib.js`, then the tests with `NODE_ENV=production`.

## API

| Route | Does |
|---|---|
| `GET /jobs?q=` | The caller's jobs, newest first, with counts of lines, rounds and open client notes, and the last fetch time. `q` searches name and address as one phrase. |
| `POST /jobs` | `{ kind: 'request'|'compare', url, name?, requestText, previousText?, clientId?, ticketId?, fetchMode?, fetch? }`. An address without a scheme gets `https://`; only http and https. A missing name becomes the address. A `request` job's text is split into lines R1, R2 …; a `compare` job keeps no request. Then round 0 is read, unless `fetch: false` (the page then uploads a saved copy). A failed first fetch still makes the job, with round 0 stored as failed. |
| `GET /jobs/:id` | The job with its lines, round summaries (number, when, how, final address, status, error, title, words, blocks), client name, ticket title and open-note count. |
| `PATCH /jobs/:id` | Name, address (refused with 409 once a round exists), request text, previous text, client, ticket, status (`open`/`with_client`/`closed`), fetch mode (`auto`/`plain`/`browser`), settings (an object, 20 KB at most). Changing the request text does not change the lines. |
| `PUT /jobs/:id/items` | `{ items: [{ id?, lineText }] }` replaces the lines in that order; an `id` must be one of this job's lines. Or `{ resplit: true }` splits the stored request again (refused with 409 once refs are locked). |
| `POST /jobs/:id/rounds` | Check again: reads the page the way the job's fetch mode says, or, with a multipart field `file`, an uploaded saved copy (`.html`/`.htm`, 5 MB at most). Returns `{ round, job }`. |
| `GET /jobs/:id/rounds/:number` | One round with its snapshot and results. The stored page is never sent back. |
| `DELETE /jobs/:id` | Moves the job with its lines, rounds and client notes to the recycle bin (25 MB at most; a bigger job answers 413). |

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

Each round records `fetchedVia` (`plain`, `browser`, `upload`) and `finalUrl` (after redirects). The page's HTML is kept gzipped in `"rawHtml"` (usually 20 to 150 KB), so a better reader can re-read an old round later; it is never sent to the browser and is **left out of the recycle-bin copy** (a restored job's rounds have their snapshots but no stored page).

## The bundled reader

DocCompare's reader (`doc-compare/src/readers/html.ts`) is TypeScript in a browser app; production runs Node 20, which cannot load TypeScript, and Vault's own `package.json` has neither `diff` nor Readability. So `scripts/buildHtmlContentCheckLib.js` bundles the reader and `diff` into `dist/html-content-check-lib/index.cjs` (about 30 KB, under a second) with the `esbuild` in `doc-compare/node_modules`, which the base image installs. Readability is **left out**: full mode never uses it, and an alias puts a stand-in that refuses to run in its place (`lib/noReadability.mjs`). This matters: the base image of 2026-11-26 has no Readability in `doc-compare/node_modules` (it predates DocCompare's web-page update), and the bundle failed to build there until Readability was taken out.

- **When it is built**: by `scripts/buildDocCompare.js` during `npm run build` (its own step, so a failed DocCompare app still leaves the reader), by hand, and by the server outside production whenever the bundle is missing or older than its sources (`lib/index.js`), so local dev and tests always use the current reader.
- **When it fails**: the build log shows `[html-content-check] ERROR`, the deploy goes ahead (a preview tool must not block every deploy), and on boot the server checks the bundle by reading a tiny page (`lib.bootCheck()`, called from `server/index.js`). If that fails it logs an error and files a Suggestions-inbox alert for the first admin ("HTML Content Check cannot read pages", source `html-content-check`). Fetches then fail with a plain message.
- **jsdom** is used only for its `DOMParser`, with jsdom's own defaults kept on purpose: no `runScripts` (scripts never run) and no `resources` (nothing a page names is fetched). `lib.test.js` proves it on a hostile page.

Full mode (`extract(html, { mode: 'full', baseUrl })`, added to DocCompare's reader; DocCompare's own default is unchanged and its 246 tests still pass) drops only `script`, `style`, `noscript`, `template`, `[hidden]` and inline `display:none` / `visibility:hidden`. It keeps nav (DocCompare's main mode skips it), header, footer, sidebars, captions and banners, and adds each picture's address, made absolute (http and https only; `data:` pictures and relative addresses with no base are left without one). Content hidden by a style sheet (closed tabs, accordions) is still included, as in DocCompare.

## Snapshot

```
{ v: 1,
  meta: { title, finalUrl, fetchedVia, chars, words, pageUrl, author, published, modified, generator },
  blocks: [{ id: 'b1', type, level?, style?, number?, text, runs?, src?, table?: { t, r, c }, section: ['Dorothy Stoner', 'Exhibitions'] }] }
```

Block types are DocCompare's: `heading`, `paragraph` (style `Quote` or `Code` for quotes and code; captions are paragraphs), `listItem` (style `bullet list` / `ordered list`, `level` = depth, `number` as shown), `tableCell`, `image` (text = alt text). Links stay inside `runs` (with bold, italic, underline, strikethrough); `runs` is stored only when some run carries formatting or a link. `section` is the heading path in reading order (a heading resets deeper levels); text after the last heading keeps that heading's path, footer included. `chars` and `words` leave out alt text. The original text is stored as shown; `normalizeText()` (`extract.js`) is applied only when comparing: invisible characters and soft hyphens removed, non-breaking and other spaces made plain, curly quotes made straight, whitespace collapsed. **Case and dashes are left alone**, so they still count as changes.

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
6. **Rounds and a timeline**. *Rounds stored and listed (M2); the full timeline with change counts is M3. An unchanged page is a round (not refused as in DocCompare).*
7. **Comparing without a request** (`compare` jobs). *M3.*
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

- `client/DESIGN.md` ("Every new tool") wants the (i) box, tour and guide chat on every tool; the brief puts them in milestone 8, so the page has none yet, and Code Map may flag it until then.
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
