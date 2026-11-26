# Brief: HTML Content Check (new Vault tool)

You are working in Vault (commit cdb590f19343 or later). Build a new member tool, **HTML Content Check**, that checks whether a requested set of edits was made to a web page, and in time **replaces DocCompare's web-page mode** (fetch by URL, HTML reader, page rounds, added 2026-11-26).

This is deliberately the **smaller version** of an earlier plan. The AI never decides that an edit is "done": code computes the differences, the AI only labels which change looks like it answers which request line, and the person judges. The larger checklist engine (typed checks, Done / Not done results, Accept ticks, learned rules) is **not** in scope, but the design must leave room for it (see "Extension points").

**Before writing any code**, read: `CLAUDE.md`, `docs/core-conventions.md`, `docs/doc-compare.md`, `docs/key-files.md`, `docs/recycle-bin.md`, `docs/deploy-speed.md`, `docs/guide-chat.md`, `client/DESIGN.md`. Where this brief and those docs disagree, the docs win; tell me about the conflict. Ask me rather than assume when something isn't covered.

**How to treat this brief.** The decisions in section 1 and the conventions in section 7 are firm. The schema (section 2), the routes (section 3), the snapshot shape and the small UI specifics (field names, number of rows, status values) are a **starting point** written without seeing the code. **Prefer reusing existing structures over matching this brief's shapes.** For example, if DocCompare's reader already produces a block structure, use it rather than converting to the one sketched here. At the end of M1, propose any changes to the schema, routes or snapshot based on what you found, and **wait for my OK before starting M2**.

**How sessions run.** This brief lives in the repo at `docs/html-content-check-brief.md`. Each session starts with "Do milestone N of the brief". Do only that milestone, then stop and report.

---

## 1. Decisions already made

| # | Decision | Notes |
|---|----------|-------|
| 1 | New tool, separate from DocCompare | Flag `htmlContentCheck`, lifecycle `preview`, default off. Section: Web & SEO. |
| 2 | Reuse DocCompare's code by importing it, not copying it | Import its HTML reader and diff helpers directly for now. No shared-folder refactor: the code moves into this tool when DocCompare's web mode is removed. |
| 3 | DocCompare keeps its web-page features unchanged for now | DocCompare gets only a pointer to this tool (milestone 8). Removal is a later, separate brief, done once this tool is `ga` and has passed the parity checklist (section 9). |
| 4 | Full-text extraction, never Readability's main-content guess | Add a `mode: 'full'` option to the reader (DocCompare's default stays as it is). Drop only scripts, styles, `noscript`, `template` and hidden elements. Keep nav, sidebars, footers, captions and asides, because edits often happen there. |
| 5 | The baseline is always fetched when a job is created | Round 0 is the baseline. Pasted previous text is optional and stored alongside it, not instead of it. |
| 6 | Plain fetch first, real browser as fallback | Plain fetch through `safeFetch` / `htmlFetch.checkSsrf`. If the page yields almost no text, or the person ticks "Load in a real browser", use `server/services/restyle/renderPage.js` (Playwright, SSRF-checked). Record which one was used for every round. |
| 7 | Saved copy as last resort | The person can upload a saved `.html` file in place of fetching. |
| 8 | Two job kinds | `request` (a change request to check) and `compare` (just compare rounds, no request). `compare` gives parity with DocCompare's web mode. |
| 9 | The AI labels, code decides | AI output is "request line → change ids it appears to answer", with a short reason. Code validates every id. There is no "Done" status anywhere in this version. |
| 10 | Client report is a fillable PDF | Built with Vault's existing fillable-PDF capability (find it; probably in PDF Tools on `pdf-lib`). Not flattened. Every row has a reference (R1, R2…). There is a Further changes table, an Approved as is tickbox, name and date. |
| 11 | Returned reports can be uploaded | Form fields read with `pdf-lib`. PDF comments read with `pdfjs-dist`. Scans read by a vision-capable model as **drafts** the person confirms. |
| 12 | Size cap fails, never truncates | If a page's extracted content exceeds the cap, the round fails with a clear message. Truncation would make text look removed. |
| 13 | No `package.json` changes without asking | Everything needed should already be installed (`jsdom`, `pdf-lib`, `pdfjs-dist`, `sharp`, `multer`, `playwright`, `tesseract.js`). If something is missing (check `diff` especially), stop and tell me before adding it. |

