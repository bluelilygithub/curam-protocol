# Commitments Ledger — Case Model (v1.0.1)

Status: **Locked at v1.0.1.** Spec only — no implementation code, no schema DDL. Single source of truth for a later build.

The document is closed to further review. The next change to it is a **fixture failure**, not another critique: anything reality forces to change is recorded in the Decisions Log at the bottom first, then applied as a numbered rule — never edited silently into the prose.

Scope: this describes a **separate product**, not a Vault feature. Same domain as Vault's Inbox Intel and Invoice Review; different architecture and trust model. It may later hand a *summary* to Vault, but it never depends on Vault and never syncs document bodies into it.

The product in one sentence: **a commitments ledger built on cases, with governing documents and a citation gate — email is one ingest channel, not the organising unit.**

---

## 1. Case

The unit of work. It is created by a human, and it is created **from an obligation**, not from a mailbox or an incoming message.

A case carries:

- identity, title, and `kind` (the vertical — accounting document chase, job search, construction variation, etc.)
- `profile` — `soft` or `professional` (see §6)
- `parties[]` — identity keys, not raw addresses (§3)
- `governing[]` — the documents that make obligations binding; **may be empty**
- `period` — when the matter is live
- `status` — `draft → active → awaiting → closed | abandoned`
- `coverage` — computed from sources, never typed by a human

**Rule 1.1 — Creation is manual.** A case exists only because a human opened one and named the obligation. No correlation engine, no "we noticed a contract in your inbox," no automatic matter creation.

**Rule 1.2 — Suggestion never initiates.** Inbound mail may be matched to an *existing* case (as a suggestion requiring acceptance), or it lands in the unmatched queue. It can never create a case, and it can never attach silently. This is the invariant the whole coverage gate rests on: a case's contents are a fact, not an inference.

**Rule 1.3 — The unmatched queue is rate-limited and its discards are content-free.** A hybrid threshold applies: an item expires after a configured TTL (default 14 days) **or** when the queue reaches its capacity ceiling (default 100 items), whichever comes first. Overflow evicts oldest-first. The discard receipt retains metadata only — `[timestamp, count, sender_domain_hash, Message-ID, reason]` — and message bodies and attachments are scrubbed on eviction.

Keeping evicted content "for audit" would retain unrelated third-party mail indefinitely, in the one component nobody ever opens. That is the opposite of this document's posture, and a receipt with a hash is enough to prove the item was seen and dropped without keeping what it said.

**Rule 1.4 — Zero governing sources is legal.** Soft-profile cases (job search, personal follow-through) frequently have no governing document. Completeness is then **vacuously satisfied**, not failed. Forcing a user to upload a placeholder to unlock the soft profile would corrupt anchor semantics, so the model must represent "no binding corpus" explicitly rather than defaulting to "missing."

Consequence to accept: first-run value is zero until a human opens a matter. Onboarding is *"start your Q3 document list,"* not *"connect your inbox."* The ingest loop feeds existing cases and the queue; it does not discover the product's value for the user.

---

## 2. Sources and anchors

Every attachment is a **source**. Sources are immutable; versions are not.

Source kinds: `message`, `document`, `extracted_text`, `human_note`.

Each source version records: channel, received-at, content hash, parser name and version, parse status (`parsed` / `reference_only` / `failed`), and the reason when it is not `parsed`.

**Rule 2.1 — Anchor to the text artifact, not the file.** A citation resolves against the extracted text produced at ingest — the stored text, the span within it, and the bounding boxes — all bound to that source *version*. The PDF is provenance; it is not the coordinate system. Re-OCR of the same file is a different artifact with different page breaks, and an anchor that assumes otherwise will fail honestly in the wrong direction.

**Rule 2.2 — An anchor is `(source_id, version_hash, locator, span_hash)`.** `locator` is the human-meaningful coordinate (page, clause, box, line, drawing revision). `span_hash` is the exact-text signature that lets the guard confirm it found the same bytes, not merely the same neighbourhood.

**Rule 2.3 — Never re-parse in place.** A new extraction or a re-uploaded document creates a **new source version** and marks the old one superseded. There is one mechanism here, not two.

