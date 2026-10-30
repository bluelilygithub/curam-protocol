# Email Follow-Up (built into Vault)

Status: **built, behind the `emailFollowUp` feature flag (off by default), not yet used on a real mailbox or a real model.**
Design set: `email-follow-up-context.md`, `email-follow-up-case-model.md` (locked rules), `email-follow-up-use-cases.md`, `email-follow-up-risk-register.md`, `email-follow-up-fixture-plan.md`. This file says what was actually built from them and where it differs.

## What it is, in Vault terms

A page at `/email-follow-up` (Research & Utilities, switch on in Settings -> Feature Access). A person **opens a case by hand** ("Acme owes the Q3 ledger"), attaches Gmail threads to it, presses **Read** so the AI proposes ledger rows, presses **Check Sent**, and then asks for a **follow-up draft** on any open row. The draft is plain text to copy into their own mail program.

It adds to Vault and replaces nothing: no existing route, table or page was changed. It reuses Vault's existing read-only Gmail connection (`routes/gmail.js`, one extra export `extractBody`), the model resolver (`light` tier), `logUsage`, the Tasks table (optional "Make a task"), and the CRM client list (optional link). It never calls `POST /api/email` or any send function; Gmail scopes stay read-only.

## Decision made in this build (changes the design set)

The design set recommended a **separate local product** with Vault as an optional one-way consumer. This build puts it **inside Vault** instead, at the owner's request. What that costs, so it is not forgotten: case mail and the ledger now live in the shared Postgres, and extracted message text goes to the configured model (Claude or Gemini), exactly like the rest of Vault. The design set called this a problem for medical, mortgage and escrow cases. **Scope is therefore the accounting document chase, freelance and job-search cases only; do not use it for the deferred verticals.**

## Where the code is

