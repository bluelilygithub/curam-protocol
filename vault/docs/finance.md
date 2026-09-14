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

Both rates are Settings values (`fin_vehicle_rate_per_km` default 0.88, `fin_home_office_rate_per_hour` default 0.70 — 2025-26 ATO rates) — **never hardcoded** in calculation code, since the ATO changes them yearly. Routes: `POST /api/finance/expenses/vehicle`, `POST /api/finance/expenses/home-office`.

### Settings vs the data-entry screens — once-a-year policy vs every-trip entry

These two calculators split cleanly into a once-a-year policy choice and an every-trip data-entry task, deliberately surfaced in two different places:

- **Finance → Settings → "Vehicle & Home Office" section**: the ATO rate fields (`fin_vehicle_rate_per_km`, `fin_home_office_rate_per_hour`, each saved via `PUT /api/finance/settings` on blur), and the **current financial year's** method lock for each claim type — a read-only summary once locked, or a one-time picker if unset. Only the current FY is shown here, deliberately — a "lock next FY ahead of time" control was tried and removed for being unnecessary complexity: the annual reminder (below) already prompts locking the new FY when it actually starts on 1 July, so this section never needs to answer for two years at once. No per-entry method choice lives here or anywhere else — this is the only place a method is ever chosen.
- **Finance → "Vehicle/Home Office" tab**: entry-only — Date, Purpose/Description, Km or Hours (or business-use % + actual cost, whichever the locked method calls for), a live-calculated Deductible read from the locked method + current rate, and Save. No method toggle, no rate field, no lock button. If the entry's date falls in a financial year with no locked method yet, the form shows a message and a "Go to Settings to lock a method" button (`onGoToSettings` prop, wired to `FinancePage`'s `setTab('Settings')` + a `focusSection` scroll-into-view) instead of any inline method picker.

### Method is locked per financial year, not chosen per entry — structural guard rail, not a default

The ATO requires **one method per financial year (1 Jul–30 Jun) per claim type** — you cannot mix `cents_per_km`/`logbook`, or `fixed_rate`/`actual_cost`, within the same FY. This is enforced structurally, not just a UI convention or a default:

- The locked method per FY is stored as a JSON map in the existing `settings` table (same row/key convention as `fin_vehicle_rate_per_km` etc.) under `fin_vehicle_method_by_year` / `fin_home_office_method_by_year`, e.g. `{ "2025-26": "cents_per_km", "2024-25": "logbook" }`. No new table — a settings-row JSONB-shaped value was the clean fit.
- `finYearForDate()` (duplicated identically in `server/routes/finance.js`, `client/src/pages/FinancePage.jsx`, and `server/cron/financeRemindersCron.js` — keep all three in sync if it ever changes) resolves a date to `"YYYY-YY"` (FY starts 1 July).
- Routes: `GET/POST /api/finance/vehicle-method` and `GET/POST /api/finance/home-office-method`, each `{ year, method }`. `GET` with no `year` query param returns the full map. Only Settings calls these — the entry screen never does.
- **Client cannot send a `method` field at all** from the entry screen — `VehicleHomeOfficeTab`'s save calls post only `date`, `purpose`/`description`, and the method-appropriate `km`/`hours`/`businessUsePercent`/`actualCost` fields; there is no state, control, or code path in that component capable of producing a `method` or rate value on the request, so there is nothing to override via devtools or otherwise.
- `POST /api/finance/expenses/vehicle` and `POST /api/finance/expenses/home-office` resolve the entry date's FY, look up the locked method, and use it — full stop. If no method is locked for that FY yet, the request is rejected with a 400 (`{ error, fy, needsMethodLock: 'vehicle' | 'homeOffice' }`) directing the caller to Settings. The rate (`fin_vehicle_rate_per_km` / `fin_home_office_rate_per_hour`) is also resolved server-side from Settings, never trusted from the request body. A legacy/defense-in-depth check still 400s if a direct API caller sends a `method` that disagrees with the locked one, but the normal client path can never trigger it since it never sends `method`.

### Vehicle trip-purpose dropdown

Vehicle entries use a short dropdown of common ATO-accepted sole-trader business-travel purposes (`VEHICLE_PURPOSES` in `FinancePage.jsx`) instead of free text: Client meeting/visit, Travel between two places of work, Delivering or collecting goods/supplies, Bank/post office/supplier errand, Attending a work-related course/conference, Travel to see an accountant/bookkeeper/tax agent, Vehicle servicing/repairs, and "Other (describe)" (shows a free-text field). The selected purpose becomes the expense description unless "Other" is picked. This is a description/organization aid only — a real logbook/diary is still what the ATO requires to substantiate a logbook-method claim; the dropdown does not replace it. Stored in a new `fin_vehicle_expenses.purpose` column.