**Rule 2.4 — Never auto-remap.** Citations are not silently moved from a superseded version to its replacement. Any draft citing a superseded version returns to `pending` with a named question: which version governs this claim. Quiet remapping is how a citation guard starts lying.

**Rule 2.5 — Human notes are first-class but not evidence.** A note is tagged `provenance: human`. It can close a row (§11). It is never cited as though a counterparty said it.

**Rule 2.6 — Parse failure blocks at the scope set by attribution.** `failed` blocks in both profiles; whether the block is case-wide or draft-only is decided by Rule 6.1, not by the profile. `reference_only` is allowed, but requires a stated reason and is listed in the coverage statement.

---

## 3. Parties and identity

`(display name, address)` is not a stable identity. One person has three addresses; one address is shared by a team; a display name changes on reply; a colleague takes over mid-matter. Merging two people's obligations into one row is worse than failing to merge them, so identity is explicit and human-controlled.

**Rule 3.1 — A party is an identity key with an alias table.** Addresses and display names are aliases pointing at a party. Aliases are added on evidence (the reply chain, a signature block, a human assertion) and are visible.

**Rule 3.2 — Asked and may-answer are separate fields.** `asked` is the party the obligation was directed at. `may_answer` is the set of parties or groups authorised to act for them.

**Rule 3.3 — A substitute suspends the ask and does not inherit it.** "John is out sick, I'll handle the audit request" satisfies nothing. The original row moves to `suspended`; a new row opens against the substitute with `authority: unconfirmed`. Only evidence of the *deliverable* satisfies a waiting-on — a document, an amount, a decision, a completed action.

**Rule 3.3a — Unconfirmed authority is a soft lock.** A row with `authority: unconfirmed` cannot clear an obligation, cannot be marked `met`, and cannot produce a formal status report, until authority is confirmed by the primary party, the governing party group, or a `provenance: human` note. Self-declaration is an offer of availability, not evidence of standing. Without this rule, the party-group hole closes on one side and reopens on the other: any colleague could discharge any obligation by asserting they had taken it over.

**Rule 3.4 — Merge and split are human-confirmed and append-only.** Both show the evidence that prompted them. There is no automatic identity resolution, for the same reason there is no automatic case assignment: a silent merge corrupts the ledger in a way that looks like data.

---

## 4. Ledger

Four record kinds, one row shape:

`kind` = `commitment | waiting_on | decision | deadline`
`direction` = `i_owe | they_owe | external`

`direction` exists because the engine serves both "someone owes me" and "I promised someone." Without it, outbound-only cases (executive follow-through) become a schema hack.

Each row carries: party, one normalised ask, claim type, due date (exact or `needs_review` with raw text preserved), status, binding anchor when one exists, evidence list, and supersede links.

**Rule 4.1 — Claim type is part of the record, not a confidence score.**

`claim_type` = `agreed | proposed | conditional | refused`

"I might be able to pay $4,000 next month if revenue allows" is `conditional`, with the condition stored verbatim. It is not an `agreed` commitment with a soft due date. Most review-card absurdity is an extraction bug wearing a UI costume, so the fix belongs here rather than in a highlight.

**Rule 4.1a — A conditional row cannot be closed by affirmation.** `conditional` must not transition `open → met` on a generic "yes, all good," a thread closing politely, or an acknowledgement that the request was received. `met` requires either (a) an evidence anchor showing the **named condition** was satisfied, or (b) a `provenance: human` note explicitly asserting that it was. Absent either, the row stays `open`, or moves to `waived` if the parties have visibly moved on.

Condition satisfaction and deliverable delivery are independent events, and both may be required. "Revenue hit target" does not mean the money arrived; "the ledger was sent" does not mean the condition held.

**Rule 4.2 — Merge identity is structured, not semantic.** Two mentions are the same row when party, direction, object, amount, due date and item set all agree. Sentence similarity is *not* an identity test: embeddings will happily merge "send the Q3 ledger" with "send the Q3 ledger and bank statements," which is precisely the failure that matters.

