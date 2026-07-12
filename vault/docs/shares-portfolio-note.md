# Shares — Portfolio Note & email reports

Daily and intraday email reports for the Shares portfolio. Implementation: `server/services/sharesNewsService.js` (Portfolio Note) and `server/cron/sharesCron.js` (hourly alert + cron registration).

---

## Email types

| Email | When | Recipient | Trigger |
|---|---|---|---|
| **Hourly portfolio update** | Top of each hour, 10:00–16:00 ET Mon–Fri (US session) | Admins | `checkDailyDropAlerts()` after each US poll |
| **Portfolio Note** | 7 AM workspace timezone daily | Portfolio owner | `generateObservation()` cron + manual |

Both use `server/utils/sendEmail.js` (MailChannels or SMTP).

---

## Hourly portfolio update (US session)

Runs after each NYSE/NASDAQ quote poll (`runSharesPoll(['NYSE','NASDAQ'])`).

**Purpose:** Intraday awareness of portfolio movement during the US session.

**Threshold:** Admin setting `shares_daily_drop_alert_pct` (Settings → Shares). When `0`, test mode — emails after every poll with the current day move. When `> 0`, emails only when the portfolio has dropped by at least that % vs previous close.

**Content (raw data tables only — no commentary or news):**
- **Shares:** portfolio summary (day % and $AUD change vs previous close; cash excluded) + per-holding table: Holding · Price · **% off Peak** · **% off Cost** · Day % · Day $AUD · Value · **Alert** — sorted by largest day mover
- **Gold & minerals:** same column layout for physical metal lots from `metal_purchases` (description as holding name). Day % uses XAU/AUD spot vs prior-day snapshot (`metal_spot_snapshots`).

**% off Peak / % off Cost:** `(current − reference) ÷ reference × 100`. Peak = rolling high-water mark since purchase, persisted in settings key `shares_high_water_marks` (updated every US poll; seeded from prior marks, snapshot peaks, and max buy price). Cost = average cost per share/oz.

**Alert column:** blank when clear; ⚠️ when within 1pp of either trigger (10% off peak · 4% off cost); 🔴 when either trigger is breached. Row background tinted to match flag.

**Code:** `buildHourlyHtml()` / `sendDropAlertEmail()` in `sharesCron.js`; alert math in `portfolioAlerts.js`. Spot recorded each US poll via `metalsPortfolio.recordSpotSnapshot()`.

---

## Portfolio Note (daily)

A structured analyst-style daily note emailed to the portfolio owner. Distinct from the per-stock **daily briefings** on the News tab (`type='daily'`) and the **monthly summary** (`type='monthly_summary`).

### Schedule

- **Cron:** 7 AM daily, workspace timezone (admin `user_timezone`, fallback `Australia/Sydney`)
- **Manual:** `POST /api/shares/news/observe`
- **On refresh:** `POST /api/shares/refresh` also triggers observation generation (fire-and-forget)

Runs after the 4 AM daily per-stock briefing cron and after the overnight US close.

### Storage

- Table: `share_news_briefings`
- `type='observation'`, one row per user per day (replaced on re-run)
- Pruned after 45 days
- `headlines` JSONB stores metadata: index %, `portfolioMove`, mover symbols, `aiUnavailable`

### Report structure

The email subject is `Portfolio note — YYYY-MM-DD`. Header shows benchmarks and book day move. **Alert status table** (pre-rendered, first) — per position: current price, peak HWM since purchase, % off peak, % off avg cost, flag (⚠️ within 1pp of trigger · 🔴 triggered). Triggers: 10% off peak · 4% off avg cost. High-water marks persist in observation `headlines` JSONB. The **Charts** tab visualises these metrics — see **`docs/shares-charts.md`**.

Narrative sections:

1. **CROSS-POSITION PATTERNS** — correlation/concentration, recurring unexplained movers, shared macro lag clusters (not single-stock anecdotes)
2. **MOVERS & CAUSALITY** — per-mover cause + beat/lag vs sector
3. **POSITION CHECK** — one line per non-mover
4. **SECTOR & MACRO CONTEXT**
5. **NEWS WORTH ACTING ON** — max 4 thesis-changing items
6. **RISK WATCH**
7. **UPCOMING CATALYSTS**
8. **DECISION TRIGGERS** — must state baseline (% off peak / avg cost / AUD)
9. **INTERNAL CONSISTENCY CHECK** — baseline and currency contradictions
10. **ONE-LINER**

