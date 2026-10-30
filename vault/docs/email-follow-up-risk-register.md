# Email Follow-Up — Risk Register

Ten risks, each with the mitigation that survived review, the mitigation that **did not** survive, and what the accepted fix still fails to cover. Rule numbers refer to `email-follow-up-case-model.md` (v1.0.1).

A risk that is "mitigated" here means *the design has an answer for it*, not that the answer has been tested. No fixture in this project has been executed.

---

## 1. Review fatigue ("green-check blindness")

**Risk.** The citation guard is reliable ~95% of the time, so human review degrades into rubber-stamping. The human sees `Message-ID: ABC#chunk2`, assumes the citation is semantically accurate, and approves a draft that cites a real message while misrepresenting it — "I might be able to pay $4,000 if revenue allows" becoming "you agreed to pay $4,000 on 1 November."

**Rejected mitigation.** Side-by-side chunks with highlighted modal verbs. It does not survive volume: at twenty drafts nobody reads twenty side-by-sides, and the ones skipped are the boring, correct ones — which is precisely where the failure hides.

**Accepted (§4.1, §4.1a, §7.2–7.5).**
- The example is an **extraction** bug, not a UI bug. Claim typing (`agreed | proposed | conditional | refused`) with the condition stored verbatim keeps the bad row out of the ledger entirely.
- **Tiered review:** deterministic checks for everything checkable (numbers, dates, currency, names, negations, modal verbs) — those can `pass` by machine. Side-by-side is spent only on load-bearing prose. Semantic judgement is `needs_review`, never `pass`.
- **Measure it.** Sample reviewed drafts and state the misrepresented-claim rate as a number. If it cannot be stated, the guard's reliability is unknown rather than good.

**Not covered.** The rate has never been measured. There is no threshold at which the project would admit the guard does not work — that decision is missing, and it should be set before the first measurement rather than after.

## 2. Semantic drift in deduplication

**Risk.** Normalising an ask into one canonical sentence is an LLM judgement. Too aggressive and it swallows an escalating commitment; too conservative and the ledger floods with duplicates.

Canonical failure: "send the Q3 ledger by Friday," then "since the audit moved up, send the Q3 ledger **and bank statements** by Wednesday." Merged, the accelerated deadline and the extra document both disappear into an `evidence[]` array.

**Rejected mitigation.** Embedding similarity as the merge test — it merges exactly this pair, because they are close.

**Accepted (§4.2, §4.3).** Identity is structured: party, direction, object, amount, due date, item set. Any change to due date, amount or item set creates a **superseding row**, never a merge; both rows are shown with the delta stated in words. The stated principle: prefer a visible duplicate over a swallowed scope change, because the duplicate is embarrassing and the swallow is the whole failure.

**Not covered.** "Same object" is still a judgement — the structured fields are extracted, not given. The failure moved from similarity to extraction, which is better but not eliminated. Fixtures 1, 11 and 12 test the boundaries.

## 3. Attachment coordinate fragility

**Risk.** Anchoring to `doc_id + page/line` assumes reproducible layout. Different extractors, different OCR versions, and digital-vs-scanned sources all shift page breaks and coordinates. The guard then fails to locate a citation and issues a false `fail`, halting export for no real reason.

**Rejected mitigation.** N-gram windows alongside physical coordinates. It helps and it is still anchored to the wrong object — the file.

**Accepted (§2.1–2.4).** Anchor to the **extracted text artifact**: stored text, span, bounding boxes, parser name and version, bound to a source-version hash. The PDF is provenance, not the coordinate system. Re-parse or re-upload creates a **new version**; citations on the old version go stale; dependent drafts return to `pending` with a named question; **nothing is auto-remapped**.

**Not covered.** Storage cost — every version of every artifact is retained, by design. A long-lived case with repeated OCR will accumulate versions nobody prunes, and the retention policy does not exist yet.

## 4. Non-email channels and ghost resolution

**Risk.** An obligation is logged, then resolved by a phone call. The system keeps drafting increasingly stern reminders for something already done.

**Rejected mitigation.** An optional "has this been resolved offline?" prompt in the review card. Within a week it is a reflex, and reflexes are not review.

**Accepted (§11.1–11.3).** Closing is made **easier than drafting**: a one-click "resolved / handled elsewhere" action on the row itself. Aging downgrades rather than nags — `open → unverified`, and unverified rows cannot draft at all. The **coverage statement** names what was not visible, as a deliverable rather than a disclaimer.

**Not covered.** The user still has to press the button, and nothing detects that a case has gone quiet because it was settled in person. The system's honest position is "I have no evidence either way," which is better than a wrong reminder but is not the same as being right.

## 5. Multi-party and entity aliasing

**Risk.** One person writes from three addresses; a colleague takes over mid-matter. Strict identity matching then fails to reconcile a reply, leaving the original obligation open and drafting duplicate nudges.

**Rejected mitigation.** Treating everyone at `@firm.com` as able to satisfy the ask. This closes obligations that are not closed: a colleague saying "John's out, I'll handle it" has satisfied nothing.

