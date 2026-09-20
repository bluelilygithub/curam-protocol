# Shares statement upload & reconciliation

Scoped in chat (see session history), building in two steps. **Step 1 (schema) done. Step 2 (upload/parse/review pipeline) not started — blocked on nothing, just not built yet.**

## Why

`share_cash_ledger.type` was `deposit`/`withdraw` only — dividends, interest, and standalone fees had no home in the schema at all, so "did I capture every dividend" couldn't be answered even in principle. Fixed regardless of whether the upload pipeline ships, since logging one by hand is useful today.

## Step 1 — schema (done)

- `share_cash_ledger.type` extended to `deposit | withdraw | dividend | interest | fee`.
- `share_cash_ledger.withholdingTaxAud` (nullable) — a dividend row stores the **gross** amount in `amountAud` + withholding tax here; net received is always derived (`amountAud - withholdingTaxAud`), never stored separately, so the two can't drift apart. Null for every other type.
- `share_trades.sourceImportId` / `share_cash_ledger.sourceImportId` (nullable, no FK) — tags rows created via a statement import so an import can later be reverted (delete every row carrying its id) without touching manually-entered data. No FK on purpose: a deleted/reverted import shouldn't cascade-orphan the ledger rows it created, just lose their provenance tag.
- `share_statement_imports` (one row per uploaded PDF: filename, brokerHint, periodStart/periodEnd, status `pending|reviewing|applied|reverted`).
- `share_statement_lines` (one row per extracted line, before anything touches real data — the review-queue gate): `lineType` (`trade|dividend|interest|fee|drp|cash_balance|fx`), `parsedFields` JSONB, `dedupHash`, `matchStatus` (`needs_review|matches_existing|new|conflict|possible_correction|skipped_duplicate`), `matchedTradeId`/`matchedLedgerId`.

## Step 2 — pipeline (not built)

Decisions already made, to build against when this is picked up:

- **PDF only**, broker: CMC Markets (primary), built flexible rather than CMC-specific — LLM-based extraction (raw PDF text → structured line-item JSON via prompt, same pattern as Document Redaction's candidate extraction / Property Scenario's field extraction) rather than a positional/regex parser tied to one broker's layout. No sample statement was reviewed before building this decision — extraction accuracy on CMC's exact terminology (brokerage vs commission wording, FX line labels, franking credit phrasing) is a first-pass guess, expected to need correction once run against a real statement. That's acceptable because of the next point:
- **Full review queue, nothing auto-applied.** Every extracted line — matched or not — goes through `share_statement_lines` and requires explicit approve/edit/reject before anything writes to `share_trades`/`share_cash_ledger`. A misclassification costs a correction click, not a corrupted ledger.
- **Dedup**: key = `(date, symbol, lineType, amount)` hashed into `dedupHash`, checked against *every* prior line for that user (not just the current import) before something can reach the queue as "new". A line that already exists shows as `skipped_duplicate`, not silently dropped. `periodStart`/`periodEnd` overlap between imports is a non-blocking warning at upload time only (a corrected re-upload of the same period is legitimate).
- **DRP (dividend reinvestment)**: its own `lineType`, not folded into `dividend` — a DRP line is a dividend cash entry AND a linked `share_trades` buy row at once, reviewed as one paired item so they can't be approved inconsistently.
- **Corrections/reversals**: not auto-resolved. If an extracted line matches an existing `(date, symbol, lineType)` but the amount differs, flag `possible_correction` and let the user resolve by hand (edit the old row, or approve the new one and delete the old).
- **Tolerance for FX/cash-drift flags**: `max(0.5%, AUD $1)` — a flat floor to avoid cent-rounding false positives, percentage to catch real drift on larger amounts. Pinned as a literal, not left for the model to invent; revisit if it proves too noisy or too quiet in practice.
- **Withholding tax**: US dividends carry 15–30% US withholding — always record gross + withholding separately (see Step 1 schema), never net-only, since this matters for tax reporting.
- **Backfill**: forward-only for now, not backfilling historical CMC statements. Schema supports backdating fine either way (`tradedAt`/statement dates are arbitrary) — this was a priority decision, not a schema one.

## Explicitly not building

CSV import (PDF-only per the actual need), auto-apply of any line regardless of confidence, cross-broker layout detection beyond what the flexible LLM extraction naturally handles, automated correction/reversal resolution.
