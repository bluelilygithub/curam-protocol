# Shares — Charts tab

Insight charts aligned with the daily **Portfolio Note** observation pipeline. Implementation: `server/services/sharesChartData.js` · UI: `client/src/components/shares/SharesChartsTab.jsx`.

---

## API

**`GET /api/shares/charts?days=1|7|30|90`**

Default `days=30`. Returns structured chart payloads (not raw DB rows).

| Field | Description |
|---|---|
| `benchmarksToday` | Holdings day % vs Nasdaq / SOX / ASX 200 ETF proxies |
| `portfolioMove` | Holdings-only day move (cash excluded) |
| `dayMovers` | Enriched holdings with `dayChangePct`, `vsSectorPct`, `relativeToSector`, sector benchmark |
| `alertRows` | % off peak HWM, % off avg cost, ⚠️/🔴 flags (read-only — does not persist HWM) |
| `trailingReturns` | ~5-day price return from `share_symbol_snapshots` |
| `allocation` / `allocationByBenchmark` | Weight by ticker vs benchmark bucket (Nasdaq / SOX / ASX 200) |
| `holdingPnl` | Total unrealised return vs cost |
| `normalizedPerformance` | Cumulative daily returns rebased to 100 from stored observations |
| `portfolioSnapshots` | `share_portfolio_snapshots` over the window (daily dedupe when `days > 1`) |
| `bySymbol` | Price AUD history keyed `symbol:exchange` |
| `earningsTimeline` | Finnhub US earnings calendar (~90 days) |
| `moveHeatmap` | Daily price moves from snapshots; amber outline = unexplained material move |
| `patternSummary` | Lagging cluster + recurring unexplained movers from observation `headlines` |
| `metals` | Gold book move, spot history, metals alert rows (when `metal_purchases` exist) |

Legacy fields `portfolioLine`, `allocation`, `holdingPnl`, `bySymbol` remain for compatibility.

---

## Chart sections (UI)

### Today
- **Portfolio vs benchmarks** — same basis as Portfolio Note email header chips
- **Day movers & beat/lag** — per holding day % + divergence vs assigned sector proxy
- **Drawdown & alert status** — HWM drawdown bars with 10% peak / 4% cost reference triggers

### Performance
- **Relative performance** — portfolio vs QQQ/SOXX/STW proxies (requires several days of `type='observation'` rows)
- **Portfolio value** — total / holdings / optional cash line; unrealised P&L % annotation

### Holdings
- **Allocation by benchmark bucket** — treemap-style pie grouped by observation sector assignment
- **5-day trailing return** — from earliest snapshot in window
- **Total return vs cost** — unrealised P&L bars
- **P&L by stock** — open unrealised + closed realised (existing bar chart)
- **Price by holding** — `priceAud` lines (quantity-independent)

### Calendar & patterns
- **Upcoming earnings** — US symbols, next 90 days
- **Move heatmap** — snapshot-derived daily % grid; pattern hints below

### Metals
- **Gold book day move** — parallel to `## METALS & MINERALS` in Portfolio Note
- **XAU/AUD spot history** (7d+)
- **Metals drawdown** — same alert logic as shares

---

## Time range toggle

