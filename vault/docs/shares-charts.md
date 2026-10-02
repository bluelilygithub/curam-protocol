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
| `7` / `30` / `90` | Daily last snapshot per calendar day | Up to window from `share_news_briefings` |

Charts load when the **Charts** tab is opened (not on every Shares page load). **Refresh quotes** re-records snapshots and reloads chart data.

### Which charts follow the range (2026-09-30)

The range buttons used to change only a handful of charts (portfolio value, price by holding, relative performance, heatmap, gold spot); everything else is a point-in-time or fixed-window view, so it looked like the buttons did nothing. Now every chart is tagged either **Follows range** or **Current snapshot** (or a fixed window such as *Next 90 days*), and more of them follow the range:

| Chart | Today | 7d / 30d / 90d |
|---|---|---|
| Portfolio vs benchmarks | day move | return over the range from the daily Portfolio Note observations (`benchmarksPeriod`) — holdings only, cash excluded; an index with no recorded moves is omitted, never shown as 0% |
| Movers & beat/lag | day % | each holding's move over the range (first stored snapshot in the window → current price) vs its sector index over the same range (`periodMovers`) |
| Trailing return | fixed 5 days | exactly the selected range (`trailingWindowDays`) |
| Portfolio value, price by holding, relative performance, gold spot history | follow the range (as before) | |
| Move heatmap | follows the range, capped at 14 days (a 90-column grid is unreadable), so 30d and 90d look the same | |
| Drawdown, allocation, total return vs cost, P&L by stock, gold book move, earnings, dividends | current snapshot / fixed | |

Dollar amounts (2026-10-02): the Movement charts show the AUD figure beside the %. Today = the holdings' day move in AUD (`portfolioMove.changeAud`) and each holding's `dayChangeAud`. For 7d/30d/90d = price change × the units held **today** (`changeAud` on `periodMovers`/`trailingReturns`); the portfolio line is the sum of the holdings that have a stored price in the window (`benchmarksPeriod.changeAudCoverage` says how many), and buys/sells inside the window are not adjusted for. Index bars have no dollar figure.

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
| `all` | everything recorded — from the first portfolio snapshot (`history.firstSnapshotAt`); observations from the start |

Beyond 90 days (`12m`, `fy` once it passes 90 days, `all`) the per-holding price series is cut to **one point a day** (the last of each day) so the payload stays a sensible size. The trailing return and period movers/benchmarks use the same window; for `fy` and `all` the trailing window is pinned to the exact start (`loadTrailingMetrics(..., windowStart)`) rather than "N days ago". The heatmap stays capped at 14 days. When the chosen range is longer than what has been recorded, the UI says how many days exist. Tests: `node server/services/sharesChartData.test.js` (range logic).

### UI

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