**Metals & minerals (when `metal_purchases` exist):** full parallel analyst block under `## METALS & MINERALS` with ### subsections (TOP LINE through ONE-LINER). Gold spot day % from `metal_spot_snapshots` baseline; per-lot movers/position check; `METALS` news tag in LLM inputs. Email header adds Gold (XAU/AUD) benchmark and metals day-move chip.

Observations and decision framing only — not buy/sell advice.

### Pre-computed data (before LLM)

The service computes structured inputs so the model does not invent numbers:

- **Portfolio day move:** holdings value now vs previous close (`computePortfolioDayMovement`)
- **Per holding:** day %, day $AUD, weight %, total return %, sector benchmark, `vsSectorPct`, beat/lagged/matched
- **Movers list:** `selectMoversForReport()` — `|dayChangePct| ≥ 1%` **OR** `|vsSectorPct| ≥ 2` pp vs sector benchmark; else top 3 by max(|day %|, |divergence|). Each mover has `inclusionReason`.
- **Trailing metrics:** `loadTrailingHoldingMetrics()` — stock-only % from `share_symbol_snapshots` (~5d window). No trailing vs-sector. LLM may only cite `trailingPct` when `dataAvailable: true`.
- **Upcoming earnings:** `loadUpcomingEarnings()` — Finnhub calendar for US symbols (~90d window).
- **Alert status:** `portfolioAlerts.refreshHighWaterMarksAndAlerts()` — peak HWM in settings `shares_high_water_marks` (fallback: prior observation `headlines`), flags at 10% off peak / 4% off avg cost. Same module powers hourly email Alert column.
- **Pattern hints:** `buildPatternHints()` + `unexplainedMoveHistory` in `headlines` — cross-day unexplained move log.

### News inputs

- Per holding: Finnhub (US) or web search (ASX), up to 4 items each — `title`, `source`, `url`, `snippet`
- Macro: web search for rates/macro headlines (`symbol: 'MACRO'`)
- Semiconductors: web search for sector headlines (`symbol: 'SECTOR_SEMIS'`)

Relevance is enforced in prompts: only cite headlines primarily about the held company; max 4 in NEWS WORTH ACTING ON. Citations: `[Source Name, ≤8-word headline]`.

### Continuity (cross-day)

Prior day’s observation (`date < today`, `type='observation'`) is injected as `priorPortfolioNote` so **DECISION TRIGGERS** carry forward until fired or explicitly revised, and disclosed facts stay consistent across days.

### LLM pipeline

Three passes (`getModelsForUser` tiers — no hardcoded model ids):

1. **Draft** — primary (`standard` tier), `maxTokens: 4200`, feature `shares_observation`
2. **Review** — secondary (different tier: gemini/light/deepseek), `maxTokens: 4500`, feature `shares_observation_review`
3. **Final** — primary again, `maxTokens: 4200`, feature `shares_observation_final`

Stages 2–3 are fail-open. If stage 1 fails, a deterministic data-only fallback note is emailed (`buildFallbackReport`), with `aiUnavailable: true`.

### Market index proxies

Raw indices are not available on free quote APIs. Liquid ETF proxies:

| Label | Default proxy | Exchange | Env override |
|---|---|---|---|
| Nasdaq | QQQ | NASDAQ | `OBS_INDEX_NASDAQ` |
| SOX | SOXX | NASDAQ | `OBS_INDEX_SOX` |
| ASX 200 | STW | ASX | `OBS_INDEX_ASX` |

When a proxy cannot be fetched, the email shows “—” and the model is instructed not to guess.

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/shares/news/observation` | Latest stored note |
| `POST` | `/api/shares/news/observe` | Generate today’s note + email |

Observations are excluded from `getBriefingsForUser()` (News tab daily/monthly feed).

### Key functions

| Function | File |
|---|---|
| `generateObservation(userId)` | `sharesNewsService.js` |
| `buildMetalsDashboard(userId)` | `metalsPortfolio.js` |
| `observationHtml()` | `sharesNewsService.js` |
| `enrichHoldingsForObservation()` | `sharesNewsService.js` |
| `startSharesCron()` | `sharesCron.js` |
| `checkDailyDropAlerts()` | `sharesCron.js` |