**Rule 4.3 — Any change to due date, amount, or item set creates a superseding row.** Never a merge into `evidence[]`. Show both rows with the delta stated in words ("deadline moved two days earlier; one document added"). Prefer a visible duplicate over a swallowed scope change — the duplicate is embarrassing, the swallow is the whole failure.

**Rule 4.4 — Restatements attach as evidence.** Same structured identity means one row with N anchors. "Where did we agree this?" is answered once, not N times.

**Rule 4.5 — Status is a lifecycle, and `unverified` is a state, not a verdict.** `open → met | waived | superseded`, with `open → unverified` when a row ages without inbound evidence (§11). Unverified rows cannot draft.

---

## 5. Deadlines

Three classes, because collapsing them produces either false urgency or missed statutory windows:

| Class | Source of truth | Tool's role |
|---|---|---|
| `soft` | a person's own words ("early next week") | nudge scheduling only |
| `firm` | a contract or SoW | route, with the clause attached |
| `statutory` | legislation or a regulator | route, with the provision and jurisdiction attached |

**Rule 5.1 — The tool routes deadlines; it never owns them.** It never asserts that a filing was made, a window was met, or a period has been satisfied. Every displayed deadline carries its source.

**Rule 5.2 — Store the arithmetic inputs, not just the answer.** Source timezone, exact instant where one is given, the start reference, the governing calendar and its version, and the raw text. "5pm on the 14th" is not "the 14th."

**Rule 5.3 — An implied start date is `needs_review`.** "Within 14 days of receipt," "within 21 days of notice" — if the source does not state the start date, the deadline cannot be computed. State the missing input by name.

**Rule 5.4 — Business days require a pinned holiday calendar per jurisdiction.** Unpinned means `needs_review`. "Days remaining" is never computed in the viewer's local timezone, and DST boundaries are not a rounding detail.

---

## 6. Gates and profiles

One engine, one citation behaviour, two **gate sets**. The fork is in policy, not mechanics — maintaining two verification paths would guarantee that strict cases eventually pass on soft rules.

A case is exportable only when all applicable gates hold:

1. Every source is `parsed` or `reference_only` with a reason. `failed` blocks at the scope defined in Rule 6.1.
2. Every obligation has an anchor and a due date that is exact or `needs_review`.
3. Every governing-document item maps to an obligation, or is `not_applicable` with a reason. **Vacuous when `governing[]` is empty.**
4. Every factual sentence in a draft resolves to a source span.
5. The coverage statement is generated (§11).
6. A Sent sweep covering `[request date, now]` has completed for the case, for any `they_owe` or `external` row being drafted (§10).
7. The approval record matches the current draft hash (§9), and the staleness check has run at copy time.

| Gate | `professional` | `soft` |
|---|---|---|
| Per-sentence citation | required | required |
| Unanchored load-bearing claim | `fail`, export blocked | annotated `needs_review`, export allowed with recorded acceptance |
| Governing-item mapping | required | not applicable (no corpus) |
| Coverage statement | required deliverable | advisory display |
| Parse-failure block | blocks export | blocks the affected draft only, while unattributed (Rule 6.1) |
| Sent-sweep watermark | required for owed-by-them rows | required for owed-by-them rows |
| Staleness re-check at copy | required | required |
| Deadline-ambiguity handling | `needs_review` | `needs_review` |

**Rule 6.1 — Parse failure is scoped by attribution, not by profile.** In `soft`, a `failed` source blocks only the drafts that cite it, and only while it carries **zero candidate obligations**. If any obligation references or traces to that artifact — extracted, partially extracted, or detected-but-unextracted — the block escalates to a case-level export block in **both** profiles. An obligation that exists only inside an unreadable file is the case, not a footnote to it.

The test is attribution, not policy: an unreadable PNG in a job-search case is collateral and should not lock the user out of an unrelated recruiter follow-up; the same PNG holding the only copy of a named deliverable is a hard stop.

Warnings are reserved for **load-bearing claims**: numbers, dates, amounts, obligations, attributions, negations. "Thanks for your email" passes silently. If every sentence is annotated, users learn to ignore annotations, and that habit transfers to the strict profile where the same review surface is used.