### Open questions: answer these in milestone 1, before building on them

Report the answers in the milestone 1 Changelog entry and in `docs/html-content-check.md`.

1. **Where does DocCompare's HTML reader run, and can it run on the server under `jsdom` with no `package.json` change?** Readability was added to `doc-compare/package.json`, not Vault's. Preferred: extract on the server, so snapshots are produced and stored server-side. If that isn't possible without a dependency change, extract in the browser and post the snapshot, and tell me.
2. **Where is the word-diff code** DocCompare uses, and is the `diff` package available to Vault's server? If it's only in `doc-compare/package.json`, say so.
3. **Where is Vault's fillable-PDF creation code**, and can the same library read field values back?
4. **Exactly which web-page features DocCompare has**, from its code and docs. Turn the parity checklist in section 9 into an exact list.

---

## 2. Data model (SQL)

Add these to `server/db.js` as idempotent DDL. **Match the neighbouring tables' conventions** for the id type, the users table name and foreign-key style; the SQL below is a sketch. camelCase columns are double-quoted. Future fields are added later with `ALTER TABLE … ADD COLUMN IF NOT EXISTS`; don't add them now.

```sql
CREATE TABLE IF NOT EXISTS content_check_jobs (
  id              SERIAL PRIMARY KEY,
  "userId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL DEFAULT 'request',       -- 'request' | 'compare' (future kinds allowed)
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  "requestText"   TEXT,                                  -- NULL for 'compare'
  "previousText"  TEXT,                                  -- optional pasted text from before the edits
  "clientId"      INTEGER,                               -- optional CRM client (match clients FK style)
  "ticketId"      INTEGER,                               -- optional Tickets link
  "fetchMode"     TEXT NOT NULL DEFAULT 'auto',          -- 'auto' | 'plain' | 'browser'
  status          TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'with_client' | 'closed'
  settings        JSONB NOT NULL DEFAULT '{}'::jsonb,    -- extension room: per-job options
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS content_check_jobs_user_idx ON content_check_jobs ("userId", "updatedAt" DESC);

-- Request lines: the request split into lines the person can edit. In future,
-- typed checklist items use this same table, with more kinds and columns.
CREATE TABLE IF NOT EXISTS content_check_items (
  id              SERIAL PRIMARY KEY,
  "jobId"         INTEGER NOT NULL REFERENCES content_check_jobs(id) ON DELETE CASCADE,
  "userId"        INTEGER NOT NULL,
  ref             TEXT NOT NULL,                         -- 'R1', 'R2'... stable once printed
  kind            TEXT NOT NULL DEFAULT 'request_line',  -- future: 'remove' | 'replace' | 'insert' | 'image' | 'held_over'
  "lineText"      TEXT NOT NULL,
  source          TEXT NOT NULL DEFAULT 'request',       -- 'request' | 'client_note' | 'manual'
  position        INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE ("jobId", ref)
);

-- Round 0 is the baseline. Each later round is one re-check.
CREATE TABLE IF NOT EXISTS content_check_rounds (
  id              SERIAL PRIMARY KEY,
  "jobId"         INTEGER NOT NULL REFERENCES content_check_jobs(id) ON DELETE CASCADE,
  "userId"        INTEGER NOT NULL,
  number          INTEGER NOT NULL,
  "fetchedAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "finalUrl"      TEXT,
  "fetchedVia"    TEXT NOT NULL,                         -- 'plain' | 'browser' | 'upload'
  snapshot        JSONB NOT NULL,                        -- versioned shape, see below
  results         JSONB NOT NULL DEFAULT '{}'::jsonb,    -- keyed by module: { diff, matches, ... }
  status          TEXT NOT NULL DEFAULT 'ready',         -- 'ready' | 'failed'
  error           TEXT,
  UNIQUE ("jobId", number)
);

-- Notes that come back from the client (returned PDF reports).
CREATE TABLE IF NOT EXISTS content_check_client_notes (
  id              SERIAL PRIMARY KEY,
  "jobId"         INTEGER NOT NULL REFERENCES content_check_jobs(id) ON DELETE CASCADE,
  "userId"        INTEGER NOT NULL,
  "roundNumber"   INTEGER NOT NULL,                      -- which round's report it answers
  "itemId"        INTEGER REFERENCES content_check_items(id) ON DELETE SET NULL,
  ref             TEXT,                                  -- 'R7' or NULL for a new request
  text            TEXT NOT NULL,
  "newWording"    TEXT,
  source          TEXT NOT NULL,                         -- 'form' | 'annotation' | 'scan'
  confirmed       BOOLEAN NOT NULL DEFAULT false,        -- scans start unconfirmed
  status          TEXT NOT NULL DEFAULT 'open',          -- 'open' | 'resolved' | 'sent_to_developer'
  "attachmentId"  INTEGER,                               -- the uploaded PDF (server/utils/attachments.js)
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

**Snapshot shape (versioned).** Block-level, so that future section and image checks can use it without fetching again:

```json
{
  "v": 1,
  "meta": { "title": "...", "finalUrl": "...", "fetchedVia": "plain", "chars": 18234 },
  "blocks": [
    { "id": "b12", "type": "heading", "level": 2, "text": "Exhibitions", "section": ["Dorothy Stoner", "Exhibitions"] },
    { "id": "b13", "type": "p", "text": "...", "section": ["Dorothy Stoner", "Exhibitions"] },
    { "id": "b14", "type": "img", "src": "...", "alt": "...", "caption": "...", "section": [...] }
  ]
}
```

Block types: `heading`, `p`, `li`, `td`, `caption`, `quote`, `link`, `img`. Normalise the text for comparison (non-breaking spaces, soft hyphens, entities, runs of whitespace, curly versus straight quotes), but **keep the original text for display**. Treat case and dash differences as real changes. Set the size cap in config and name it in the docs.

**`results` JSONB:**
- `diff`: change list against round 0 **and** against the previous round. Each change has an id (`c1`…), a type (added / removed / changed), block ids and a word diff.
- `matches`: AI labels, `{ itemRef: { changeIds: [...], reason, model, at } }`, plus `unmatchedItems` and `unrequestedChanges`, both computed by code from the labels.

Future modules add their own keys (e.g. `checks`, `images`) without a schema change.

**Recycle bin.** Deleting a job uses `moveToBin` in the same transaction, with a restore adapter covering its items, rounds and client notes. Follow `docs/recycle-bin.md`.

---

## 3. API

Mount at `/api/html-content-check` in a new route file `server/routes/htmlContentCheck.js`. It sits behind `requireAuth` (global) and `requireFeature('htmlContentCheck')`. Every query filters by `"userId"`, and every id from the request is checked against its owner. Named routes go before `/:id`. Log with `getLogger()`, never logging page content or request text.

Put **routes that call a model on their own sub-router with `aiLimiter`**, so reads and fetches don't count against the AI limit (Translate hit this problem). Give fetch and render routes their own modest rate limit, on the DocCompare fetch pattern.

| Method & path | Does | Limits |
|---|---|---|
| `GET /jobs` | List, with search and per-job progress (rounds, open client notes) | |
| `POST /jobs` | Create a job, split the request into items (R1…, plain code split by line or bullet, editable), fetch round 0 | fetch limit |
| `GET /jobs/:id` | Job, items, round summaries | |
| `PATCH /jobs/:id` | Name, request, previous text, client, ticket, status, settings | |
| `DELETE /jobs/:id` | `moveToBin` | |
| `PUT /jobs/:id/items` | Replace the item list (edit, split, merge, reorder). Refs that already appear on a sent report never change or get reused. | |
| `POST /jobs/:id/rounds` | Fetch a new round (plain, browser or upload via `multer`), extract, diff | fetch limit |
| `GET /jobs/:id/rounds/:number` | Full round: snapshot and results | |
| `POST /jobs/:id/rounds/:number/match` | AI labels request lines against changes | `aiLimiter` |
| `GET /jobs/:id/rounds/:number/report.pdf` | Client report, fillable | |
| `POST /jobs/:id/returns` | Upload a returned report PDF and parse it into client notes | upload size limit; `aiLimiter` only on the scan path |
| `PATCH /client-notes/:id` | Confirm, edit, resolve, or turn into a new item | |

### AI matching (`server/services/htmlContentCheck/match.js`)

- Model: `getModelsForUser(userId).standard`. No model ids in code. Log usage per call.
- Input: the items (ref and text) and the change list (id, type, short before and after text, section path). **Both the request and the page text are untrusted data.** Put them in delimited data blocks and tell the model to ignore any instructions inside them.
- Output: strict JSON, validated by a schema. Drop any change id that doesn't exist and any ref that isn't known. If a line can't be parsed, show "could not read this line" rather than guessing.
- The model never says whether an edit is correct. It says which change(s) look like they answer a line, and why, in one short sentence.

### Returned reports (`server/services/htmlContentCheck/returns.js`)

1. Read the AcroForm fields with `pdf-lib`. The hidden fields `hcc_job` and `hcc_round` identify the job and round. If the round isn't the latest, warn: "This is the report from round 2; the latest is round 3."
2. Read the annotations (comments, highlights, sticky notes) with `pdfjs-dist`, and map each to the row whose area it sits in.
3. Use the scan path only if steps 1 and 2 find nothing and the pages are images. Use a vision-capable model, following PDF Tools' "model that can see pictures" setting and fallback. All notes from scans are stored with `confirmed = false`.

Store the uploaded file through `server/utils/attachments.js`, so it counts against the per-user quota.

### Field naming in the report

Every field name includes the job and round, e.g. `hcc_42_r2_R7_note`, `hcc_42_r2_change3_ref`, `hcc_42_r2_change3_text`, `hcc_42_r2_change3_wording`, `hcc_42_r2_approved`, `hcc_42_r2_name`, `hcc_42_r2_date`. That way a renamed or forwarded file still maps back to the right job.

---

## 4. UI

Page `/html-content-check`. Add it once to `client/src/config/appNavigation.js` (Web & SEO), with a route in `App.jsx`. Add the flag to both feature-access files with the same default, and a `FEATURE_LIFECYCLE` `preview` entry on both sides. Use the same layout as DocCompare and Contract Review: a tool list on the left, a "What do you want to do?" job screen, and a job bar. Use the full desktop width, with two columns from `xl`.

**Job tiles**
- *Check a change request.* Page address and pasted request, plus optional previous text, client and ticket.
- *Just compare a page.* Page address only. Gives the baseline now and rounds later.
- *Read a client's returned report.* Upload a PDF; it finds the job from the hidden fields.

**Screens**
- **Jobs.** List, search, last round, open client notes, status. Use `Skeleton` and `EmptyState`.
- **New job.** `VoiceInput` on the request and previous-text boxes. A "Load in a real browser" tick. Upload a saved copy instead.
- **Job › Changes.** Changes in reading order with word diffs, and a "since baseline / since last round" switch. On `request` jobs, the request lines sit in a side column. Clicking a line highlights the changes the AI linked to it, and the person can relink or unlink by hand (stored in `results.matches` with `by: 'person'`). Code lists **Lines with no change found** and **Changes nobody asked for**. A "Match to request" button runs the AI behind `ProcessingModal`.
- **Job › Rounds.** Timeline of rounds: when fetched, how (plain, browser, upload), and the number of changes. A **Check again** button starts a new round.
- **Job › Client report.** Preview, and **Download fillable PDF** for any round.
- **Job › Client notes.** Notes from returned reports, grouped by ref. Each note can be confirmed (scans), resolved, or turned into a new request line ("Add to request"), which gives it the next free ref.

**House parts:** `apiClient` for every call; `Dialog` for modals; inline Yes / No for routine deletes; `Tooltip` on every control; the (i) box (`ToolInfoModal`); the compass tour; the guide chat (`TutorChat`, registered in `server/config/guides.js` with its catalogue matching the tool list); `getIcon` (register any new icons in the icon map); theme colours only; hover by opacity; 200 ms transitions; toasts for quick feedback.

**Client report PDF layout**
- Grouped by page (since M4b): one section per page, with its own address and date.
- Header: job name, page address, round number and date, with the line "This shows the page as it was on <date>".
- One row per request line: ref, request text, before and after with the changed words marked, and a notes field.
- Changed images as before and after thumbnails, if the snapshot has them (optional in v1).
- Further changes table with 8 numbered lines: Refers to / What should change / New wording.
- Approved as is tickbox, name and date fields, and the hidden `hcc_job` and `hcc_round` fields.
- Footer instruction: "Fill in on a computer, or print, write and scan. Quote the R number for each change."
- No internal labels and no raw diff markup.

---

## 5. DocCompare pointer (milestone 8)

The only change to DocCompare in this brief:

- When someone fetches a web page by URL or starts a second page round in DocCompare, **and** has the `htmlContentCheck` flag, show one inline notice: "Checking a list of requested edits on this page? HTML Content Check can tick them off and make a client report."
- An **Open in HTML Content Check** button creates a job with the page address and imports DocCompare's earliest page round as round 0, so nothing is fetched twice. If importing isn't practical, carry the address only and say so in the Changelog.
- It can be dismissed, and remembers that per person. It is inline, not a popup.
- Add one line about the new tool to DocCompare's guide and (i) box. Don't change anything else in DocCompare. Run DocCompare's tests before and after.

---

## 6. Extension points (design for these, don't build them)

Keep these possible without rework, and describe each in `docs/html-content-check.md` under "Future":

1. **Checklist engine.** New `content_check_items.kind` values (`remove`, `replace`, `insert`, `image`; `held_over` and `keep` already exist since M4b, in a simple form), with `oldText`, `newText` and `section` added as columns later. A pure module, `server/services/htmlContentCheck/checks/`, with the signature `runChecks({ baseline, previous, current, items }) → { [itemRef]: result }`, stored under `results.checks`. Design rules for when it's built: old text must be found in the baseline; new text must be absent from the baseline; a close match counts only if it is nearer the new text than the old; text where only case or quotes changed is compared strictly.
2. **Accept and broken-again.** A future `content_check_acceptances` table (item, round, by, at). Re-checks compare against accepted rounds.
3. **Learned rules.** A future `content_check_rules` table, per person, with admin sharing. They go into the matching prompt, capped in count and length.
4. **Scheduled re-checks.** A cron inside `withCronLock` that fetches new rounds for open jobs and raises "page changed since approval" through `SuggestionService.captureIf()`. This is why snapshots are produced on the server.
5. **Image fingerprints.** `sharp` perceptual hash per `img` block under `results.images`, so a changed address with the same picture isn't reported.
6. **Ignore rules.** Per-job `settings.ignore` (block text patterns or sections) for dynamic content such as dates or news boxes, applied by the diff before display.
7. **Client shared link.** A shared-link route registered before `requireAuth`, on Vault's existing shared-link pattern, as an alternative to the PDF.
8. **Word export.** For parity with DocCompare (see section 9).

Keep the code modular so these slot in: `extract.js` (snapshot), `diff.js` (pure), `match.js` (AI), `report.js` (PDF), `returns.js` (reading back), and a `checks/` folder created only when it's needed.

---

## 7. Conventions checklist (check each milestone against this)

- [ ] Routes behind `requireAuth` and `requireFeature('htmlContentCheck')`; every query filters by `"userId"`; ids checked against their owner; named routes before `/:id`
- [ ] Flag in `server/config/featureAccess.js` and `client/src/utils/featureAccess.js` with the same default; `FEATURE_LIFECYCLE` `preview` on both sides
- [ ] Page added once in `appNavigation.js` and as a route in `App.jsx`; nothing added to Layout by hand
- [ ] `aiLimiter` on every mount that calls a model; reads and fetches kept off it
- [ ] Models from `getModelsForUser()`; no model ids in code; usage logged
- [ ] Outside URLs only through `safeFetch` / `htmlFetch.checkSsrf` / `renderPage.js`
- [ ] Every `/api/` call through `apiClient`
- [ ] `Dialog`, `Tooltip`, `ToolInfoModal`, tour, `TutorChat` guide plus catalogue, `VoiceInput`, `Skeleton`, `EmptyState`, `ProcessingModal`, `getIcon`; theme colours; hover by opacity; 200 ms transitions; full width with two columns from `xl`
- [ ] Deletes through `moveToBin` in the same transaction, with a restore adapter
- [ ] `getLogger()`; no `console.*`; no page or request text in logs
- [ ] Raw parameterised SQL; idempotent DDL; camelCase columns double-quoted; counts wrapped in `Number()`; BEGIN / COMMIT / ROLLBACK
- [ ] Anomalies the code detects go through `SuggestionService` (none expected in v1; note if any appear)
- [ ] Tests run with `node path/to/file.test.js`; none added to package.json
- [ ] New routes classified in the route manifest; cross-user test covers the new routes
- [ ] `docs/html-content-check.md` written and the key files added to `docs/key-files.md`
- [ ] Changelog entry for every commit, in a separate `Changelog:` commit, with honest concerns, including what was **not** tried in a browser or against a real model
- [ ] No `package.json` or lockfile change without asking me first

---

## 8. Milestones (one Claude Code session each)

Each milestone goes on its own branch, is tested, gets its Changelog entry, and is **merged only when I say so**. Stop at the end of each one and report. If a milestone turns out bigger than one session, stop at a clean point and say what's left, rather than skipping tests or the browser check.

**M1: Foundations and answers.**
- Answer the four open questions.
- Flag, lifecycle, navigation, route file and empty page with the layout and job tiles.
- Tables; jobs list, create (without fetching yet), update and delete with the recycle bin.
- Item splitting and editing.
- **Propose any changes** to the schema, routes and snapshot shape, based on what you found. **Wait for my OK before M2.**

*Tests:* routes, ownership and cross-user; the bin adapter restores items; the item splitter on fixtures.

**M2: Fetch and extraction.**
- Full-text extraction (`mode: 'full'`) into the snapshot (agreed in M1).
- Plain fetch with a real-browser fallback; saved-copy upload; size cap that fails.
- Round 0 fetched on create; Check again stores a new round; failed rounds stored with their error.
- A minimal Rounds list showing each round's date, fetch method and status.

*Tests:* extraction fixtures (including a page with edits in the sidebar, a caption and the footer, which must all survive); normalisation; the over-cap failure; a fallback trigger on a near-empty page; a redirected address stored as `finalUrl`.

**M3: Diff and screens.**
- Diff against the baseline and against the previous round, stored in `results.diff`.
- The Changes screen with word diffs and the since-baseline / since-last-round switch.
- The full Rounds timeline.
- `compare` jobs work end to end.

*Tests:* the diff on fixtures (added, removed, changed, moved blocks; case and dash changes reported; whitespace-only changes ignored); stable change ids for a given pair of snapshots.

**M4: Matching the request.**
- AI labels, schema validation, linking and unlinking by hand.
- Lines with no change found; changes nobody asked for.

*Tests:* the schema; unknown ids dropped; injection text inside the request and page treated as data; a recorded model response used as a fixed fixture (no live model in the automated tests).

**M4b: Several pages (added by the owner, 2026-11-26, from the real Dorothy Stoner request).** Done. A job holds several pages (`content_check_pages`: job, address, label, order, reading method); each existing job's address became its page 1. A round reads all of a job's pages; diffs are per page. Request lines belong to a page or to none (none: matched against all pages); "Under …" lines become page or section labels, not request lines; lines can be assigned to pages on review. Matching runs per page with that page's lines and changes only. Line kinds: Normal, Held over (never checked, shown as held) and Keep (warned if its text changed or disappeared). Likely duplicate lines are flagged to merge. The Changes and Rounds screens show pages. The fixed splitter test is the owner's request. Details: `docs/html-content-check.md`, "Several pages".

**M5: Client report.**
- Fillable PDF with the agreed layout and field names, using Vault's existing fillable-PDF code.

*Tests:* create a report, fill it programmatically, read it back, and check the round trip of every field. Hidden fields present; nothing flattened.

**M6: Returned reports: forms and comments.**
- Upload, stored through `attachments.js`.
- Form fields read with `pdf-lib`; PDF comments read with `pdfjs-dist` and mapped to rows.
- Wrong-round warning; the Client notes screen; resolve; Add to request.

*Tests:* a filled form fixture; an annotation fixture; a forwarded file with a changed name; a stale round; a PDF that isn't one of our reports is rejected clearly.

**M7: Returned reports: scans.**
- Scan path for image-only PDFs, using a vision-capable model on PDF Tools' model setting and fallback, behind `aiLimiter`.
- All notes from scans stored as unconfirmed drafts; confirm and edit on the Client notes screen.

*Tests:* the scan path with a stand-in model; unconfirmed notes never become request lines without confirmation; usage logged.

**M8: DocCompare pointer, help and real check.**
- The pointer in DocCompare. Import DocCompare's earliest page round if its rounds are reachable from the server; if they live only in the browser, carry the address only and say so.
- Guide chat, tour and (i) box; `docs/html-content-check.md`; `key-files.md`.
- Browser check in the production container.
- The real test: the Dorothy Stoner artist page (address: **ASK ME**) with my actual change request, before and after the developer's changes.

*Tests:* the guide drift test; DocCompare's tests unchanged; a real-browser run with screenshots in the Changelog notes.

---

## 9. Parity checklist (needed before DocCompare's web mode can be removed later)

Made exact in M1 from DocCompare's code, updated with the owner's decisions of 2026-11-26 (kept in step with `docs/html-content-check.md`). HTML Content Check must cover each open item before a removal brief is written:

- [x] Fetch a page by URL (SSRF-guarded, the same limits as DocCompare) (M2)
- [x] Open a saved page (`.html`/`.htm`) instead of fetching (M2)
- [x] HTML reader output at least as complete as DocCompare's: the same reader, in full mode (M2)
- [x] Page details: title, author, dates, generator, the page's own address (M2)
- [x] Almost-no-text pages: real browser first, then a clear failure with advice to upload a saved copy (M2)
- [x] Page rounds and timeline, with change counts (M2, M3). An unchanged page is stored as a round, not refused.
- [x] Comparing without a request (`compare` jobs) (M3)
- [ ] Review PDF for the author or developer: the client report (M5); changes nobody asked for are left out by default, with an "Include changes nobody asked for" option
- Dropped: Word export, and with it comparing a web page with a Word file
- Not carried over: DocCompare's document checks (claims, quotes, spelling, terms, numbering, limits); spelling on changed text is a future idea
- Out of scope: verdict, Accept / Fix later and the accepted state (the future checklist engine); project export / import (jobs live on the server)

---

## 10. Tests summary

Plain `node` test files next to the code, on the house pattern. Pure modules (`extract`, `diff`, `report` field naming, `returns` parsing) get thorough unit tests on fixtures. Routes get ownership and cross-user tests. No automated test calls a live model or a live site. Live checks are manual, and are recorded honestly in the Changelog.