| Piece | File |
|---|---|
| Rules (all pure, no database or clock) | `server/services/emailFollowUp/` : `ledger.js` (supersession, disagreeing figures, claim types, conditional closing, authority lock, ageing), `deadlines.js`, `guard.js` (incl. the OCR rule), `approval.js`, `gates.js`, `draft.js`, `coverage.js`, `common.js` |
| Attachments | `attachmentText.js` (file to text: PDF, Word, plain text; refuses disguised programs; says why a file was not read), `ocrPdf.js` (scanned PDF pages, reusing Contract Review's `pdftoppm` and Tesseract pool); fetched by `caseStore.fetchAttachments` |
| The only model use | `extract.js` (reads one message into proposed rows; no tools; email fenced as data; every quote must be word-for-word in the message or the row is dropped; deadlines parsed by code) |
| Database + Gmail | `caseStore.js`; tables `ef_cases` (ledger kept as one JSON array per case), `ef_sources`, `ef_drafts`, `ef_approvals` (append-only), `ef_sent_sweeps` in `server/db.js` |
| API | `server/routes/emailFollowUp.js` at `/api/email-follow-up`: cases, `GET /:id/suggestions`, `GET /:id/threads/:threadId/preview` (read-only look before attaching), `POST /:id/threads`, `POST /:id/attachments`, `POST /:id/extract`, `POST /:id/sent-sweep`, row actions, drafts (approve, copy, edit, decline) |
| Page | `client/src/pages/EmailFollowUpPage.jsx`, `client/src/pages/emailFollowUp/CaseView.jsx`, `labels.mjs` |
| Help, tips, tour, guide | `emailFollowUp/emailFollowUpTools.mjs` (the five places, group and tool tips, the (i) box text, what the guide can point at), `emailFollowUp/efTips.mjs` (one tip per control), `emailFollowUp/EmailFollowUpTutorChat.jsx`, `client/src/utils/tours/emailFollowUpTour.js`, `server/services/emailFollowUpTutor.js` + `server/routes/emailFollowUpTutor.js` (`POST /api/email-follow-up-tutor`), registered in `server/config/guides.js` |
| Tests | `npm run test:email-follow-up` (24 fixtures + unit checks incl. attachment reading and OCR decisions, extractor with a fake model, labels, tips/helpers, guide, a real-Tesseract test, and the route/storage test); `npm run test:email-follow-up-tutor` for the guide alone; `npm run test:guides` |

## Helpers (the Vault tool conventions)

- **Tooltips:** every button, field, dropdown, tick box and tab uses the shared `Tooltip` with a sentence from `efTips.mjs`, never a native `title=""`. `efTips.test.mjs` fails if a control has no tip, uses a native title, or a tip is not a proper sentence (checked by breaking one on purpose: it names the control).
- **(i) box:** "How Email Follow-Up Works", opens once per browser (`vault_email_follow_up_info_seen`), reopen with the (i) beside the title.
- **Two-way link with the CRM.** A case can be linked to a CRM client (chosen when the case is opened, or later with **Change client** / **Link to a client** under the case title). From the case, **Open in CRM** goes to the client's page; on the client's page (`ClientDetailPage.jsx`) a new **Email follow-up** section lists that client's cases (each opens the case) and **New case for this client** opens Email Follow-Up with the form ready and the client chosen (`/email-follow-up?new=1&clientId=N`). The section is drawn only when the tool is on for the person (`components/LinkedEmailFollowUp.jsx`, `GET /api/email-follow-up?clientId=N`), the same quiet pattern as the Research section. A client id must be the caller's own; linking changes nothing in the CRM, and a task made from a case sits under the linked client.
- **Preview before attaching:** each suggested thread shows a snippet and a **Preview** button that opens the emails in it (read-only, nothing stored).
- **Compass tour:** 7 steps (`vault_tour_email_follow_up_completed`); a step whose target is not on screen (for example the tabs while you are on the case list) shows in the middle of the screen instead of failing. Retake it from the compass, or **Settings -> Email Follow-Up Tour** (opens `/email-follow-up?tour=1`).
- **Guide chat:** the round button, shared `TutorChat`, `guideId` `email-follow-up`. It points at the real controls (its Open buttons switch the tab, or go back to the case list, and need a case open for the tabs), says what the tool does not do, and sees no cases, emails or drafts. Update `CATALOG` in `emailFollowUpTutor.js` and `GUIDE_TOOLS` in `emailFollowUpTools.mjs` together; the test fails if they drift.
- **Microphone:** on the free-text fields (case name, what is owed, notes, their words, subject) through the shared `VoiceInput`.
- **Cross-user route list:** the 19 routes are in `server/testing/routeManifest.json` as `authed`. (Running `crossUser.test.js --update` rewrote about 400 unrelated lines because the manifest was already out of date, so only these entries were added by hand; the inventory step of that test still fails on 62 other routes that were missing before this work.)

## What was built from the spec, and how

- **Manual cases only (1.1, 1.2).** `POST /` needs a title and an obligation. Mail is only ever *suggested* (`GET /:id/suggestions`) and attached when the person presses Attach. There is no inbound queue because nothing ingests automatically, so Rule 1.3 (queue expiry) has nothing to apply to; `gates.suggestCaseForMessage` stays as the tested invariant.
- **Ledger rules (4.x, 3.x, 11.x)** as written: structured identity, superseding rows with the change in words, `conditional` can never be closed by "thanks", an unconfirmed substitute cannot clear anything, ageing turns rows `unverified` (the function exists and is tested; **no job calls it yet**, see "Not built").
- **Deadlines (5.x).** Code reads the person's own words against the message's sent date in the person's time zone (`resolveUserTimezone`, the same rule Fitness uses). "Early next week", "next Friday", "within 14 days of receipt" with no stated receipt date, and business days with no pinned calendar all come back `needs_review` with what is missing. Nothing is guessed.
- **Guard (7.x).** Deterministic only: citation exists, clause exists, version current, the cited text is still the same bytes, figures present in the span, hedges ("might", "if") and negations preserved, "as agreed" refused unless the row is `agreed`. Paraphrase is `needs_review`, never `pass`. **No model judges a draft.**
- **Drafting (7.1).** Retrieve first, then assemble: a draft is fixed sentence templates around the row's own quoted words. **No model writes any draft prose.** This is narrower than the spec (which allowed a generator); it makes drafts repeatable and removes the unmeasured "generation quality" risk. Wording cannot be edited in the page for the same reason (the body *is* the cited claims); recipients and subject can, and an edit mints a new version (9.2).
- **Sent reconciliation (10.x).** "Check Sent" lists the case's Sent mail across every address in the case (per case, never per party) and records a watermark. Chasing someone needs a sweep covering the request date to now (15 minutes' tolerance): **Draft follow-up makes the check itself when the last one is older**, and if it cannot be made (Gmail down, no addresses on the case) nothing is drafted. A failed sweep is recorded as not completed. After a sweep, mail sent to that person since the request is shown as a warning the person must accept ("check none already answers this"). The tool does not decide that a Sent message answers a row; a person does.
- **Approval and copy (9.x).** Approval hashes the whole outbound object (subject, body, To, Cc, Bcc, reply chain, citations). **Copy** re-reads Gmail for new mail in the cited threads and refuses (and resets to pending) if the counterparty wrote or a cited thread grew; if Gmail cannot be read, copy is refused. Copy also runs the guard again under the case's current checking: a source that has since become unreadable, or a warning that was not accepted at approval, sends the draft back to pending. Changing a case's profile sends its approved drafts back to pending too. Absence of an approval record means no.
- **Review capacity (8.x).** At most 5 drafts waiting per case; above that, no new drafts.
- **Coverage statement (11.3).** Shown on the "What was covered" tab: what was read, what this tool cannot see (phone, portals, other mailboxes, how many attachments were read and which were not, grouped by reason, Sent if unchecked), what the person must verify. A row whose email never mentioned a deadline shows "no deadline stated" and is not listed as something to check; only a deadline someone said and the tool could not work out is. "Not fetched yet" counts only attachments on messages the Get attachments step has not finished (the same picture attached twice to one email is stored once and is not unfetched).