Acceptance of a warning is recorded — which warnings, at which draft version. Otherwise "approved" is ambiguous about whether the approver was informed.

---

## 7. The guard

Three verdicts, per draft and per packet:

- `pass` — every claim cited, every applicable gate met
- `needs_review` — resolvable only by a human; blocks that draft, not the packet
- `fail` — uncited or unresolvable claim, or a gate breach; blocks the packet

**Unknown is never `pass`.** No silent defaults, no "probably fine," no inference from absence.

**Rule 7.1 — Retrieve first, then draft.** The generator does not write prose and then search for support. Evidence is retrieved for the row, and the draft is assembled from `(claim text, anchor)` tuples constrained to the retrieved spans. Post-hoc reverse alignment is the architecture that produces confidently-cited misreadings.

**Rule 7.2 — Deterministic checks come first and can `pass`.** Numbers, dates, currency, names and negations are compared exactly against the cited span. Claim-type verbs are checked too: `might`, `may`, `if`, `perhaps`, `could` must not surface as `agreed`.

**Rule 7.3 — Semantic prose is `needs_review`, never `pass`.** If support can only be judged by reading, a human reads it. An LLM judge here reintroduces the stochastic failure the guard exists to remove.

**Rule 7.4 — Side-by-side is for load-bearing prose only.** At twenty drafts nobody reads twenty side-by-sides, and the ones skipped are the boring correct ones — which is where the error hides. Deterministic checks cover everything checkable; side-by-side is spent on the sentences that would actually mislead.

**Rule 7.5 — Measure the guard.** Sample reviewed drafts, measure the misrepresented-claim rate, and state it as a number ("1 in 200"). If it cannot be stated, the gate's reliability is unknown rather than good. Review fatigue is a measurement problem before it is a UI problem.

**Rule 7.6 — Measure retrieval recall, not draft quality.** If the retriever misses the clause, the output is confidently wrong and fully cited. Recall is measured against the governing document's enumerated items.

---

## 8. Review capacity

The system can generate reviewable drafts faster than a person can review them. That is a design constraint, not a user failure.

**Rule 8.1 — Cap drafts per case per cycle.**

**Rule 8.2 — Unreviewed backlog is a blocking state.** Above the cap, new drafting stops. Batched-to-Friday approvals mean a week-stale ledger and drafts that are wrong by the time anyone reads them.

---

## 9. Approval and staleness

One record per draft version: `pending → approved | declined`. Append-only; who, when, and a hash of the exact content approved.

**Rule 9.1 — The hash covers the whole outbound object**, not the body: body, subject, To, Cc, Bcc, the In-Reply-To/References chain, and the citation set. Changing the recipient after approval is the most dangerous edit there is, and a body-only hash would let it through.

**Rule 9.2 — Any change mints a new version and resets to `pending`.** Approval never carries forward. Not across an edit, not across a ledger change, not across a stale-source event.

**Rule 9.3 — Absence of a record means no.** Not timeout, not rerun, not "it's been three days."

**Rule 9.4 — Staleness is checked at copy time, not approval time.** A draft approved at 9am and pasted at 4pm may have been contradicted at 11am. Every approved draft carries a visible stamp of what has arrived since creation; new inbound touching a cited claim, the counterparty, or the deadline returns the draft to `pending` with the conflict named.

---

## 10. Sent reconciliation

**Rule 10.1 — The watermark is the gate, not the batch.** A `they_owe` or `external` row cannot produce a draft unless a Sent sweep covering `[request date, now]` has **completed for that case**, recorded as a watermark on every run and checked at draft time.

Batching reads "in the same transaction" is not sufficient: an mbox snapshot and a live connector are different clocks, a phone can send between them, and a failed Sent read must block drafting rather than silently allow it.

**Rule 10.2 — Ingest first, evaluate second.** No evaluation pass runs against a partially-loaded corpus.

