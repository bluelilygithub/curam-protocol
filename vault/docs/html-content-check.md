# HTML Content Check

**HTML Content Check** (Web & SEO menu, `/html-content-check`, flag `htmlContentCheck`, default **off**, lifecycle `preview`) checks whether a requested set of edits was made to a web page. Code works out the differences; the AI (from milestone 4) only labels which change seems to answer which request line; the person judges. Nothing in the tool ever says an edit is "done". It is built milestone by milestone from the owner's brief, `docs/html-content-check-brief.md`, and in time replaces DocCompare's web-page mode.

## Status

**Milestone 1 (done, 2026-11-26):** jobs, request lines, the page and the recycle bin. No page is fetched yet; that is milestone 2. Not yet started: fetch and extraction (M2), diff and the Changes screen (M3), AI matching (M4), the client report PDF (M5), returned reports (M6, M7), the DocCompare pointer, (i) box, tour and guide chat (M8).

## Where it lives

| Piece | Where |
|---|---|
| Tables | `server/db.js`: `content_check_jobs`, `content_check_items`, `content_check_rounds`, `content_check_client_notes` |
| API | `server/routes/htmlContentCheck.js`, mounted at `/api/html-content-check` behind `requireAuth` and `requireFeature('htmlContentCheck')`. No model call yet, so no `aiLimiter` on it. |
| Request splitter | `server/services/htmlContentCheck/splitRequest.js` (pure, no model) |
| Recycle bin | `server/services/recycleBin/adapters/htmlContentCheck.js`, kind `html-content-check-job` |
| Page | `client/src/pages/HtmlContentCheckPage.jsx` + `client/src/pages/htmlContentCheck/` (tools list `htmlContentCheckTools.mjs`, `JobForm.jsx`, `JobsView.jsx`, `LinesView.jsx`, `shared.jsx`) |
| Menu | `client/src/config/appNavigation.js` (Web & SEO, after AI Visibility; `navSeed.js` places it once in a saved layout) |
| Tests | `node server/services/htmlContentCheck/splitRequest.test.js`; `DATABASE_URL=… node server/routes/htmlContentCheck.db.test.js` (routes, ownership, refs, bin restore); the cross-user tests cover the six routes (`ownershipBindings.json` maps `/jobs/:id` to `content_check_jobs`) |

## API (milestone 1)

| Route | Does |
|---|---|
| `GET /jobs?q=` | The caller's jobs, newest first, with counts of lines, rounds and open client notes, and the last fetch time. `q` searches name and address as one phrase. |
| `POST /jobs` | `{ kind: 'request'|'compare', url, name?, requestText, previousText?, clientId?, ticketId?, fetchMode? }`. An address without a scheme gets `https://`; only http and https. A missing name becomes the address. A `request` job's text is split into lines R1, R2 …; a `compare` job keeps no request. |
| `GET /jobs/:id` | The job with its lines, round summaries, client name, ticket title and open-note count. |
| `PATCH /jobs/:id` | Name, address (refused with 409 once a round exists), request text, previous text, client, ticket, status (`open`/`with_client`/`closed`), fetch mode (`auto`/`plain`/`browser`), settings (an object, 20 KB at most). Changing the request text does not change the lines. |
| `PUT /jobs/:id/items` | `{ items: [{ id?, lineText }] }` replaces the lines in that order; an `id` must be one of this job's lines. Or `{ resplit: true }` splits the stored request again (refused with 409 once refs are locked). |
| `DELETE /jobs/:id` | Moves the job with its lines, rounds and client notes to the recycle bin (25 MB at most; a bigger job answers 413). |

Limits: 200 lines a job, 5,000 characters a line, 50,000 for the request and 200,000 for the previous text. Over a limit is refused with a plain message, never cut. A client must be in the caller's CRM; a ticket needs Tickets switched on for the caller (tickets are shared across the workspace by design). Logs never carry request text or page content.

## R numbers

Until the first client report is made, the lines are renumbered R1, R2 … in list order on every save, so a draft never has gaps. The report (milestone 5) sets `"refsLockedAt"`; from then on a line keeps its R number, a new line gets the next number never issued (`"refCounter"`), a removed line's number is never used again, and splitting the request again is refused.

## The splitter

A bullet or number (`-`, `*`, `•`, `1.`, `2)`, `a)`, `(iv)`) starts a line and a plain line straight after it continues it; a blank line ends a line, so paragraphs separated by blank lines are one line each (wrapped email text stays together); with no bullets and no blank lines every line is its own. Nothing is dropped: an intro such as "Hi, please make these changes:" becomes a line the person deletes.

## Answers to the brief's open questions (milestone 1)

