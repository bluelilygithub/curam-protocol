# Email Follow-Up — Use Cases

Ten verticals are recorded here. The conversation that produced them referred to fifteen; the other five were not written down and cannot be recovered, so nothing is claimed about why they dropped out. Each of the ten is included because it stresses a *different part* of the engine — not because it is a different industry.

The engine is the same everywhere: **extract obligation → anchor it → compare against a governing document and Sent → draft a cited nudge.** What changes is the corpus, the deadline class, and the cost of being wrong.

---

## What actually varies

| Use case | Direction | Governing document | Consequence | Deadline |
|---|---|---|---|---|
| Freelance scope / retainer | both | SoW / proposal | commercial | soft, self-set |
| Insurance appeals | inbound denial + your filing | policy + clinical records | legal / health | statutory, hard |
| Vendor procurement | both | contract / RFP / NDA | commercial | soft-to-firm |
| Escrow / mortgage | inbound conditions, outbound submissions | purchase contract, lender conditions, title | financial / legal | statutory, hard |
| Exec / board follow-through | **outbound only** | none — prior messages | reputational | soft |
| Grants / funding compliance | both | grant agreement + approved budget | financial / regulatory | hard, money |
| Construction / renovation | both | contract, drawings, specification | contractual | statutory, short |
| Audit / regulatory evidence | inbound request, outbound evidence | the request list itself | regulatory | hard, fixed list |
| Job search / recruitment | both | none | personal | soft |
| Tenancy / property | two-direction | lease + state legislation | legal | statutory notice windows |

Three axes do the work: **direction** (who owes), **whether a second corpus exists**, and **how bad a wrong answer is**.

---

## 1. Freelance scope and retainer milestones

Clients slip out-of-scope requests and informal deadlines into long threads ("Could we also tweak the onboarding flow by Thursday?").

**Maps:** request → ledger row; ledger row compared against the SoW's scope clauses; elapsed-time calculation against the milestone schedule.

**Review card:** acknowledges the request, cites the scope clause, suggests an add-on quote.

**New:** the "this is out of scope" claim needs a *clause* anchor, not a message anchor. "As agreed on June 3" is not enough.

**Risk:** low. The main failure is an argumentative tone, not a legal one.

## 2. Complex insurance appeals and healthcare advocacy

Denied claims coordinated across providers, adjusters and billing offices, with denial codes and required filing deadlines buried in PDFs.

**Maps:** denial → deadline + evidence owed by the clinic; policy and clinical records as the governing corpus; appeal letter assembled from policy clauses and record dates.

**New:** clinical records are the second corpus and the deadlines are statutory.

**Risk:** high, and not only legal. Email is not where appeals live — portals, faxes and adjuster calls are. Deferred for that reason (see "What to cut").

## 3. Vendor procurement and contract negotiation

Competing RFPs, revised pricing schedules, security questionnaires, NDAs.

**Maps:** cross-references vendor replies against Sent to track who owes a COI or a revised rate card.

**New:** the competing-vendor view — several counterparties owing comparable things on one case.

**Risk:** moderate. Portals are common, so the coverage statement carries weight.

## 4. Home purchase escrow and mortgage processing

A 30-day window coordinating tax returns, deposits, inspection amendments and title clearance across lender, escrow officer and realtor.

**Maps:** open underwriter conditions paired against documents already provided; unresolved repair commitments highlighted; contingency deadlines routed.

**New:** the pairing of "condition" against "evidence already submitted" — a completeness check with money attached.

**Risk:** high. Identity documents and financial records create data-gravity problems; the operative conversation often lives in a portal. Deferred.

## 5. Executive and board relationship follow-through

"I'll introduce you to our candidate next week," "I'll send the deck by the 15th" — promises made in advisory and investor updates.

**Maps:** scans **outgoing** mail for commitments; converts "early next week" into a scheduled check-in.

**New:** it is the only *outbound-only* case. No waiting-on, no counterparty chasing. This is why `direction` exists in the ledger; without it this case is a schema hack.

**Risk:** reputational only. Good second demo.

## 6. Grant and funding compliance reporting