**Rule 10.3 — Scope is the case, never the party.** A per-party watermark is the obvious optimisation for large matters and it is wrong: mail sent to `billing@firm.com` while the ask was directed at `sarah@firm.com` would read as "swept, clear" and produce a false reminder. Cases are already bounded units of work, so one sweep across every message belonging to the case's known aliases is both cheaper to reason about and correct when a reply arrives from someone the ask never mentioned.

---

## 11. Off-channel resolution and coverage

Much of what resolves a matter never appears in email: a phone call, a desk drop-off, a portal upload, a Slack ping.

**Rule 11.1 — Closing is easier than drafting.** Every waiting-on row carries a one-click *"resolved / handled elsewhere"* action with an optional note — on the card, not behind a dialog.

**Rule 11.2 — Age downgrades, it does not nag.** A row past a configured age with no inbound evidence moves `open → unverified` and stops producing drafts. No "has this been discussed offline?" prompt as a click-through: within a week it becomes a reflex, and reflexes are not review.

**Rule 11.3 — The coverage statement is a deliverable.** Every packet states, in plain language: what was read, what was *not visible* to the system (portals, calls, other mailboxes), and what the human must verify themselves. A ledger that quietly misses the portal message is worse than no ledger, so the miss is printed rather than implied.

---

## 12. Trust boundary

Untrusted content includes the message body, HTML and hidden text, attachment text, OCR output, PDF metadata, form fields, filenames and headers.

**Rule 12.1 — All of it is data.** Nothing in ingested content is an instruction. No tool call, no config change, no case action, no ledger edit originates from source content.

**Rule 12.2 — The injection fixture covers documents, not just email.** The realistic vector is a PDF: white-on-white text, a metadata field, an OCR'd page, a form field labelled as an instruction. Passing the email-body test alone proves nothing.

---

## 13. Non-goals (v1)

No send. No draft-send. No filing, signing, or submitting. No portal scraping. No silent case assignment. No automatic identity merge. No automatic case creation. No auto-approval of any kind.

The copy/paste boundary is deliberate: it makes zero-send trivially true and testable, and it removes the need to model sending, attachments-on-send, reply threading, and provider quirks. It should not erode.

---

## 14. Acceptance suite

The fixture is the specification. Each row states an expected outcome; if any row passes when it should fail, the guard is broken — not the fixture.

**Rule 14.1 — Every fixture carries an explicit temporal coordinate.** Each fixture specifies `eval_now` (a fixed ISO 8601 instant) and `eval_tz` (an IANA zone). Day-counting, aging, business-day arithmetic, and every deadline assertion evaluate against `eval_now` — never the system clock. A fixture missing either field is invalid and cannot pass, because otherwise its assertions drift with the calendar and it stops testing anything.

**Rule 14.2 — The corpus is literal bytes, not prose.** Fixtures live under `fixtures/NN_name/` as raw RFC 5322 messages and static attachment files, each directory carrying a manifest with its `eval_now`, `eval_tz`, inputs, expected ledger rows, expected verdict, and the named failure condition. A fixture that exists only as a description has not been run.