**1. Where DocCompare's HTML reader runs.** In the browser only. It is `doc-compare/src/readers/html.ts`, TypeScript inside DocCompare's own Vite app, using the browser's `DOMParser` and `@mozilla/readability`. Readability and `diff` are only in `doc-compare/package.json`; Vault's root has `jsdom` (which provides a `DOMParser`) but neither of those. Vault's server cannot load the `.ts` file as it is: production runs Node 20 (`node:20-slim` in `Dockerfile.base`), which cannot run TypeScript (this PC runs Node 24, which can, so it would work locally and fail on Railway). DocCompare's `node_modules` (with `esbuild`, `diff` and Readability) are installed in the base image, though. So server-side extraction is possible **without a `package.json` change** by bundling the reader at build time (proposal A below). Full mode would not need Readability at all.

**2. The word-diff code.** `doc-compare/src/compare/content.ts` (`diffWordsWithSpace` from the `diff` package, plus DocCompare's `normalize.ts` and `textSim.ts`), and `align.ts` (`diffArrays`) for lining up blocks. The `diff` package is only in `doc-compare/package.json`, not in Vault's root, so Vault's server cannot `require('diff')` today. The same bundle (proposal A) would include it.

**3. The fillable-PDF code.** `server/routes/pdf.js` in PDF Tools, on `pdf-lib`: `POST /api/pdf/addfields` creates text fields, checkboxes and dropdowns (`form.createTextField` / `createCheckBox` / `createDropdown`, with its standard-font and typography helpers), and `POST /api/pdf/inspect` reads every field's value back with the same library (`getText`, `isChecked`, `getSelected`). So yes, one library writes and reads. The helpers live inside the route file and are not exported; milestone 5 would move the few it needs into a small shared module. Note: `pdf-lib`'s standard fonts are Latin-1 only, so curly quotes print but non-Latin text would not; DocCompare solved this with bundled Liberation fonts (`doc-compare/src/report/pdfFonts.ts`), which needs `@pdf-lib/fontkit` (not in Vault's root: to be checked in M5 before relying on it).

**4. DocCompare's web-page features**, from `doc-compare/src/` and `docs/doc-compare.md`, are the parity list below.

## Parity with DocCompare's web-page mode

To be covered before a removal brief is written. Items marked *decide* go beyond the smaller version of this tool, and need the owner's call: build, or agree to drop.

1. **Fetch a page by address**, through `safeFetch.fetchPublicFile` (http/https, ports 80/443, every address checked public, redirects re-checked, at most 5), 5 MB at most, 10 s of silence or 20 s in all, HTML only, its own user agent, 30 fetches per person per 10 minutes. *M2.*
2. **Open a saved page** (`.html`/`.htm` from File > Save Page As) for staging sites and pages behind a login. *M2 (saved-copy upload).*
3. **Reader output**: character set from the BOM or `<meta charset>`; headings with levels; paragraphs; bullet and numbered lists (shown numbers, `start` respected, nesting depth); tables as cells with table/row/column; block quotes; `pre` as code; links made absolute (`javascript:` dropped); pictures as image blocks with alt text; bold, italic, underline and strikethrough. *M2, in full mode (no clutter removal, no Readability).*
4. **Page details**: title, author, published and modified dates, generator, the page's own address (saved-from comment, `<base>`, canonical, `og:url`) and where the content was taken from. *M2 (snapshot `meta`).*
5. **Almost-no-text refusal** (under 30 words) with advice to save the page from a browser. *M2: here it triggers the real-browser fallback first.*
6. **Rounds and a timeline**: the fetched page as a dated original, later fetches as rounds, an unchanged page refused as "the same file". *M2/M3.* (Whether an unchanged page should be refused or stored as a round with no changes: *decide*; storing it is more useful for "nothing was done".)
7. **Comparing without a request.** *M3 (`compare` jobs).*
8. **Review PDF for the author** (must fix / please review / minor, with word diffs). *M5's client report covers the request lines; *decide* whether changes nobody asked for also go in it.*
9. **Word export** of the page (`docx` package, image placeholders, reads back identically), so a copywriter can edit the page in Word and check the Word file as round 1. *Decide.* The `docx` package is only in DocCompare's folder.
10. **A web page compared with a Word file** (the copywriter's edited .docx as a round). *Decide*; only useful with item 9.
11. **The document checks on web pages**: new claims, quotes, links, references, numbering, spelling, terms, word limits, required headings, formatting. *Decide*; out of scope for the smaller version.
12. **Verdict, Accept / Fix later decisions and the accepted state.** *Out of scope by the brief* (the future checklist engine, Future 1 and 2).
13. **Project export / import** (`.doccompare`). Not needed: jobs live on the server.

## Proposals (waiting for the owner's OK before milestone 2)

**A. Extract on the server by bundling DocCompare's reader at build time.** A small script (`scripts/buildHtmlContentCheckLib.js`, run from `scripts/buildDocCompare.js`) uses the `esbuild` already in `doc-compare/node_modules` to bundle `doc-compare/src/readers/html.ts` (with a new `mode: 'full'` option; DocCompare's default unchanged) and `diff` into one CommonJS file under `dist/`, which the server loads with `jsdom`'s `DOMParser`. Cost: no `package.json` change, no base-image rebuild, under a second of build time. Risk: if that build step fails, fetching in this tool fails (with a plain message) until the next deploy; locally the script must be run once before fetching works. This is a build change, so it needs your yes (docs/deploy-speed.md). The alternative is extracting in the browser and posting the snapshot, which rules out scheduled re-checks (Future 4).

**B. Snapshot shape: DocCompare's blocks, not the brief's.** The reader already returns blocks of type `heading`, `paragraph`, `listItem`, `tableCell`, `image` with `level`, `style` (`Quote`, `Code`, list kind), `runs` (formatting and link addresses), `number` and table position. Proposal: store those as they are, plus `id` and `section` (the heading path) added by this tool, under `{ v: 1, meta, blocks }`. The brief's `quote` is `style: 'Quote'`, `link` stays inside runs, and `caption` would be a paragraph; full mode also adds `src` to image blocks (DocCompare ignores it), needed for thumbnails and image fingerprints.

**C. Full mode removes less than the brief says, on one point.** It drops scripts, styles, `noscript`, `template`, `[hidden]` and inline `display:none` / `visibility:hidden`, and keeps nav, header, footer, aside, cookie banners and forms' visible text. `aria-hidden` is kept (it hides from screen readers, not from the eye). Content hidden by a style sheet (closed tabs, accordions) is still included, as in DocCompare.

**D. Size cap: 2,000,000 characters of extracted text per round** (`MAX_SNAPSHOT_CHARS` in `server/services/htmlContentCheck/config.js`), on top of the 5 MB fetch cap. Over it, the round fails and says so. A job with many large rounds can exceed the recycle bin's 25 MB: today that refuses the delete (413); proposal: offer "Delete for good" after a typed confirmation.

**E. Keep the fetched HTML, compressed, with each round** (`"rawHtml" BYTEA`, gzip, usually 20–150 KB). Then a better reader can re-extract old rounds without fetching again, and a disputed result can be shown from the page as it was. Not in the brief's schema; say no and only the snapshot is kept.

**F. Schema changes already made in milestone 1** (against the brief's sketch): `"refCounter"` and `"refsLockedAt"` on jobs (R numbers above); real foreign keys for `"clientId"`, `"ticketId"` and `"attachmentId"` (`ON DELETE SET NULL`) and for every `"userId"` (`ON DELETE CASCADE`), as the neighbouring tables do; no `CHECK` on kind or status (checked in code, so later kinds need no migration).

**G. Routes.** `PUT /jobs/:id/items` also takes `{ resplit: true }` rather than a separate route. `POST /jobs` will create the job even when fetching round 0 fails, storing round 0 as failed with its error, so the person can retry or upload a saved copy through `POST /jobs/:id/rounds`. Downloading the client report (M5) sets `"refsLockedAt"`.

**H. Milestone 8's import from DocCompare.** DocCompare's rounds live in the browser's IndexedDB, never on the server. Importing the earliest page round is still possible without a server change: Vault's DocCompare page already receives messages from the app, so the app could hand over the original page's HTML and the page upload it as round 0 (the saved-copy path). That is a small change inside DocCompare, which the brief says to avoid; the fallback is carrying the address only.

## Conflicts with the house docs (noted, not acted on)

- `client/DESIGN.md` ("Every new tool") wants the (i) box, tour and guide chat on every tool; the brief puts them in milestone 8. Milestone 1 follows the brief, so the page has none yet, and Code Map may flag it until then.
- The brief's job tiles include "Read a client's returned report", which is milestone 6: the tile and the tool exist and say plainly they are not built yet.

## Future (designed for, not built)

1. **Checklist engine**: new `content_check_items.kind` values (`remove`, `replace`, `insert`, `image`, `held_over`) with `oldText`, `newText`, `section` columns; a pure `server/services/htmlContentCheck/checks/` with `runChecks({ baseline, previous, current, items })`, stored under `results.checks`. Old text must be in the baseline; new text must not be; a close match counts only when nearer the new text than the old; case- and quote-only differences compared strictly.
2. **Accept and broken-again**: a `content_check_acceptances` table (item, round, by, at); re-checks compare against accepted rounds.
3. **Learned rules**: a per-person `content_check_rules` table with admin sharing, fed into the matching prompt, capped in count and length.
4. **Scheduled re-checks**: a cron in `withCronLock` fetching new rounds for open jobs, raising "page changed since approval" through `SuggestionService.captureIf()`. This is why extraction should run on the server.
5. **Image fingerprints**: a `sharp` perceptual hash per image block under `results.images`, so a new address for the same picture is not reported (needs `src` in the snapshot, proposal B).
6. **Ignore rules**: per-job `settings.ignore` (text patterns or sections) applied by the diff before display, for dates and news boxes.
7. **Client shared link**: a shared-link route before `requireAuth`, on Vault's shared-link pattern, instead of the PDF.
8. **Word export**: parity item 9.