## Not built (honest list)

- **Plain pictures and spreadsheets are not read.** Photos and logos (`.png`, `.jpg`) are kept as "not read" with the reason, because most are signature logos and OCR on them would be slow noise; a photographed invoice is therefore not read. Spreadsheets are kept as not read too (the installed `xlsx` reader is too old to trust with strangers' files). Handwriting and poor scans may come back as "OCR could not read it reliably".
- **OCR has not been run end to end on the server.** The real Tesseract engine is tested on a picture of an invoice (`ocrPdf.test.js`, 95% confidence, total read correctly), but the page-to-picture step uses poppler's `pdftoppm` (already in the Dockerfile for Contract Review) and that tool is not installed on this PC, so the first real scanned PDF on Railway is the first full run. If `pdftoppm` is ever missing there, each scan is recorded as failed with "OCR is not available on this server" and is **not retried** (the message is marked fetched).
- **No governing documents yet.** `governing` is stored but there is no upload for a contract or a request list; the gate is vacuous, which is legal per Rule 1.4. The attachment reader could be pointed at this next.
- **Attachment reading has not been run on a real mailbox.** It is tested with real PDFs generated in the tests and a fake Gmail in a local database, not against Gmail itself.
- **Ageing (§11.2) is not wired.** `ageRows()` is tested but nothing calls it, so rows never become `unverified`.
- **Source versions (§2.3/2.4) do not exist.** One version of each source is stored and never re-read.
- **The §6 export gates are not called**, governing items cannot be added, and a file that could not be read cannot be tied to an obligation (so §6.1 cannot fire). The coverage statement is the only warning about unreadable files.
- **The "answered / chased in Sent" branches of `canDraft` are not fed by the app** (the SENT_SINCE warning does that job).
  All four are logged in the case model as v1.0.3.
- **Suggestions inbox hook.** Nothing here calls `SuggestionService.capture()` yet (for example when a Sent check keeps failing or rows go unverified). The guide route also does not file a "something is missing" suggestion beyond what `guideRouter` already does.
- **No microphone on email-address boxes** (case people, recipients, "who took over"): a spoken address is too error-prone, so those stay typed.
- **Not run against a real model or mailbox.** Rate of correct extraction (fixture plan Rule S2), the misrepresented-claim rate (7.5) and retrieval recall (7.6) are all still unmeasured.
- **The UI has not been looked at in a browser.** It compiles and the API behind it passes a smoke test against the local Postgres (22 route checks), nothing more.

## Finishing with a case: close, set aside, remove, delete

"Delete a case" was three different requests, and only one of them is a delete.

- **Close** ("this matter is finished"). **Close case** in the case header, with an optional reason; **Reopen** undoes it. A closed case is **read-only**: nothing new is read, attached, fetched, checked, drafted, approved, edited or copied, and no row can be changed, until it is reopened. Open rows and waiting drafts are not touched (closing does not rewrite history; the header says how many there are when you close). The case list shows open cases only, with **Show closed cases (N)**. It is the right end state for a finished matter: the case is the record of what was read, quoted and approved.
- **Set aside / Remove** ("the wrong thread got attached"). On the Mail tab each thread has **Set aside** (kept in the case, so anything that quotes it still resolves, but it is no longer read, fetched or counted; **Bring back** undoes it) and **Remove** (deletes the thread and its attachments for good). Remove is **refused when a ledger row or a draft quotes the thread**, and says what does: nothing is ever silently re-anchored (case model 2.4), so a quoted thread is set aside instead. The coverage statement names set-aside items as "kept but not read".
- **Delete** ("this was a mistake" or "this data must not be here"). **Delete this case…** inside the case only, never from a list card. The panel shows what goes (messages, attachments, drafts, approval records, Sent checks, ledger rows), says Gmail is not touched and that tasks made from the case stay, and asks you to **type the case name**. If any draft was ever approved there is a second, explicit tick: deleting deletes the record that it was approved and copied, and Vault keeps no other copy of that wording. Allowed, not blocked: erasure is a legitimate reason. By default a copy waits **30 days in the shared recycle bin** (Settings, Recycle bin; `adapters/emailFollowUp.js`, kind `email-follow-up-case`) and the toast has Undo; **Delete forever** skips the copy. Restoring puts back the case, every message and attachment (same ids, so the ledger's quotes still point at them), every draft with its approval records and the Sent checks; the client link is dropped only if the client has since gone. A case too big for the bin (25 MB; the default 5 MB is raised for this kind) is refused with "delete forever instead". Why the bin and not a hard delete: it is the convention for every tool that deletes (docs/recycle-bin.md), a mistaken delete is recoverable, and the bin's own **Delete forever** covers erasure.

Tested in `server/routes/emailFollowUp.test.js`, with nine rules broken one at a time to confirm each is noticed (including that a closed case refuses to copy, approve or edit an existing draft).

## Limits per press

A button never does unlimited work in one request. The ones that can have more to do say so, and pressing again carries on.

| Button | Per press | If there is more |
|---|---|---|
| 1. Find mail | Looks through up to 200 Gmail threads (50 a page), newest first, skipping those already attached, and shows 12 | Says "older threads remain": attach what you need and press again to reach further back. (It used to look at only the newest 15, so once those were attached it showed nothing.) |
| 2. Get attachments | 12 downloads, about 50 seconds, 3 scanned files by OCR | "N more messages to go: press again" |
| 3. Read | 10 messages or attachments | "N more to read" |
| 4. Check Sent | 100 sent messages (one Gmail page) | Carries on from where it stopped; counts as finished only when the last page is done, and drafting waits until then. The page position is kept for 30 minutes. |

**Check Sent in detail.** Each press reads one page of Sent. A failure part-way is recorded as an error and the next press starts again, but messages already stored are not downloaded twice. Once a check has finished, a later check only searches the recent tail (from an hour before the last one) as long as it covers the same addresses and reaches back at least as far as the case now needs; adding an address to the case, or attaching older mail, makes the next check look back over the whole window again. (It used to stop at 300 sent messages with "narrow the case first", with no way to narrow it, which left drafting blocked for good on a long-running client.) Draft follow-up starts the check itself if it is stale; on a big Sent folder it says the check takes a few steps and drafts nothing until you have pressed Check Sent through to the end.

**Rate limit.** Every route that calls Gmail (Find mail, preview, attach, Get attachments, Check Sent, drafting, copying) is limited to 60 a minute per person; Read has its own AI limit.

## Route and storage test

`server/routes/emailFollowUp.test.js` runs the real routes and storage against a throwaway local Postgres with a stand-in for Gmail and for the model (the rule suite cannot see what the app does with its rules). It needs `EF_TEST_DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_local`; without it, it prints `SKIPPED` and passes, so `npm run test:email-follow-up` stays runnable anywhere. It refuses a database that is not on this machine and deletes the two users it makes. It covers: a client/project id that is not yours is refused; a model failure on the third message keeps the first two and a second press carries on; two Reads at once read each message once; a Read while a task is made keeps both changes; the ledger lock itself (two slow changes at once both survive; a change that throws leaves the ledger as it was); a profile change sends approved drafts back; copy re-checks the guard; Draft follow-up checks Sent itself, drafts nothing if it cannot, and checks again when the last check is stale. All seven fixes were broken one at a time to prove the test notices (it found a bug in the first version of the profile fix).

## OCR (scanned PDFs)

`ocrPdf.js` reuses what Vault already has rather than adding a third copy: poppler's `pdftoppm` to turn a page into a picture (`contractReview/pdfRasterize.js`) and the tesseract.js worker pool (`contractReview/ocrScheduler.js`, English, shuts itself down when idle). Both load on first use.

- **Per page, not per file.** A page with a text layer is used as it is; only pages with less than 15 characters of text are sent to OCR, then everything is joined in page order (parser `pdfjs+tesseract`, or `tesseract` if every page was a scan). At most 10 scanned pages per file; the rest are named in the reason.
- **Limits per press:** 12 downloads and 3 scanned files by OCR. A scanned file beyond the third is left for the next press, not recorded as unread, and pressing again picks it up (tested against the database).
- **Confidence.** Tesseract's average confidence over the pages it read must be 55% or more, otherwise the file is kept as "not read: OCR could not read it reliably (confidence N%)". Nothing is put in a ledger from a page the engine itself doubts.
- **A guess is labelled as one.** OCR can misread a digit and the ledger would quote the misreading faithfully, so: the source is marked as OCR; the row card shows "from a scan (OCR)"; the guard turns any claim quoted from an OCR source from `pass` into `needs_review` (`OCR_SOURCE`, §2.6) so a person must tick it, and so a draft built from a scan always asks you to check the figure against the original; the coverage statement counts scans read by OCR and says to check their figures. A claim whose figure is not in the OCR text at all still fails outright.
- **Failure is visible.** No poppler or no engine gives "OCR is not available on this server"; an engine error gives "OCR failed (...)"; both are recorded against the file.
- Tests: unit checks with a fake engine for every decision above, fixture 24, mutation checks (seven rules broken one at a time, all caught), and a real-engine test.

## Fixtures

24 fixtures in `server/services/emailFollowUp/fixtures/` (rule suite, Rule S1): every one of the plan's 22 (01 to 22) plus **23** and **24** added here (24: a quote from a scan read by OCR is never a plain pass). 02 (the body and the attachment give different amounts) and 08 (a real PDF carrying instructions in its metadata, hidden text and a form field; stored as `attachments/Subcontractor_Invoice_1042.pdf`) arrived with attachment reading. Differences from the plan: `manifest.json` instead of `manifest.md` (so the harness can read it), and the hand-written extracted rows/drafts sit inside the manifest rather than in separate `expected_input/` files. Each fixture has a fixed `eval_now`/`eval_tz` and a named failure condition; a fixture without them is rejected by the runner (Rule 14.1).

**Mutation check.** To see whether the fixtures would actually catch a broken rule, ten rules were deliberately broken one at a time (merging a scope change, closing a conditional on affirmation, dropping the authority lock, hashing only the body, ignoring new mail at copy time, skipping the Sent sweep, guessing a date, locking a soft case on any unreadable file, accepting an unknown citation, ignoring a dropped hedge). Nine were caught at once. **One was not**: dropping a hedge ("might" stated as a flat fact) passed all 20 fixtures, because the only fixtures touching hedges were caught by a different check. That is why fixture 23 exists. The plan predicted the first run would change something; this is what changed.

## Decisions Log (additions to `email-follow-up-case-model.md`)

Recorded in the case model's own log as v1.0.2 (first build) and v1.0.3 (after a code review: what the product does not run, and what changed). In short:

1. **Fixture 23 added** (deterministic claim checks: hedge dropped, figure not in source, negation flipped, exact quote with hedge kept, paraphrase never passes).
2. **A paraphrase of hedged text that drops the hedge word fails (`HEDGE_DROPPED`) rather than going to `needs_review`.** Found when fixture 23's first draft expected `needs_review`. The stricter result stands: a reader should not be asked to approve a flat statement of something the source only floated.
3. **Drafts are template-assembled with no model prose** (see Drafting above).
4. **Sent reconciliation is human-decided after the sweep** (the SENT_SINCE warning) because deciding "this Sent mail answers that row" is exactly the semantic judgement the spec says must not be `pass`.

## Turning it on

Settings -> Feature Access -> Email Follow-Up. Admins always see it. Needs Gmail connected and a model set up in Settings (the `light` tier is used for reading messages). Members stay off until switched on per workspace or per user.