**Accepted (§3.1–3.4, §3.3a).** `asked` and `may_answer` are separate. An alias or substitute reply **suspends**, it does not satisfy; a new row opens against the substitute with `authority: unconfirmed`, which is a **soft lock** — it cannot clear, cannot resolve, and cannot produce a formal status report until the primary party, the party group, or a human note confirms standing. Merge and split are human-confirmed and show their evidence.

**Not covered.** Confirmation is a manual act with no queue, so in practice `authority: unconfirmed` rows may accumulate unconfirmed and silently block work. Fixture 14 tests the transition; nothing tests the queue.

## 6. Citation verification bottleneck

**Risk.** "Every factual sentence resolves to a source chunk" is expensive. String matching cannot verify paraphrase ("as we agreed two weeks ago" vs "confirmed on 12 June"), and an LLM judge reintroduces the stochastic failure the guard exists to remove.

**Accepted (§7.1–7.3, §7.6).** Invert the flow: **retrieve first, draft second**. The generator emits `(claim text, anchor)` tuples assembled only from provided spans, rather than writing prose and reverse-aligning it afterwards. Deterministic checks run first; semantic support is `needs_review` by construction. **Retrieval recall** is measured against the governing document's enumerated items — not against the draft, which would be circular.

**Not covered.** This is the largest unmeasured dependency in the design. If the retriever misses the clause, the output is confidently wrong *and fully cited*, and no downstream check catches it. Recall has never been measured, so the entire guard currently rests on an assumption.

## A. Staleness between review and copy *(added)*

**Risk.** Approval hashes content, but the world moves. A draft approved at 9am and pasted at 4pm may be contradicted by a reply at 11am. This is the most likely real-world embarrassment in the whole design, and none of the original six covered it.

**Accepted (§9.4).** The check runs at **copy time**, not approval time. Every approved draft carries a visible stamp of what has arrived since creation; new inbound touching a cited claim, the counterparty, or the deadline returns the draft to `pending` with the conflict named.

**Also (§9.1).** The approval hash covers the whole outbound object — body, subject, To, Cc, Bcc, the reply chain and the citation set. A body-only hash would let a recipient change through, and recipient change is the most dangerous edit there is.

**Not covered.** "Touching" is defined by the same retrieval machinery whose recall is unmeasured. A missed connection is a missed staleness alert.

## B. Deadline arithmetic *(added)*

**Risk.** "Within 14 days of receipt" vs "of notice date," business days, public holidays, timezones, and the common case where the clock starts on a date the message never states. Wrong arithmetic is silent, plausible, and catastrophic in audit and tenancy.

**Accepted (§5.1–5.4).** Store the arithmetic **inputs** (source timezone, exact instant, start reference, pinned calendar and version, raw text). An implied start date is `needs_review` with the missing input named by name. Days remaining are never computed in the viewer's timezone. The tool **routes** deadlines and never asserts one was met.

**Not covered.** Holiday calendars are a per-jurisdiction content problem, not a code problem, and there is no plan for maintaining them. A stale calendar is a silent arithmetic error with a clean provenance trail.

## C. Injection through attachments *(added)*

**Risk.** The hostile-content test in early drafts covered the email body. The realistic vector is a PDF: white-on-white text, a metadata field, an OCR'd page, a form field labelled as an instruction.

**Accepted (§12.1–12.2).** Untrusted content includes body, HTML, hidden text, attachment text, OCR output, metadata, form fields, filenames and headers. All of it is data; nothing in it produces a tool call, config change, case action or ledger edit. Fixtures 7 and 8 cover the body and the document respectively.

**Not covered.** The guarantee is architectural (nothing in the pipeline dereferences content as instruction), but it degrades the moment an extraction step uses a model with tools attached. That constraint is not written into the spec and should be.

## D. Throughput versus capacity *(added)*

**Risk.** The system generates reviewable drafts faster than a person can review them meaningfully. Approvals batch to Friday; the ledger is a week stale; the drafts are wrong by the time they are read.

**Accepted (§8.1–8.2).** Drafts are capped per case per cycle, and **unreviewed backlog is a blocking state** — above the cap, new drafting stops.

**Not covered.** The cap number is unset, and a cap that is too low silently turns the product back into a checklist.

---

## Residual risks the register does not answer

These are not mitigations that failed; they are things the design does not address at all.

1. **Counterparty consent.** The tool ingests mail written by other people. They did not agree to have their correspondence processed by a third-party system, and no part of the design accounts for that. It is a legal and reputational exposure that grows with every vertical, and it is the strongest argument for the local-only shape.

2. **Model egress.** Retrieve-first drafting sends retrieved spans to a model. If the promise is "nothing leaves the machine," that promise requires a local model, and nothing in the spec says so. For the deferred verticals (medical, mortgage) this is the difference between viable and not.

3. **The invisible case.** Strict manual creation means work that was never opened as a case is invisible by construction. The tool cannot warn you about the matter you forgot to create — and forgetting to create it is the most likely way a real deadline is missed.

4. **Unmeasured everything.** Ten mitigations, zero executions. Each of the above is a rule that reads as sound and has never met a malformed PDF.

5. **Spec as substitute for decision.** The largest process risk: the document became better than most funded products' specifications, which means its quality stopped being the constraint. Further hardening would produce no new information. The next useful act is a fixture run, five users, or a decision not to build.
