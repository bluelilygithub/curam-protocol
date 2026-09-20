# Shares statement upload & reconciliation

Scoped in chat (see session history), built in two steps. **Both done. Narrowed to dividends only after real-world testing (see "Scoped back to dividends" below)** — trade date/price matching against real CMC statements proved unreliable enough (even after fixes) that the user asked to limit the tool to dividends until trade data quality is sorted out separately.

## Scoped back to dividends (2026-09-20)

Real-usage testing surfaced repeated trade-matching problems even after several fixes (date-format DD/MM vs MM/DD, price never being compared, exchange defaulting wrongly to ASX). Genuine trades kept classifying as `new` when they existed, and the user suspects the root issue is upstream — imprecise price/date in their own manually-entered `share_trades` history, not purely an extraction bug. Rather than keep patching trade matching blind, scoped the tool back to what has no matching problem at all: **dividends only**.

- `LINE_TYPES` (app-level filter) narrowed to `['dividend']`; `ALL_SCHEMA_LINE_TYPES` kept as a separate constant documenting the full set the DB schema still supports. **No schema rollback** — `share_statement_lines."lineType"` CHECK constraint is untouched, so re-enabling trade/fee/interest/drp later is a prompt + filter change, not another migration.
- Extraction prompt rewritten to ask for dividend lines only, not "classify everything, skip most of it" — a narrower ask is a more reliable one. Trade/fee/interest/cash-balance/fx lines are no longer extracted at all, even to be filtered out.
- `classifyLine`'s trade-matching branch (date/quantity/price/fee/FX comparison, `resolveExchange()`) is untouched in the code but currently unreachable — dividends take the separate `['dividend','interest','fee'].includes(...)` branch, which has no matching problem (nothing could exist before this feature, so every dividend is legitimately `new` or `possible_correction` against another import, never a false match).
- All prior review-queue history wiped at the user's request once this was decided: 85 pending/rejected `share_statement_lines` rows and 2 `share_statement_imports` deleted for the account. Confirmed first: 0 rows had ever been approved to real `share_trades`/`share_cash_ledger` (nothing to revert, nothing lost).

**Re-enabling trades later**: needs the user's own trade data cleaned up first (accurate per-trade price and date, not averaged/estimated values) — that's a data-quality problem in their existing `share_trades` rows, not something this feature can fix by extracting harder. Once that's sorted, flip `LINE_TYPES` back to the full set and restore the fuller extraction prompt (kept in git history, not deleted).

## Real-statement findings (first upload)

The user's actual CMC Markets export turned out to be a "Trading Account Statement" — a pure cash-ledger view, not a per-trade contract note. Two real bugs surfaced, both fixed:

1. **`extractPdfText()` was broken for everyone, not just this feature.** `pdfjs-dist@6.1.200`'s `legacy/build/pdf.js` (CommonJS) no longer exists — the package moved to ESM-only (`pdf.mjs`) — so every PDF upload through this shared utility (`server/services/studyUploadExtract.js`, also used by Student Cards) was silently returning empty text. Fixed via dynamic `import()` from the CommonJS module. Pre-existing bug, unrelated to this feature's own code — this upload just happened to be the first thing to surface it in front of a user.
2. **`approveLine()` defaulted a missing `exchange` to `'ASX'`.** CMC's format suffixes US tickers `:US` with no NASDAQ/NYSE distinction — that default would have silently booked every US trade as an ASX one. Fixed: `resolveExchange()` now looks up the user's own trade history for that symbol first (the app already knows TSM is NYSE, GOOG is NASDAQ, etc. from existing trades); only defaults to ASX when the currency is itself AUD; otherwise refuses and asks for a manual edit rather than guessing.

