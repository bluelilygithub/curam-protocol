# Shares app — roadmap

The agreed plan for the Shares app (`/shares`). Referenced from `CLAUDE.md`. The plan and decisions below are kept exactly as agreed; the status block is a factual note of what has shipped, kept separate so the plan text stays untouched.

## Status (as of 2026-09-30)

Shipped to production (`version-7`), each as its own push:

- **Step 1 code — dividends:** withholding gross/net (derived, editable), franking columns, `paidOn` backfill and editing. Commit `6be2c7ef`.
- **Step 2 code — CGT view:** parcels, held-days wording, FY totals. Commits `0b1d2aaf`, `eda71970`. *Not built yet:* the "what-if sell" part.
- **Not on the roadmap:** the Charts range fix and sub-tabs (commit `ca8540bd`).

**Still to verify on production** (the checks in the steps below): the Cash tab ledger total is unchanged; the 14 dividends and their dates match CMC; FY 2025-26 shows a $7,501.33 loss carried forward. Open questions from step 1: confirm W-8BEN with CMC; which database staging uses.

## Decisions already made (don't reopen)

- CGT uses stored AUD trade figures as-is; no FX conversion (all 27 trades are AUD).
- Parcel matching: FIFO. The 12-month test excludes both the purchase day and the sale day (bought 1 Jan 2025 → first eligible sale 2 Jan 2026), using trade date. Add a test for that boundary.
- Withholding: gross = net ÷ 0.85, flagged "derived", editable per dividend. `amountAud` stays net.
- XIRR and TWR: each shown with its own date range (XIRR can run from the first trade; TWR is limited to snapshots). Benchmarks (QQQ, SOXX) converted to AUD using stored AUD/USD, or clearly labelled by currency.
- No price forecasting.
- Deploy one change at a time so any wrong number can be traced to one change.

## Roadmap (in order)

1. **Dividend deploy:** #1 withholding, #5 franking columns, `paidOn` backfill, `paidOn` editing in the dividend edit form and route. Before deploy: confirm W-8BEN with CMC, note the net ledger total, take the Railway backup, and answer which database staging uses. After deploy: check the Cash tab in a browser, confirm the ledger total is unchanged, and check the 14 dividends and dates against CMC.
2. **CGT view (#2),** deployed separately after step 1 is verified. Fixes: sold parcels show "No — held N days" instead of "eligible from"; "eligible from" only for parcels still held; drop the per-row "After discount" column; add an FY totals section (gains, losses applied to non-discount gains first, discount on remainder, net gain or net loss carried forward — FY 2025-26 should show a $7,501.33 loss carried forward). Then add what-if sell per parcel: gain and discount status if sold today.
3. **Data health panel** (stale quotes, missing FX, trades or dividends that don't reconcile); spot-check the 27 trades for USD prices labelled AUD; check whether any holding has had a split since purchase; export to CSV/JSON; a settings screen for the withholding rate.
4. **Tax summary (#3)** for the financial year: gross foreign dividends by `paidOn`, US tax withheld, capital gains netted with losses, carried-forward loss, and a list of any dividends that couldn't be grossed up (totals marked incomplete if any).
5. **XIRR and time-weighted return (#4)** on the Portfolio tab, per the decisions above.
6. **Currency effect** per US holding (share price vs AUD/USD), contribution analysis (price vs dividends vs currency), concentration, correlation and risk measures (volatility, max drawdown, 10%/20% fall scenario).
7. **Events and alerts:** US filings feed (8-Ks) per holding, dividend calendar and yield on cost, earnings season view, alerts for large moves, upcoming earnings and parcels nearing 12 months.
8. **Markets tab:** US sector indexes, ASX 200 headline, AUD/USD, US and AU 10-year yields, VIX, oil, copper, and a "your exposure" column.
9. **Competitive analysis:** peers panel per holding (Finnhub peers; valuation, growth, margins, relative performance, earnings history), peer news in daily briefings, peer comparisons in the Questions tab.
10. **Decision and forecasting tools:** thesis journal, watchlist, signal scorecard by stock and source, income projection, scenario tools, target tracking, rebalancing drift.

**Later:** live reconciliation to CMC statements; corporate actions (sooner if step 3 finds a split); reconcile withholding against a CMC annual tax statement; Questions tab explaining performance; re-enable statement trade extraction once trade history is clean; prune unused charts. Fee tracking is on hold pending the accountant.
