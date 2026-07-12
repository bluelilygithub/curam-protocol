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
| `1` | Intraday (`CURRENT_DATE`) | N/A for heatmap length |
| `7` / `30` / `90` | Daily last snapshot per calendar day | Up to window from `share_news_briefings` |

Charts load when the **Charts** tab is opened (not on every Shares page load). **Refresh quotes** re-records snapshots and reloads chart data.

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