| # | Fixture | Profile | Expected |
|---|---|---|---|
| 1 | Same promise restated across 3 replies | both | one row, 3 evidence anchors |
| 2 | Body says $4,200, attachment says $4,000 | both | named question, `needs_review` |
| 3 | "By Friday" with a resolvable sent date | both | exact date |
| 4 | "Early next week" | both | `needs_review`, raw text preserved |
| 5 | Waiting-on item already answered in Sent | both | closed, no draft produced |
| 6 | Waiting-on with no completed Sent sweep in window | both | drafting blocked, reason named |
| 7 | Hostile instruction in email body | both | stored as content, nothing executed |
| 8 | Hostile instruction in OCR text / PDF metadata / form field | both | stored as content, nothing executed |
| 9 | Draft citing a non-existent message | both | `fail` by name, export blocked |
| 10 | Draft citing a non-existent clause in a governing doc | professional | `fail` by name, export blocked |
| 11 | "Send ledger by Friday" then "ledger **and bank statements** by Wednesday" | both | superseding row, delta stated in words |
| 12 | "Might pay $4,000 next month" | both | `conditional`, condition preserved, never `agreed` |
| 13 | Document re-uploaded or re-OCR'd; draft cites old version | professional | draft returns to `pending`, named version question, no remap |
| 14 | Reply from colleague of the asked party ("John's out, I'll handle it") | both | original `suspended`; new row `open` with `authority: unconfirmed`; nothing satisfied |
| 15 | Draft approved, new inbound arrives before copy | both | staleness stamp, returns to `pending` |
| 16 | Recipient changed after approval | both | hash mismatch, `pending` |
| 17 | "Within 14 days of receipt," no stated receipt date | both | `needs_review`, missing input named |
| 18 | Soft-profile case with no governing document | soft | completeness vacuous-pass, export allowed |
| 19 | Backlog above draft cap | both | no new drafts generated |
| 20 | Case created from an inbound email (attempted) | both | refused; suggestion may only match an existing case |
| 21 | "I might pay $4,000 if revenue allows," then "great, thanks" | both | row stays `open`/`conditional`; not `met`; no draft claims payment agreed (Rule 4.1a) |
| 22 | Unreadable attachment with **no** obligation vs. the same unreadable attachment holding the only copy of a named deliverable | soft | first: blocks citing drafts only; second: case-level export block (Rule 6.1) |

---

## 15. Locked decisions (formerly open questions)

All three are decided. They are recorded here because each was a real fork, not because any is still in play.

| Question | Decision | Encoded at |
|---|---|---|
| Warning granularity in soft mode | **Per claim.** It matches the internal `(claim, anchor)` tuple, so it is free; per draft hides the detail, per sentence invents claims that were never made. | §6 |
| Watermark scope | **Per case.** Per-party creates a false negative at the exact moment that matters — a reply from someone the ask never mentioned. | §10.3 |
| Unmatched-queue expiry | **Hybrid.** TTL or capacity ceiling, whichever comes first, with a metadata-only receipt. | §1.3 |

No open questions remain. The next edit to this document comes from a fixture that fails, not from a review that succeeds.

---

## Decisions log

### v1.0.4 — finishing with a case: close, set aside, delete

The model said nothing about deletion, so it was neither supported nor ruled out. Now decided. "Delete a case" is three requests:

- **Closing** (status `closed`, reopenable) is the normal end of a case and the only one that keeps the audit trail. A closed case is read-only (nothing new is read, checked, drafted, approved, edited or copied; no row action) until reopened. The case is the record that a person read these warnings and accepted them, and Vault keeps no sent copy of copied wording, so a finished matter is closed, not deleted. `abandoned` remains in the schema and nothing sets it.
- **Setting a thread aside** keeps its sources (so §2.4 holds: nothing is silently re-anchored or orphaned) but stops it being read, fetched or counted. **Removing** a thread deletes it and is refused when any ledger row or draft quotes it.
- **Deleting** exists and is a second-tier action: only from inside the case, the case name typed, the counts shown, and a separate explicit acknowledgement when any draft was ever approved. **Approval records are not protected from case deletion**: deleting the case deletes the approval records with it (append-only holds inside a live case; erasure is a legitimate reason to remove the whole case). By default the delete goes through the shared 30-day recycle bin, where the person can restore it or use the bin's Delete forever; "Delete forever now" skips the copy; a case too big for the bin is refused with that way out. Tasks made from the case's rows are the person's own and are left alone. Gmail is never touched. A hard delete with no bin was considered and rejected: it breaks the convention every other tool follows, and the bin's own Delete forever already covers "this data must not be here".

### v1.0.3 — after a code review of the first build: what the product does NOT run, and what changed

Rules written in this document that the application does not run (each is real in the pure modules and tested by fixtures, but nothing in the app calls it). They are recorded here so nobody assumes otherwise:

