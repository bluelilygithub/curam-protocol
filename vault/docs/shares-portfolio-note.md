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
- Portfolio summary: day % and $AUD change (holdings vs previous close; cash excluded)
- Per-holding table: symbol, exchange, price, day %, day $AUD, position value — sorted by largest mover

**Code:** `buildHourlyHtml()` / `sendDropAlertEmail()` in `sharesCron.js`.

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
2. **MOVERS & CAUSALITY** — holdings that moved >1% (or top 3 if none crossed); each line: move vs sector benchmark → beat/lagged/matched, cause with inline citation or “no identified catalyst, beta move”, thesis impact (reinforces / weakens / neutral)
3. **SECTOR & MACRO CONTEXT** — sector-wide drivers; explicit split of portfolio move explained by sector beta vs stock-specific news
4. **NEWS WORTH ACTING ON** — max 4 items that could change position size or thesis; inline `(Source: "headline")`
5. **RISK WATCH** — background risks not fully in today’s price
6. **DECISION TRIGGERS** — falsifiable conditions (price levels, dates, events); no vague “monitor closely”
7. **ONE-LINER** — book value, position count, how the day went

Observations and decision framing only — not buy/sell advice.

### Pre-computed data (before LLM)

The service computes structured inputs so the model does not invent numbers:

- **Portfolio day move:** holdings value now vs previous close (`computePortfolioDayMovement`)
- **Per holding:** day %, day $AUD, weight %, total return %
- **Sector benchmark:** SOX for semiconductor symbols (TSM, NVDA, ASML, etc.), Nasdaq for other US names, ASX 200 proxy for ASX — with `sectorBenchmarkPct`, `vsSectorPct`, `relativeToSector` (beat/lagged/matched)
- **Movers list:** `selectMoversForReport()` — >1% movers, else top 3 by absolute move

### News inputs

- Per holding: Finnhub (US) or web search (ASX), up to 4 headlines each
- Macro: web search for rates/macro headlines (`symbol: 'MACRO'`)
- Semiconductors: web search for sector headlines (`symbol: 'SECTOR_SEMIS'`)

Relevance is enforced in prompts: only cite headlines primarily about the held company; max 4 in NEWS WORTH ACTING ON.

### LLM pipeline

Three passes (`getModelsForUser` tiers — no hardcoded model ids):

1. **Draft** — primary (`standard` tier), `maxTokens: 3500`, feature `shares_observation`
2. **Review** — secondary (different tier: gemini/light/deepseek), `maxTokens: 3800`, feature `shares_observation_review`
3. **Final** — primary again, `maxTokens: 3500`, feature `shares_observation_final`

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
| `observationHtml()` | `sharesNewsService.js` |
| `enrichHoldingsForObservation()` | `sharesNewsService.js` |
| `startSharesCron()` | `sharesCron.js` |
| `checkDailyDropAlerts()` | `sharesCron.js` |