Acquittal dates, budget lines, and a funder who asks follow-up questions months later; receipts arrive from staff, contractors and partners across the whole grant period.

**Maps:** report due and evidence owed by each partner; governing corpus is the grant agreement plus approved budget.

**New:** **budget-line provenance.** The claim is not "we spent it" but "this receipt belongs to line 2.3 of the approved budget" — a receipt-to-ledger-line mapping nothing else in the set requires.

**Risk:** hard deadline with money attached; the tool routes the date, never owns it.

## 7. Construction and renovation — variations, RFIs, payment claims

Builder, client, architect and subcontractors exchanging variations, RFIs, defect lists, COIs and progress claims. Disputes are usually about *what was agreed and when*.

**Maps:** waiting-on is the natural centre ("architect owes revised drawing," "subbie owes COI"); governing corpus is contract, drawings and specification.

**New:** **version-anchored documents.** "As per drawing A-102 rev C" is a different citation discipline from a message chunk — revision identity, not just a file. This is the case that forces the anchor model in §2 of the spec.

**Risk:** security-of-payment and adjudication windows are short and jurisdiction-specific; one day late is the whole dispute.

## 8. Regulatory and audit evidence requests

A PBC list or information request with 20–40 items, some already sent months ago, some needing a third party, plus a hard response window.

**Maps:** every requested item either has an evidence row with an anchor or is an open question; cross-check against Sent prevents re-sending.

**New:** **the coverage gate is the product.** Completeness is objectively measurable, which makes it the cleanest possible demo of "every ingested document produces a record or is explicitly reference-only."

**Risk:** high consequence, low tolerance for a miss. The right place to be strict rather than helpful.

## 9. Job search and recruitment

Applications, recruiter introductions, interview scheduling, "we'll come back to you by Friday," offer expiry.

**Maps:** two directions (you owe a portfolio; they owe a decision), no governing document, mostly soft deadlines.

**New:** **the pure case.** No second corpus, no attachments, no legal weight. If the ledger and the guard do not work here, they do not work anywhere. Also the only case with a genuinely zero-effort onboarding.

**Risk:** none serious — which is exactly why it is the right free showcase.

## 10. Tenancy and property management

Repair requests, entry notices, rent arrears, bond claims, contractor attendance.

**Maps:** two-direction ledger (landlord owes repair, tenant owes access); lease plus state legislation as the corpus; anchors are clauses and notice dates.

**New:** **paired obligations.** Every request has a required response window, so urgency is "days remaining on a notice period," not "days since a promise" — a third urgency shape beyond soft and statutory-deadline.

**Risk:** jurisdiction-specific, and the user might be landlord, tenant or agent — three different products wearing one name.

---

## Sequencing

| Order | Use case | Why |
|---|---|---|
| 1 | Job search | proves the engine at zero risk, zero onboarding cost |
| 2 | Audit / regulatory evidence | strongest commercial demo, because completeness is checkable |
| 3 | Accounting document chase (the PBC shape aimed at BAS/tax/EOY) | the actual wedge — recurring, paid, adjacent to Vault |
| 4 | Freelance scope + exec follow-through | exercises the outbound direction and a second corpus you control |
| later | Vendor procurement | same waiting-on model, third party, competing-vendor view |
| later | Grants, tenancy | excellent fits, but each drags in a document type nothing else needs |
| defer | Construction | forces revision-aware anchors early — the biggest schema decision |
| defer | Appeals, escrow | liability profile and portal coverage |

## What to cut

Anything where the operative conversation lives in a **portal rather than mail** — escrow, much of procurement, some regulatory correspondence.

These can still be served, but only if the **coverage statement** is a headline feature rather than a footnote: *here is what I read, here is what I could not see, here is what you must verify.* A ledger that quietly misses the portal message is worse than no ledger.

## The invariant this set establishes

Every case has the same five parts: a case, a governing corpus, a set of obligations, a deadline class, and a consequence. Email is one ingest channel into that.

The moment construction (drawings), audit (a PBC list), tenancy (legislation) and grants (a budget) are in the set, **the mailbox stops being the organising unit** — which is the finding that produced the case model.