- **§1.3** The unmatched queue: nothing ingests mail automatically, so there is no queue. (Logged in v1.0.2.)
- **§2.3 / §2.4 Source versions.** There is no version column; a source is stored once and never re-read in place, so a new version never arises. `supersededBy` is always null in the app and the guard's `SUPERSEDED_VERSION` result can only come from a content-hash mismatch, which does not happen either. The one thing that replaces source records is the OCR upgrade (it deletes the old text-less "no OCR" records of scanned PDFs and reads them again); nothing could cite those records, as they hold no text.
- **§6 Export gates** (`gates.exportGates`): never called. Governing items cannot be added (no route or screen), nothing sets `candidateObligations`, and a file that could not be read yields no row that could point at it, so §6.1 ("an unreadable file carrying an obligation blocks the case") cannot be detected: only the coverage statement tells the person about unreadable files. Fixtures 18 and 22 test the function with inputs the app never supplies. Wiring the strict-profile "an unreadable source blocks" check was considered and rejected for now: it would block every copy in a case with no way to clear it, so it needs an "I have seen this file" action first.
- **§11.2 Ageing** (`ledger.ageRows`): never called, so a row never becomes `unverified` and the `canDraft` block for it is unreachable. The risk register's "age downgrades rather than nags" mitigation is therefore not in the product.
- **§10 `sentLinks`** (the "answered" and "chased" branches of `canDraft`): the app passes none. Whether a Sent message already answers a row is left to the person, as the SENT_SINCE warning (v1.0.2). Fixtures 5 and 6 test the function.

Fixtures that exercise rule modules the app does not call: 5 and 6 (the answered/chased branches), 13 (source versions), 18 and 22 (§6 gates). They stay as tests of the rules as written.

Behaviour changed by the review (all with tests in `server/routes/emailFollowUp.test.js`):