Extraction prompt updated for what the real statement showed:
- Each trade is one line (`Bght/Sold N SYMBOL:US @ PRICE AUD`); the `Wdl ACMM ...` / `Dep ACMM ...` lines immediately after it are internal settlement transfers tied to the same trade reference, not separate cash events — the model is now told to skip them entirely rather than emit them as spurious deposit/withdraw/fee lines.
- Dividend lines (`JNL#### SYMBOL:US Intl Div Ex:DD/MM/YY`) show **net only** on this statement type — confirmed no gross/withholding breakdown exists on it at all. Not a parsing gap to fix; a real limit of this report. If withholding tracking matters, it'll need a different CMC report or manual entry — noted honestly rather than having the model estimate a split it can't see.
- PDF column layout occasionally inserts a space as a thousands separator (`2 208.9010` = 2208.9010) — prompt now tells the model to strip it rather than misread two numbers.
- Symbols are suffixed `:US`; prompt now strips it and asks for an explicit NASDAQ/NYSE/ASX guess only when confident, `null` otherwise (feeding `resolveExchange()`'s trade-history lookup above).

Not yet re-tested against the corrected prompt with a live upload — the fixes above are argued from the real extracted text, not yet confirmed against the model's actual output on this statement.

## Why

`share_cash_ledger.type` was `deposit`/`withdraw` only — dividends, interest, and standalone fees had no home in the schema at all, so "did I capture every dividend" couldn't be answered even in principle. Fixed regardless of whether the upload pipeline ships, since logging one by hand is useful today.

## Step 1 — schema (done)

- `share_cash_ledger.type` extended to `deposit | withdraw | dividend | interest | fee`.
- `share_cash_ledger.withholdingTaxAud` (nullable) — a dividend row stores the **gross** amount in `amountAud` + withholding tax here; net received is always derived (`amountAud - withholdingTaxAud`), never stored separately, so the two can't drift apart. Null for every other type.
- `share_trades.sourceImportId` / `share_cash_ledger.sourceImportId` (nullable, no FK) — tags rows created via a statement import so an import can later be reverted (delete every row carrying its id) without touching manually-entered data. No FK on purpose: a deleted/reverted import shouldn't cascade-orphan the ledger rows it created, just lose their provenance tag.
- `share_statement_imports` (one row per uploaded PDF: filename, brokerHint, periodStart/periodEnd, status `pending|reviewing|applied|reverted`).
- `share_statement_lines` (one row per extracted line, before anything touches real data — the review-queue gate): `lineType` (`trade|dividend|interest|fee|drp|cash_balance|fx`), `parsedFields` JSONB, `dedupHash`, `matchStatus` (`needs_review|matches_existing|new|conflict|possible_correction|skipped_duplicate`), `matchedTradeId`/`matchedLedgerId`.

## Step 2 — pipeline (done)

- `server/services/sharesStatementImport.js` — `extractLinesFromPdf()` (reuses `studyUploadExtract.js`'s `extractPdfText()`, pdfjs-dist — exported from there rather than duplicated), `classifyLine()` (dedup + match-existing + tolerance + correction detection), `createImport()`, `approveLine()`/`rejectLine()`, `revertImport()`.
- `server/routes/sharesStatements.js`, mounted `/api/shares/statements` (before the broader `/api/shares` mount, same ordering rule as `/api/shares/news`), `aiLimiter` applied (extraction is an LLM call): `POST /upload` (multipart PDF), `GET /` (list imports), `GET /:id` (import + lines), `PUT /lines/:lineId` (edit before approving — refused once reviewed), `POST /lines/:lineId/approve`, `POST /lines/:lineId/reject`, `POST /:id/revert`.
- Extraction model: `getModelsForUser().standard`, one call per upload, `maxTokens: 4096`, raw PDF text capped at 60k chars sent to the model. Logged via `logUsage()` under feature `sharesStatementImport`.
- Frontend: `client/src/components/shares/SharesStatementsTab.jsx`, new **Statements** tab on `SharesPage.jsx`. Upload → `ProcessingModal` (LLM call, >2s) → import auto-expands into its review queue. Each line shows type/date/amount/match badge, Approve/Edit/Reject when pending; `possible_correction`/`conflict` lines get an explanatory warning line. Revert button appears on an import once any of its lines have been applied.

Decisions this implements verbatim from scoping:

- **PDF only**, broker: CMC Markets (primary), built flexible rather than CMC-specific — LLM-based extraction (raw PDF text → structured line-item JSON via prompt, same pattern as Document Redaction's candidate extraction / Property Scenario's field extraction) rather than a positional/regex parser tied to one broker's layout. No sample statement was reviewed before building this decision — extraction accuracy on CMC's exact terminology (brokerage vs commission wording, FX line labels, franking credit phrasing) is a first-pass guess, expected to need correction once run against a real statement. That's acceptable because of the next point:
- **Full review queue, nothing auto-applied.** Every extracted line — matched or not — goes through `share_statement_lines` and requires explicit approve/edit/reject before anything writes to `share_trades`/`share_cash_ledger`. A misclassification costs a correction click, not a corrupted ledger.
- **Dedup**: key = `(date, symbol, lineType, amount)` hashed into `dedupHash`, checked against *every* prior line for that user (not just the current import) before something can reach the queue as "new". A line that already exists shows as `skipped_duplicate`, not silently dropped. `periodStart`/`periodEnd` overlap between imports is a non-blocking warning at upload time only (a corrected re-upload of the same period is legitimate).
- **DRP (dividend reinvestment)**: its own `lineType`, not folded into `dividend` — a DRP line is a dividend cash entry AND a linked `share_trades` buy row at once, reviewed as one paired item so they can't be approved inconsistently.
- **Corrections/reversals**: not auto-resolved. If an extracted line matches an existing `(date, symbol, lineType)` but the amount differs, flag `possible_correction` and let the user resolve by hand (edit the old row, or approve the new one and delete the old).
- **Tolerance for FX/cash-drift flags**: `max(0.5%, AUD $1)` — a flat floor to avoid cent-rounding false positives, percentage to catch real drift on larger amounts. Pinned as a literal, not left for the model to invent; revisit if it proves too noisy or too quiet in practice.
- **`classifyLine`'s trade check compares price, fees, AND FX rate** against the matched `share_trades` row (each at the tolerance above) — a genuine price discrepancy (e.g. an averaged/rounded cost entered by hand vs the statement's exact per-trade price) surfaces as `conflict`, not silently as `matches_existing`. This was originally missing (fees/FX only) — found via a user question about why a trade might mismatch, fixed once asked, not caught in review beforehand despite "US to AUD trade price discrepancies" being one of the four founding examples for this whole feature.
- **Withholding tax**: US dividends carry 15–30% US withholding — always record gross + withholding separately (see Step 1 schema), never net-only, since this matters for tax reporting.
- **Backfill**: forward-only for now, not backfilling historical CMC statements. Schema supports backdating fine either way (`tradedAt`/statement dates are arbitrary) — this was a priority decision, not a schema one.

## Explicitly not building

CSV import (PDF-only per the actual need), auto-apply of any line regardless of confidence, cross-broker layout detection beyond what the flexible LLM extraction naturally handles, automated correction/reversal resolution.
