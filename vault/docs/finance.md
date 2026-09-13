# Finance module

Real double-entry bookkeeping for a sole trader. Route: `server/routes/finance.js`. Client: `client/src/pages/FinancePage.jsx`. Every posting goes through the shared journal helper so the books stay balanced by construction (see **Journal balance guarantee** below).

## Chart of accounts (`DEFAULT_ACCOUNTS`)

| Code | Name | Type |
|---|---|---|
| 1000 | Bank / Cash | asset |
| 1100 | Accounts Receivable | asset |
| 1200 | GST Paid | asset |
| 2000 | Accounts Payable | liability |
| 2100 | Credit Card | liability |
| 2200 | GST Collected | liability |
| 2300 | Super Payable | liability |
| 2400 | PAYG Withholding Payable | liability |
| 3000 | Owner's Equity | equity |
| 3100 | Owner's Drawings | equity |
| 4000 | Income | income |
| 4100 | Interest Income | income |
| 5000 | Expenses | expense |
| 6000 | Wages | expense |
| 6100 | Superannuation Expense | expense |

Seeded per user by `ensureAccounts()`; users can add their own non-system accounts on top.

## Journal balance guarantee (A1)

`createJournalEntry()` (the single function every route uses to post a journal — invoices, expenses, wages, drawings, BAS settlement, interest, and manual entries) rounds and sums `debit`/`credit` across the `lines[]` it's given and **throws** if they don't match (epsilon 0.005 to absorb floating-point noise). `POST /journal` (the manual entry route) also pre-checks this itself and returns a clean 400 with the exact debit/credit totals, rather than a generic 500.

This means no code path — present or future — can ever write an unbalanced entry to `fin_journal_entries`/`fin_journal_lines`. The Trial Balance and Balance Sheet reports' "balanced" checks are a *consequence* of this guarantee, not independent logic.

Wages get a friendlier, wages-specific 400 message (`POST /wages`) when the client-supplied `net` doesn't equal `gross - tax`, before the request ever reaches the generic journal-balance guard.

## Cash-basis GST (A3)

BAS/GST figures are cash-basis: income recognized when an invoice's `paidAt` falls in the period, expenses recognized on their `date` (payment date). This is internally consistent but will not match an accrual-basis BAS. A disclosure note is shown wherever BAS/GST figures appear (BAS tab, GST Summary report, Profit & Loss report). Accrual-basis GST is out of scope.

## Owner's Drawings vs Wages (B1)

- **Wages** (`fin_wages`, account 6000/6100): for actual employees. Posts DR Wages (gross), DR Super Expense, CR Bank (net), CR PAYG Withholding Payable, CR Super Payable.
- **Drawings** (`fin_drawings`, account 3100 `Owner's Drawings`, equity): for the sole trader's own withdrawals. No PAYG, no super — it's a reduction of equity, not an expense. Posts a simple two-line entry: DR Owner's Drawings, CR Bank/paidVia account. Routes: `GET/POST/PUT/DELETE /api/finance/drawings`.

The sole trader's own "income" is the business profit (P&L net profit), reported on their individual tax return — Drawings just moves already-earned equity into their pocket.

## Vehicle & Home Office expense calculators (B2)

Both post through the normal expense journal (DR Expenses 5000, CR Bank/paidVia) so they flow into P&L/BAS like any other expense — the calculator is a thin layer that computes the deductible amount first.

- **Vehicle** (`fin_vehicle_expenses`, linked 1:1 to a `fin_expenses` row via `expenseId`): `cents_per_km` (km × `fin_vehicle_rate_per_km` setting) or `logbook` (actualCost × businessUsePercent / 100). Tx code `EXP-190`.
- **Home Office** (`fin_home_office_expenses`, same pattern): `fixed_rate` (hours × `fin_home_office_rate_per_hour` setting) or `actual_cost` (actualCost × businessUsePercent / 100). Tx code `EXP-200`.

Both rates are editable Settings values (`fin_vehicle_rate_per_km` default 0.88, `fin_home_office_rate_per_hour` default 0.70 — 2025-26 ATO rates) — **never hardcoded** in calculation code, since the ATO changes them yearly. Routes: `POST /api/finance/expenses/vehicle`, `POST /api/finance/expenses/home-office`. Client: "Vehicle/Home Office" tab.

## Capital asset flag (B3)

`fin_expenses."isCapitalAsset"` (boolean, default false). Ticked on the expense form, it posts the identical journal (no depreciation schedule — out of scope) but is visibly badged in the Expenses list and called out in a separate "Capital Asset Purchases" section of the Profit & Loss report, with a note to pass it to the accountant for the asset register / instant-asset-write-off assessment.

## Reports (Part C)

All four reports read `fin_journal_entries`/`fin_journal_lines` directly (the journal is the source of truth) rather than re-summing `fin_invoices`/`fin_expenses`/`fin_wages` — so manual journal entries are correctly included, which summing the source tables would miss.

- `GET /reports/profit-loss?from=&to=` — income accounts (credit − debit) minus expense accounts (debit − credit) for the period; separate capital-asset-flagged section.
- `GET /reports/balance-sheet?asOf=` — asset/liability/equity balances as of a date, plus the period's income − expense folded into an explicit "Retained Earnings" equity line (this is required for Assets = Liabilities + Equity to hold, since income/expense accounts aren't balance-sheet accounts themselves). Returns `isBalanced` + `difference`, verified server-side, never plugged.
- `GET /reports/gst-summary?from=&to=` — extends the existing `/bas` cash-basis calculation with a breakdown by tx code, instead of reimplementing GST logic.
- `GET /reports/trial-balance?asOf=` — every account's debit/credit balance as of a date; `isBalanced` is a direct consequence of the A1 guarantee.

Client: "Reports" tab, four sub-tabs, each with a date picker and a CSV export button (`downloadCsv()` helper, same blob-download pattern as the existing MYOB/Xero/Sheets exports).

## Charts (Part D)

Also under the Reports tab ("Charts" sub-tab). Three plain inline-SVG charts, no charting library, theme-aware via `var(--color-*)`:

- **Income vs Expenses** (`GET /reports/chart-income-expense`, monthly, last 12 months) — 2-series grouped bar chart with a legend, fixed hue order (`--color-primary` / `--color-muted`), hover tooltip.
- **Bank balance trend** (`GET /reports/chart-cash-flow`, last 12 months) — single-series line chart, mirrors `HtmlAuditPage.jsx`'s `ScoreTrendChart` pattern exactly (plain SVG, `--color-primary`, hover crosshair, no legend).
- **GST Collected vs GST Paid per BAS quarter** (`GET /reports/chart-gst-quarters`, last 8 quarters) — same 2-series bar chart component as Income vs Expenses.

## Tooltips (Part E)

The shared `Tooltip` component (`client/src/components/Tooltip.jsx`) is used on every new control introduced by this work (Drawings, Vehicle/Home Office calculators, capital-asset checkbox, all four Reports' date pickers and export buttons) plus a pass over the most safety-critical existing controls (Wages net-pay field, BAS cash-basis area, and the ABN/GST-registered/bank-detail/payment-terms Settings fields). Full exhaustive coverage of every existing control across Invoices/Clients/Suppliers/Codes/Accounts was not attempted in this pass — flagged as a follow-up.

## Deliberately out of scope

- **Accrual-basis GST** — only cash-basis is implemented; a disclosure note is shown instead.
- **Depreciation schedules** — the capital-asset flag only *flags and calls out* a purchase; it does not calculate depreciation or write an asset register.