- **Every ledger change is made under a row lock in one transaction.** Before, a Read saved the ledger once at the end and marked each message read as it went, so a model failure on message 7 threw away messages 1 to 6 for good, and any two requests at once (a Read and a "Make a task") could overwrite each other. Now each message is saved and marked read together; a failure keeps what was read and a second press carries on; a double press reads each message once.
- **§10.1 is implemented as: a chase needs a Sent check that reaches up to now (15 minutes' tolerance), and Draft follow-up makes that check itself when the last one is older.** The rule is unchanged; only the extra button press is gone. If the check cannot be made, nothing is drafted.
- **Approval is checked again at copy time** under the case's current checking, so a draft approved under one profile, or before a source became unreadable, cannot be copied on its old approval. Changing a case's profile also sends its approved drafts back to pending.
- **A client or project id in a request must belong to the caller.**
- **§10.1, Check Sent in steps:** one press reads one Gmail page (100 messages) and the check counts as complete only when the last page is done; the old 300-message ceiling, which failed with no way out, is gone. A later check adds only the recent tail when it covers the same addresses and reaches back far enough (rows record the addresses they covered). Find mail pages through Gmail until it has twelve unattached threads (up to 200 looked at) instead of looking only at the newest fifteen. Every Gmail-calling route has a per-person rate limit.

### v1.0.2 — first build inside Vault (see `email-follow-up.md`); forced by running the fixtures, not by review

- **§14** Fixture 23 added (deterministic claim checks). Found by deliberately breaking ten rules one at a time: the dropped-hedge rule (§7.2) survived all 20 fixtures because other checks caught the only fixtures that touched it.
- **§7.2** A paraphrase of hedged text that omits any hedge word fails (`HEDGE_DROPPED`) instead of going to `needs_review`. Stricter on purpose.
- **§7.1** In this build, draft prose is template-assembled from the ledger row's own quoted words; no model writes draft text. Narrower than the rule allows, and repeatable.
- **§10** Deciding that a Sent message answers a row is left to the person after a sweep (a named warning), since it is a semantic judgement and §7.3 forbids a machine `pass` for those.
- **§1.3** Not applicable in this build: nothing ingests mail automatically, so there is no unmatched queue to expire. The rule stays for any future automatic ingest.
- **Not exercised yet:** every real-model and real-mailbox measurement (§7.5, §7.6).
- **§2 / §12.2 (attachments, built):** each attachment is its own source hanging off its message. Read: PDF text layer, Word, plain text. Kept as `reference_only` with a reason: pictures, scans (no OCR), spreadsheets, other types. Refused as `failed`: a file whose first bytes show a program or script, however it is named. Only the page text is taken; metadata and form-field values are never read into the case (a deliberate narrowing of fixture 8's "store as data": there is nothing to act on if it is never stored). Hidden (white) text is part of the text layer and is kept as data.
- **§4.3 (changed):** two different amounts for the same ask inside ONE email (its body and its attachment) are a **disagreement**, not a change of mind. Both rows stay open, flagged against each other with a named question, and neither can be drafted until one is waived (fixture 2). A correction in a LATER email is still a superseding row.
- **§2.6 (OCR, built):** a scanned PDF page is read by OCR when it has no text layer (at most 10 pages a file, average confidence of 55% or more). OCR text is a guess at the page, so any claim quoted from an OCR source is `needs_review` (`OCR_SOURCE`) even when every exact check passes, and the person confirms it against the original. Fixture 24.
- **§5.3:** a "within N days" deadline may use a start date only when the model returns it as wording that is itself in the source text and code reads it as an exact date (fixture 8: invoice dated 15 October 2026, due within 30 days, gives 14 November). Otherwise it stays `needs_review`.

### v1.0.1 — patch set, applied at lock

- **§4.1a** Conditional resolution path: `conditional` cannot reach `met` by affirmation or thread closure; requires condition evidence or a human note. Condition satisfaction and deliverable delivery treated as independent events.
- **§6 Rule 6.1** Parse-failure scope moved from profile-based to **attribution**-based. `soft` blocks only citing drafts, and only while the failed source has zero candidate obligations; any attributed obligation escalates to a case-level block in both profiles.
- **§1.3** Queue expiry made hybrid (TTL 14 days or 100 items, whichever first) and the discard receipt made **metadata-only** — `timestamp, count, sender_domain_hash, Message-ID, reason` — with bodies and attachments scrubbed on eviction.
- **§3.3/§3.3a** Substitute replies produce `authority: unconfirmed`, which is a soft lock: cannot clear, cannot resolve, cannot produce a formal report until confirmed.
- **§14 Rule 14.1/14.2** Temporal coordinates (`eval_now`, `eval_tz`) made mandatory per fixture; corpus defined as literal bytes under `fixtures/NN_name/` with a manifest, not prose descriptions.
- **§14** Fixtures 21–22 added so §4.1a and §6.1 are falsifiable — the only additions beyond the patch set, on the document's own principle that an untested rule is not a rule.
- **§15** Closed. §15.1–15.3 recorded as decisions, not questions.
- **No fixture has been executed.** Every assertion above remains untested until the corpus is built and run.

### v1 — first draft, all review-driven

- Section 9 (open decisions) removed. Case creation is strict manual, with suggestions limited to existing cases and an expiring unmatched queue (§1). Soft profile keeps the same citation engine and drops only packet-level gates (§6).
- Zero-governing-source cases added; completeness is vacuous, not failed (§1.4, §6.3).
- `direction` and `claim_type` added to the ledger; merge identity moved from sentence similarity to structured fields, with superseding rows on due-date, amount or item-set change (§4).
- Anchors rebound to the extracted text artifact `(source_id, version_hash, locator, span_hash)`; re-parse creates a version; no auto-remap (§2).
- `sent_watermark` per case; drafting blocked without a completed sweep over the request window (§10).
- Approval hash widened to headers, recipients and citations; accepted warnings recorded (§9, §6).
- Staleness check at copy time added (§9.4).
- Parties split into asked / may-answer, with alias suspension and human-confirmed merge (§3).
- Deadline table expanded: arithmetic inputs, implied start dates, pinned holiday calendar per jurisdiction (§5).
- Review capacity made a blocking state (§8); guard reliability and retrieval recall made measurable (§7.5, §7.6).
- Off-channel resolution made a one-click close rather than a prompt; aging downgrades to `unverified` (§11).
- Injection fixtures extended to OCR, metadata and form fields (§12.2, §14).
- Acceptance suite extended from 7 to 20 fixtures, with a profile column.
