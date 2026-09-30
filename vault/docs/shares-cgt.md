# Shares — CGT by parcel (CGT tab)

Capital gains per purchase parcel, in AUD, with the 12-month CGT-discount test. Calculation: `server/services/sharesCgt.js` (pure — no DB, no network). API: `GET /api/shares/cgt?fy=2025-26|all` (`shares.js`, read-only, nothing stored, **no schema change**). UI: `client/src/components/shares/SharesCgtTab.jsx`. Tests: `node server/services/sharesCgt.test.js` (21 tests).

## Rules (decided with the user, 2026-09-30)

- **FIFO parcel matching.** A sale consumes the oldest unsold purchase first (the ATO default when parcels aren't specifically identified). Not average cost — the Portfolio tab's "Realised P&L" *does* use average cost, so the two differ; the CGT tab says so. Specific-parcel choice (per sale) was considered and not built; it would need a schema change to store the choice.
- **Trade date, never settlement date.** Uses `share_trades."tradedAt"`. That column holds the true instant (the trade form sends `new Date(local).toISOString()`), so the calendar day is read in the **workspace timezone** (`getWorkspaceTimezone()`, default `Australia/Sydney`) — a 00:30 AEDT trade on 1 Jan is a 1 Jan trade even though it is 31 Dec in UTC. Trades have no settlement field; a stray one is ignored.
- **12-month test excludes both the purchase day and the sale day.** Bought 1 Jan 2025 → first eligible sale **2 Jan 2026**. Implemented as `discountEligibleFrom(acquiredOn) = (same day next year) + 1 day`; eligible iff `soldOn >= discountEligibleFrom`. A 29 Feb acquisition clamps its anniversary to 28 Feb (eligible from 1 Mar) — a leap-day edge to confirm with an accountant. This exact boundary is pinned by tests (31 Dec / 1 Jan not eligible, 2 Jan eligible; through the pure function *and* the API), and the tests were mutation-checked (changing the rule makes 7 of them fail).
- **AUD as stored.** Cost and proceeds are the AUD figures on each trade (what CMC settled). No exchange-rate conversion — re-converting an AUD price would double-convert. (The original backlog wording said "converted at the rate on the day"; that was superseded by this decision.) Any trade marked `USD` is treated as AUD and produces a warning; production had 27 trades, all AUD.
- **Brokerage:** cost = qty × price + buy fees; proceeds = qty × price − sell fees, allocated across parcels in whole cents (the rows for one sale add up to exactly its net proceeds; a parcel's cost is never lost or duplicated).
- **Discount = 50%** (an individual). Not modelled: company (0%) / SMSF (33⅓%), prior-year capital losses, non-resident rules.

## Sold parcels table and FY totals

- **Sold parcels:** one row per parcel a sale consumed — bought, sold, days held, quantity, cost, proceeds, gain/loss, and *"Held over 12 months?"* shown as the result — `✓ Yes — held 420 days` / `No — held 113 days`. There is deliberately no per-row "after discount" figure: the discount only makes sense after the year's losses are netted off, so it lives in the totals. ("Eligible from" appears only on parcels still held.)
- **FY totals** (one block per financial year, by sale date, AU FY Jul–Jun; "All years" shows one block per year because the loss/discount netting is a per-year calculation): gains eligible for discount, other gains, total gains → capital losses, applied to **gains that don't qualify for the discount first**, then to discount-eligible gains → other gains remaining, discount-eligible gains remaining → 50% discount on that remainder → **net capital gain**, or **net capital loss carried forward** when losses exceed the year's gains. Server: `summariseDisposals()` returns every step (`lossesAppliedToOtherAud`, `lossesAppliedToDiscountableAud`, `gainsOtherRemainingAud`, `gainsDiscountableRemainingAud`, `discountAmountAud`, `netCapitalGainAud`, `lossCarriedForwardAud`); the client only displays them. Tests pin a net-loss year ($13,501.33 of losses against $6,000 of gains → $7,501.33 carried forward) and that every dollar of loss is either applied or carried forward.
- Indicative only: losses carried forward from earlier years are not included.

## Data problems are flagged, not hidden

A sale of more than was bought (or dated before the purchase) is reported as a warning naming the symbol/date/quantity; only the matched quantity is taxed and that quantity has no cost base. Unreadable trade dates are skipped with a warning.

## Parcels still held

Each open parcel shows the date it becomes eligible and whether it already is (today's date in the workspace timezone). "Value now"/"Unrealised" are computed client-side from the Portfolio tab's latest quote — indicative, before any discount.

## Extras

The tab has an FY selector and CSV export. The API also returns `fySummaries` (one summary per financial year) for the planned financial-year tax summary.
