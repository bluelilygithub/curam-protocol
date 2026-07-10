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

**Content:**
- **Shares:** portfolio summary (day % and $AUD change vs previous close; cash excluded) + per-holding table (symbol, exchange, price, day %, day $AUD, position value) — sorted by largest mover
- **Gold & minerals:** same layout for physical metal lots from `metal_purchases` (description, SPOT, $/oz, day %, day $AUD, value). Day % uses XAU/AUD spot vs prior-day snapshot (`metal_spot_snapshots`).

**Code:** `buildHourlyHtml()` / `sendDropAlertEmail()` in `sharesCron.js`. Spot recorded each US poll via `metalsPortfolio.recordSpotSnapshot()`.

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

The email subject is `Portfolio note — YYYY-MM-DD`. Header shows benchmarks and book day move. Body sections:

1. **TOP LINE** — 2–3 sentences: the single most important thing for the portfolio today
2. **MOVERS & CAUSALITY** — holdings with |day %| ≥ 1 **or** |vs sector| ≥ 2pp; each line: move vs sector benchmark → beat/lagged/matched, cause with inline `[Source, ≤8-word headline]` or “no company-specific catalyst; beta not alpha”, thesis (reinforces / weakens / neutral)
3. **POSITION CHECK** — one line per holding *not* in movers (complete audit trail; rule 12)
4. **SECTOR & MACRO CONTEXT** — sector-wide drivers; explicit split of portfolio move explained by sector beta vs stock-specific news
5. **NEWS WORTH ACTING ON** — max 4 items that could change position size or thesis; extract claims from snippets, not headline reposts
6. **RISK WATCH** — background risks not fully in today’s price; rule 13: one-day moves are observations not patterns; no invented catalysts
7. **DECISION TRIGGERS** — falsifiable tripwires; **carry forward** from prior day’s note verbatim unless explicitly revised (continuity rules 9–12)
8. **ONE-LINER** — book value, position count, how the day went

**Metals & minerals (when `metal_purchases` exist):** full parallel analyst block under `## METALS & MINERALS` with ### subsections (TOP LINE through ONE-LINER). Gold spot day % from `metal_spot_snapshots` baseline; per-lot movers/position check; `METALS` news tag in LLM inputs. Email header adds Gold (XAU/AUD) benchmark and metals day-move chip.

Observations and decision framing only — not buy/sell advice.

### Pre-computed data (before LLM)

The service computes structured inputs so the model does not invent numbers:

- **Portfolio day move:** holdings value now vs previous close (`computePortfolioDayMovement`)
- **Per holding:** day %, day $AUD, weight %, total return %, sector benchmark, `vsSectorPct`, beat/lagged/matched
- **Movers list:** `selectMoversForReport()` — `|dayChangePct| ≥ 1%` **OR** `|vsSectorPct| ≥ 2` pp vs sector benchmark; else top 3 by max(|day %|, |divergence|). Each mover has `inclusionReason`.
- **Trailing metrics:** `loadTrailingHoldingMetrics()` — stock-only % from `share_symbol_snapshots` (~5d window). No trailing vs-sector. LLM may only cite `trailingPct` when `dataAvailable: true`.

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