### Vehicle logbook-method odometer readings

The logbook method applies the business-use % against total kilometres travelled for the FY — real substantiation needs a start- and end-of-year odometer reading on record, not just the logbook itself. When `logbook` is the locked vehicle method for the current FY, the Settings → "Vehicle & Home Office" section shows two fields: odometer at 1 July and at 30 June, each saved independently (the end reading is typically filled in later, closer to year-end). Stored the same way as the method locks — a JSON map by FY, `fin_vehicle_odometer_by_year: { "2025-26": { "start": 45210, "end": 52840 } }` — via `GET/POST /api/finance/vehicle-odometer`. The end reading is validated server-side to never be less than the start reading for the same year. Not used in the deductible calculation (business-use % applies to actual running costs, not total km) — this is purely the substantiation record the ATO expects to exist alongside the logbook.

### Home office fixed-rate bundling — what it does and doesn't cover

The ATO fixed rate (`fin_home_office_rate_per_hour`) already bundles **electricity, gas, phone, internet, and stationery/computer consumables** — a user on fixed-rate for a FY should not separately expense those specific categories that year (double-claiming). It does **not** bundle depreciation or repairs/maintenance on office furniture/equipment (desk, chair, monitor, computer) — those stay separately claimable even while fixed-rate is locked, and doing so is not "mixing methods." The Home Office card shows a prominent warning callout listing the bundled categories whenever fixed-rate is the FY's locked method.

### Office Equipment & Depreciation — standalone entry point

Not subject to either method lock, so it lives in its **own standalone card** on the Vehicle/Home Office tab — a sibling of the Vehicle and Home Office cards, not nested under Home Office. Posts a normal expense (`POST /api/finance/expenses`, category "Office Equipment", capital-asset checkbox pre-ticked) independent of whichever vehicle or home-office method is locked for the year, unchanged from its original behaviour — only its placement moved. All three cards (Vehicle, Home Office, Office Equipment & Depreciation) sit in one `md:grid-cols-3` row rather than wrapping 2-then-1.

### Home office fixed-rate substantiation — two record types, two frequencies

Real ATO compliance for the fixed-rate method needs two different kinds of record, kept at two different frequencies — the tool now mirrors that split rather than treating home office as one undifferentiated form:

- **Hours record (frequent, contemporaneous)** — every dated entry saved on the Home Office card (date + hours) *is* this record. A note under the hours field says so explicitly, framing the entry list as an ongoing diary rather than a one-off calculation, since the ATO requires this built up across the year as-you-go, not reconstructed later from a "typical week."
- **Expense-type evidence (sparse, one per category)** — a small upload panel (`fin_home_office_evidence` table, `UNIQUE(userId, category)` so a new upload replaces rather than accumulates) lets the user attach one bill/receipt each for electricity, internet, phone, and stationery/consumables — shown only while fixed-rate is the FY's locked method. This isn't proving the *amount* (the flat rate handles that) — just that the cost type genuinely exists. Routes: `GET/POST /api/finance/home-office-evidence/:category`, `GET /api/finance/home-office-evidence/:category/file`, `DELETE /api/finance/home-office-evidence/:category` — reuses the existing `receiptUpload` multer instance and `RECEIPT_DIR` from the expense-receipt feature.
- Office equipment/depreciation (above) is a third, separate evidence type again — purchase receipts for that, unrelated to the hours log or the expense-type evidence.

### Daily WFH hours diary — global popup, separate from the periodic deduction entries

A third record type, on top of the two above, addressing the same ATO requirement for a genuine
**contemporaneous** hours record rather than a weekly-batched estimate reconstructed later:

