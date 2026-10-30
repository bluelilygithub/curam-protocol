# Email Follow-Up — Context and Decision Record

Status (updated 2026-10-30): **design complete; a first version is now built inside Vault** (see `email-follow-up.md` for what was built, what was not, and the one decision that overrides the "separate product" verdict below). The design text below is left as written. This file is the entry point for a fresh session; the documents below are self-contained and can be read in any order after this one.

| File | What it holds |
|---|---|
| `email-follow-up-context.md` | this file — verdict, shape, wedge, standing constraints, resume instructions |
| `email-follow-up-case-model.md` | **v1.0.1, locked** — the specification (case, sources, ledger, gates, guard, approval) |
| `email-follow-up-use-cases.md` | the 15 candidate verticals, the axes they vary on, sequencing |
| `email-follow-up-risk-register.md` | 10 risks, verdicts, and which spec rule each one maps to |
| `email-follow-up-fixture-plan.md` | the acceptance corpus — 22 fixtures, structure, build order |

---

## What this is

A design for a **commitments ledger**: it reads correspondence, extracts what was promised or is owed, anchors every claim to a source, compares that against a governing document, and prepares cited follow-up drafts for a human to copy into their own mail client.

The one-sentence framing, which took most of the conversation to arrive at:

> **A commitments ledger with governing documents and a citation gate. Email is the transport, not the category.**

That sentence is why the work below is a separate product rather than a feature.

## Verdict: separate product, not a Vault feature

| | Vault | This |
|---|---|---|
| Organising unit | tool (`gmail.js`, `finance.js`, `crm.js` …) | **case** |
| Trust model | read-mostly, per-tool permissions | case-scoped, citation-gated, export-blocked |
| Root object | record in one domain | cross-domain matter with a governing document |
| Failure mode | wrong answer in a tool | wrong answer in a legal or financial deadline |

Vault's Inbox Intel and Invoice Review are in the same *domain* but a different *shape*: they answer "what is this email about," which is per-message and stateless. This answers "what does this matter still owe," which is per-case and stateful. Bolting it on would mean either duplicating the ledger inside a tool or making every tool case-aware — both worse than a separate service.

**Three shapes were considered:**

1. **Standalone local tool** — owns mail ingest, ledger, guard, drafts. Clean boundary, no shared credentials, PHI/legal documents never leave the machine. Slowest to reach users.
2. **Vault subsystem** — reuses Vault's auth, DB, UI, and Gmail connector. Fastest to build, and the worst fit: shared Postgres becomes a data-gravity problem the moment a mortgage or medical case exists.
3. **Hybrid** *(recommended)* — the local agent owns ledger, guard, and drafts; Vault is an **optional, one-way consumer** of summaries only ("a commitment exists, review it here"), never document bodies. Keeps the strict boundary where the risk is and still gives a plausible handoff story.

Shape 3 is the recommendation. It was never built, so it remains a recommendation, not a decision with consequences yet.

## The wedge

Of the ten recorded verticals (see `email-follow-up-use-cases.md`; the thread referred to fifteen, the other five are not recoverable), the best first commercial case is **document collection for accounting and compliance deadlines** — the audit-PBC shape pointed at BAS, tax and end-of-year document chasing.

Why this one:

- Email genuinely is the medium; clients send receipts and statements by mail.
- The governing document is a checklist, so **completeness is objectively checkable**.
- The deadline is external and **recurs quarterly**, so the loop has a natural reason to exist.
- Consequence is high enough to pay for without being PHI or statutory adjudication.
- It is adjacent to Vault's Finance and expense-review work, so the hybrid handoff is credible rather than theoretical.

**Job search** stays as the free demo: purest form, no second corpus, zero liability. **Appeals and escrow** are deferred — same engine, liability profile and portal coverage you should not take on early.

## Standing constraints

- **No send.** No draft-send, no filing, no submitting, no portal scraping. The user copies text out. This makes zero-send trivially true and testable, and removes sending, attachments-on-send, reply threading, and provider quirks from scope entirely.
- **No silent inference.** Cases are created by humans; mail joins a case explicitly or lands in a queue. Nothing attaches itself.
- **No auto-approval.** Absence of a record means no.
- **No code in the spec.** The case model is prose and rules; there is no schema DDL and no implementation.

## Vault facts that matter to the hybrid

Read from the code earlier in the conversation that produced this design (not re-checked when these files were written, so check them again before relying on them):

- Vault's Google connection is **read-only**: `gmail.readonly`, `calendar.readonly`, `drive.file`, `drive.readonly` (`server/routes/gmail.js`). It cannot send or draft from the user's mailbox.
- Vault **does** have outbound mail — `POST /api/email` via MailChannels/nodemailer, arbitrary recipient (`server/routes/email.js`).
- So the "Vault cannot send on your behalf" boundary holds **by accident of scope, not by design**. If this product ever hands off to Vault, that distinction needs to be enforced deliberately rather than assumed.
- The approval-gate pattern worth reusing is `server/routes/expenseReview.js` (pending → approve queue writing into Finance), not Vault's chat routes.

## Adjacent issue, unresolved

`.env` was reported to hold commented-out `DATABASE_URL` entries (lines 26–27) beside the active one (line 29). Only the existence of the commented lines was confirmed when these files were written; that the commented URL is the production one and contains a plaintext password was carried over from earlier and not re-verified. `.env` is git-ignored and has never been committed (checked), so the exposure is limited to this PC. Remove the commented lines either way, and rotate the password if it is the production one. Unrelated to the ledger design; not acted on.

## What is decided, and what is not

**Decided** — the case model (v1.0.1), the two earlier forks (manual case creation; one citation engine with a policy fork), the wedge, and the three former open questions (per-claim warnings, per-case watermark, hybrid queue expiry).

**Not decided** — whether to build it at all. That is the real open item, and it is not a design question.

## Next action

Build and run the fixture corpus in `email-follow-up-fixture-plan.md`, **rule suite first** (static extracted rows and static drafts, so the result is repeatable; the model-dependent extraction and drafting are scored separately as rates). It is the only step that produces information rather than opinion: the 22 assertions in the spec have never met a real RFC 5322 message or a malformed PDF, and the first run will change something.

The alternatives are equally legitimate and cheaper: put one review card in front of five people (the only way to settle whether warnings work), or stop (if you cannot name a person who would pay for the accounting version within thirty days, the spec has already answered the question).

## Resuming in a fresh session

Paste this:

> Read `docs/email-follow-up-context.md`, `docs/email-follow-up-case-model.md`, `docs/email-follow-up-fixture-plan.md`. The case model is locked at v1.0.1 — do not revise it without a Decisions Log entry. Next task: [build fixtures NN–NN / review the guard against fixture X / something else]. No code unless I ask.

Do not re-litigate the case model. It is internally consistent; further review rounds stopped producing changes of shape several rounds before the document was locked, and that is the signal to stop, not to try harder.

## Not carried over

Two earlier answers in this thread concerned **Vault**, not this product, and are not part of this set: the inventory of which Vault tools touch the Gmail inbox, and how Vault routes models (`modelResolver.pickTiers`, the `analyse-prompt` advisor). They are about Vault's internals and should be re-derived from the code if needed.