| `days` | Portfolio/symbol snapshots | Observation history |
|---|---|---|
| `1` | Intraday, since **local midnight in the workspace timezone** (was the database's UTC `CURRENT_DATE`, which made "Today" start around 10-11am in Sydney) | N/A for heatmap length |
| `7` / `30` / `90` | Daily last snapshot per calendar day | Up to window from `share_news_briefings`, but never further back than the retention setting (see "How far back observations go") |

Charts load when the **Charts** tab is opened (not on every Shares page load). **Refresh quotes** re-records snapshots and reloads chart data.

### Which charts follow the range (2026-09-30)

The range buttons used to change only a handful of charts (portfolio value, price by holding, relative performance, heatmap, gold spot); everything else is a point-in-time or fixed-window view, so it looked like the buttons did nothing. Now every chart is tagged either **Follows range** or **Current snapshot** (or a fixed window such as *Next 90 days*), and more of them follow the range:

| Chart | Today | 7d / 30d / 90d |
|---|---|---|
| Portfolio vs benchmarks | day move | return over the dates the Portfolio Notes cover (`benchmarksPeriod`). Your holdings: the units held today, from their first stored price on the first note date to today's price (`buildHoldingsValueSeries`, from `share_symbol_snapshots`), so the % and the A$ are one calculation. The tile is labelled "Change since <first note date>" and its sub-line adds "Against what you paid" (`benchmarksPeriod.unrealizedPnlAud`, the dashboard's `unrealizedPnlAud`, the Portfolio view's figure), added 2026-11-28 after the two were mistaken for each other. Indexes: the notes' daily moves compounded, skipping notes dated Sunday or Monday (no new session: the note runs at 7 am in the workspace time zone after the US close, so it carries the previous day's session). Holdings only, cash excluded; an index with no recorded moves is omitted, never shown as 0% |
| Movers & beat/lag | day % | each holding's move over the range (first stored snapshot in the window → current price) vs its sector index over the same range (`periodMovers`) |
| Trailing return | fixed 5 days | exactly the selected range (`trailingWindowDays`) |
| Portfolio value, price by holding, relative performance, gold spot history | follow the range (as before) | |
| Move heatmap | follows the range, capped at 14 days (a 90-column grid is unreadable), so 30d and 90d look the same | |
| Drawdown, allocation, total return vs cost, P&L by stock, gold book move, earnings, dividends | current snapshot / fixed | |

Dollar amounts (2026-10-02): the Movement charts show the AUD figure beside the %. Today = the holdings' day move in AUD (`portfolioMove.changeAud`) and each holding's `dayChangeAud`. For 7d/30d/90d = price change × the units held **today** (`changeAud` on `periodMovers`/`trailingReturns`); the portfolio figure is the same price-based calculation as its % (`buildHoldingsValueSeries`; `benchmarksPeriod.changeAudCoverage` says how many holdings had a stored price when not all did), and buys/sells inside the window are not adjusted for.

**Fix (2026-11-28): holdings % from stored prices, weekend repeats skipped.** The holdings % used to be the notes' daily `portfolioMove.changePct` compounded, while the A$ came from stored prices, and the two disagreed badly (production: −34.6% beside −A$19,474 on about A$210k). Notes are written every day, so a Saturday or Sunday note carried Friday's move again and it was compounded two or three times (nine repeated weekend days between 13 Oct and 27 Nov). The holdings % and the Relative performance holdings line now come from stored prices (`buildHoldingsValueSeries`), so the tile's % and A$ agree and the chart ends where the tile does; the index lines skip notes dated Sunday or Monday (`noNewSession`). **Follow-up the same day:** the first version skipped only exact repeats on Saturday and Sunday and read the note dates wrongly (`String(date).slice(0, 10)` on a pg Date gave "Wed Oct 14", so nothing matched and the tile still showed −34.60%). Production data showed Saturday carries the US Friday session and Sunday and Monday repeat it (Sunday sometimes re-measured slightly), so the rule is now by weekday; over 14 Oct to 28 Nov 2026 that turns Nasdaq −31.8% / SOX −55.2% into −13.8% / −27.9%. The rule assumes a workspace time zone ahead of New York. Tests in `sharesChartData.test.js`. The A$ now covers the same dates as the % (the note dates); before, on long ranges it reached back to the first stored price in the whole range. Index bars have no dollar figure.

Currency: the Nasdaq and SOX proxies (QQQ, SOXX) are **USD-priced** ETFs and STW is AUD; holdings are AUD. The benchmark charts say so rather than converting.

`history: { firstSnapshotAt, availableDays }` in the payload lets the UI say "only N days of history recorded" when the chosen range is longer than what exists.

### Ranges (2026-10-02)

`GET /api/shares/charts?range=today|7d|30d|90d|12m|fy|all` (the older `?days=1|7|30|90` still works; anything unrecognised falls back to `30d`). The response carries `range: { key, label, phrase, days, fromDate }` so the UI wording always matches the window used.

| Range | Window |
|---|---|
| `today` | since local midnight in the workspace timezone |
| `7d` / `30d` / `90d` | that many days back from now |
| `12m` | 365 days back from now |
| `fy` | **Australian financial year to date** — local midnight on 1 July (30 Jun–1 Jul is the boundary) to now; `days` counts both ends |
| `all` | everything recorded — from the first portfolio snapshot (`history.firstSnapshotAt`); observations only as far back as the retention setting keeps them |

Beyond 90 days (`12m`, `fy` once it passes 90 days, `all`) the per-holding price series is cut to **one point a day** (the last of each day) so the payload stays a sensible size. The trailing return and period movers/benchmarks use the same window; for `fy` and `all` the trailing window is pinned to the exact start (`loadTrailingMetrics(..., windowStart)`) rather than "N days ago". The heatmap stays capped at 14 days. When the chosen range is longer than what has been recorded, the UI says how many days exist. Tests: `node server/services/sharesChartData.test.js` (range logic).

### How far back observations go (2026-11-25)

Two kinds of stored data feed the charts, and only one is pruned:

- **Snapshots** (`share_symbol_snapshots`, `share_portfolio_snapshots`) and **index closes** (`share_benchmark_closes`) are never pruned, so portfolio value, price by holding and gold spot history can reach back to the first record.
- **Portfolio Note observations** (`share_news_briefings`, `type='observation'`) are deleted after the admin setting **Settings → Shares → Briefing and Portfolio Note History** (`shares_briefing_retention_days`, default 45, 7–730, read by `getBriefingRetentionDays()` in `sharesNewsService.js`; the same setting covers the daily briefings). Charts built from observations, mainly **Portfolio vs benchmarks** over a range (`benchmarksPeriod`), stop at that window, so with the default 45 days the 90d, 12m, FY and all ranges show at most 45 days of benchmark moves.

Raising the setting does not bring back deleted observations; the history grows from then on (90 days set today gives a full 90 days in about 45 days). Lowering it shortens these charts and the high-water-mark fallback in `portfolioAlerts.js`, which also reads stored observations.

### UI

**Redesign (2026-11-28, brief "Shares Charts tab redesign", milestone M1 of 4).** Every card is a `ChartCard` from the shared kit in `client/src/components/charts/` (see `client/DESIGN.md`, "Charts"): each panel is one column, two from `xl`, capped at 1700px; a wide card spans both. Each card has a one-line subtitle, and the long explanation that used to sit under the title is behind an (i) beside it, word for word. Only cards the range does not drive carry a badge (Current snapshot, Next 90 days, Max 14 days, All time, Last 5 days); a line above the range toggle says untagged cards follow the range. The range and cash toggles are `RangeToggle`/`SegmentedToggle` (active text in `--color-on-primary`, was `#fff`); sub-tabs use the shared `Tooltip`. Loading shows card-shaped `Skeleton`s; no payload shows an `EmptyState`. Colours come from the chart tokens (`--chart-*`); the existing chart components had their hex colours swapped for them (the P&L by stock chart inside `SharesPage.jsx` still has its own until M3 merges it). The metals drawdown now reads its triggers from `patternSummary.alertThresholds` (was hardcoded −10/−4; same values today). **M2 (2026-11-28):** Movement: Portfolio vs benchmarks is a row of `StatTile`s (your holdings filled, then each index with "You beat it by X pts" / "You lagged by X pts"; an index with no move is left out); Movers is `DivergingBars` with a dark tick at the sector index move (`sectorBenchmarkPct`, or the move minus `vsSectorPct`) and a beat/lag line; Drawdown (and Metals drawdown) is `ThresholdBars` with a dashed trigger line and an icon badge. **The badge comes from the server's `flag`** (`portfolioAlerts.js`), so it counts the 4% cost trigger as well as the peak and uses the server's 1-point near margin (the brief assumed 2), matching the alert emails. The trailing return shows on **Today only** (`cardsForRange`); over longer ranges it measured the same window as Movers, which its (i) says. Performance: Portfolio value is a Recharts area chart (`PortfolioValueChart.jsx`) with the latest value, the change over the range and unrealised P&L above it, and a Total / Holdings + cash toggle (holdings area plus a dashed cash line); Relative performance is a Recharts line chart (`RelativePerformanceChart.jsx`) with a dashed 100 line, a thicker portfolio line and each end value in the legend; Price by holding is a grid of tiles with change, last price and a `Sparkline`. `BenchmarkBarChart`, `DayMoversChart` and `DrawdownBars` were deleted. **M3 (2026-11-28):** Holdings: allocation is a `DonutChart` (holding count in the middle, each bucket's % and symbols in the legend); "Total return vs cost" and "P&L by stock" are one card, **Return by holding**, with a "% vs cost" (`holdingPnl`) / "A$ open + closed" toggle. The A$ rows are worked out in the tab (`pnlRows`) from the `positions` and `realized` the page already passed, so `SharesPage.jsx` no longer passes a chart component and its old `PortfolioPnlBarChart` (and `compactAud`) were deleted. Calendar & patterns: earnings are date chips grouped by week (filled within 7 days); the heatmap spans both columns and uses a scale from `--chart-loss` through the surface to `--chart-gain` (`heatCell`), a signed figure in every cell, a legend, and the `--chart-warn` outline; the pattern hints are a short list with icons (`trending-down` registered in the icon map). Metals: book move, spot move and unrealised are `StatTile`s; spot history is an `AreaTrend`; the drawdown reads its triggers from the payload (M2). Dividends: by holding as bars in `--chart-1`, by month as a `ColumnChart` with months along the bottom. `AllocationPie` and `MultiLineChart` were deleted. **M4 (2026-11-28):** the Shares tour (step 5), the "How Shares works" (i) box and the guide chat's Charts entry (`sharesTutor.js`) describe the six panels with the new card names: Return by holding (the merged card), the trailing return on Today only, and the drawdown badge counting both triggers. On a phone, bar rows put the label and figures on one line with the bar full width below. Look check: every sub-tab in all five themes at 1440 and 390 px (60 screenshots), with a check that no card is wider than its column or past the window edge; none were, and there were no console errors. The redesign is complete.

The Charts tab is split into sub-tabs: **Movement** · **Performance** · **Holdings** · **Calendar & patterns** · **Metals** (only with gold holdings) · **Dividends** (only once dividends exist). The charts dim and show "Updating…" while a new range loads, and only the newest request may update the page (a slow earlier response can't overwrite a newer click). Tests: `node server/services/sharesChartData.test.js`.

---

## Sector benchmark assignment

Same rules as `sharesNewsService.enrichHoldingsForObservation`:

| Holding | Benchmark proxy |
|---|---|
| ASX | STW (ASX 200) |
| Semi set (`NVDA`, `TSM`, `ASML`, …) | SOXX (SOX) |
| Other US | QQQ (Nasdaq) |

Env overrides: `OBS_INDEX_NASDAQ`, `OBS_INDEX_SOX`, `OBS_INDEX_ASX`.

---

## Related docs

- Portfolio Note pipeline: `docs/shares-portfolio-note.md`
- Quote providers: `docs/shares-api-research.md`