- **Table**: `fin_home_office_daily_log` (`id`, `userId`, `date` UNIQUE per user+date, `hours` NUMERIC `>= 0`, `source` — `'popup'` or `'manual'`, for debugging only, not user-facing — `createdAt`/`updatedAt`). This is a **separate table** from `fin_home_office_expenses` and has **zero journal/accounting impact** — writing to it never touches `fin_expenses` or `fin_journal_entries`. The existing periodic "Save Hours" flow on the Home Office card (`POST /api/finance/expenses/home-office`, documented above) is unchanged and remains the only thing that actually posts the fixed-rate deduction into the books.
- **Routes** (`server/routes/finance.js`):
  - `GET /api/finance/home-office-daily-log/gaps` — the weekdays (Mon–Fri) in the last 14 calendar days (excluding today, since a day isn't "unfilled" until it's over) with no row in the log for the current user, oldest first. Weekends are never included. Returns `[]` entirely unless `fixed_rate` is the locked home-office method for the FY each candidate date falls in (reuses `getMethodByYearMap`/`finYearForDate`) — if no method is locked, or the locked method is `actual_cost`, the feature is a no-op.
  - `POST /api/finance/home-office-daily-log` — `{ date, hours, source }` upserts (`ON CONFLICT ("userId", date) DO UPDATE`) one row. `hours` must be a number `>= 0` — `0` is a valid, explicit "logged, didn't work from home that day" answer, distinct from no row existing at all (unanswered). No journal posting.
  - `GET /api/finance/home-office-daily-log` — the user's log for the last 60 days, for display purposes (the card summary + older-gaps list below).
- **Global popup** (`client/src/components/WfhHoursPrompt.jsx`) — mounted once in `Layout.jsx` (same "render once, globally" pattern as `ProcessingModal`/`TaskReminderModal`), gated behind `canUseFeature('finance')` so it never appears without Finance access. On mount, checks a `localStorage` flag (`vault:wfhPromptShownDate`, today's date) so it queries the gaps endpoint and can appear at most once per calendar day per browser regardless of page navigation, but checks again the next day. If gaps exist, prompts for the oldest first ("How many hours did you work from home on [Wednesday 10 September]?") with a decimal-hours input, a "Didn't work from home that day (0 hours)" quick action, and Save — saving advances to the next-oldest gap automatically until the queue clears, and the modal can be dismissed at any point without losing already-saved days (it simply re-prompts next day for whatever's still unfilled). Matches the `HelpModal` modal chrome (`z-50`, theme-aware `var(--color-*)` tokens) and tooltips every control.
- **14-day backfill cap** — the popup only ever queues the last 14 calendar days (weekends excluded server-side). Gaps older than that are **not** force-prompted — instead the Home Office card (only while `fixed_rate` is locked) shows a plain, non-modal "N earlier days still unfilled" list computed client-side from the same 60-day log fetch plus the locked-method-by-year map, so nothing is silently lost.
- **Home Office card summary** — a small read-only line near the top of the card (fixed-rate only): "Daily log: N hours recorded over the last 14 days across M days", read from the log table. Purely informational — it does not feed into, auto-fill, or reconcile against the periodic "Save Hours" totals; the user still enters those manually as before.

### Annual reminder

Two mechanisms, reusing existing infrastructure rather than a new notification channel:

- **Proactive (once a year, around 1 July)**: `checkAnnualVehicleHoReminder()` in `server/cron/financeRemindersCron.js`, scheduled daily at 08:00 alongside the existing weekly overdue-items cron (`startFinanceRemindersCron()`). It no-ops outside a ~25 June – 14 July window (a window rather than an exact date, so a brief deploy/downtime around 1 July doesn't skip the year entirely), then for each user with `fin_admin_email` set: resolves the FY starting that 1 July, checks whether the vehicle/home-office methods are locked for it, and if either is missing — captures a `SuggestionService.captureIf()` entry (category `alert`, fingerprinted per FY so it only opens once) in the Suggestions inbox, **and** sends an email to the admin address using the same `sendEmail()` / HTML-building pattern as the weekly reminders. Deduped per calendar year via a `fin_annual_vho_reminder_year` settings value so it fires at most once per user per year regardless of how many days the window is open. The Suggestions inbox was judged the right fit for this low-urgency, once-a-year nudge (matches the "missing config" use case already documented for that inbox); the email is kept too since this app's convention is to always CC the admin on finance-cron findings.
- **Reactive (the moment it actually matters)**: if a user tries to log a vehicle/home-office entry dated in a FY with no locked method, `POST /api/finance/expenses/vehicle` / `.../home-office` 400 with `needsMethodLock`, and the entry screen's `NoMethodLockedNotice` shows a clear message plus a "Go to Settings to lock a method" button that jumps straight to the Settings section (`FinancePage`'s `setTab('Settings')` + `focusSection` scroll-into-view) — this is the more urgent, contextual form of the same reminder.

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
