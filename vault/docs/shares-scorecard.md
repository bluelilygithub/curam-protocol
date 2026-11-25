# Shares signal scorecard

Shares → Thesis → **Track record** card. Built 2026-11-25 as the "signal scorecard" in roadmap step 10. The idea is the reflection memory in TradingAgents (arXiv 2412.20138, Apache-2.0): keep each call, see how it turned out, feed that back. Rewritten for Vault; nothing copied.

## What it records

One row per call in `share_signal_calls` (unique per user, source, symbol, exchange, day; a rerun the same day replaces the row and resets its scores):

- **`briefing`**: the 4 AM news briefing's per-holding signal when it is `bullish` or `bearish` (`watch`/`neutral` have no direction). Recorded at the end of `generateDailyBriefing`. Briefing rows are pruned after the Settings → Shares retention (45 days by default); these are not.
- **`thesis`**: a thesis check verdict, `concern` (weakening, impaired, broken, red line) or `intact`. `unclear` is not a call. Recorded at the end of `runCheck`.

Each row keeps the AUD price at the time (the dashboard price) and the close of the holding's index (`sectorBenchmarkFor`: STW for ASX, SOXX for chip names, else QQQ, from `share_benchmark_closes`).

## How it scores

`scoreDue(userId, today)` runs per user right after the 4 AM briefing (`sharesCron.js`, inside the existing `shares-news` lock). For each call whose 30- or 90-day mark has passed, it reads the first `share_symbol_snapshots` price within 7 days of the mark and the index close on or before it. Database only, no paid API calls.

- **Right** = bullish or intact beat the index; bearish or concern lagged it. No index price → the plain return is used.
- No snapshot 10 days after the mark (usually because the share was sold) → `no-price`, left out of the counts.
- A suggestion (`sharesScorecard`, once a month) when news signals are right under 40% of the time over 20+ scored calls.

## Where it is used

- `GET /api/shares/thesis/scorecard` → groups by source and call: count, right/scored and average edge vs the index, per horizon.
- The thesis check prompt gets a TRACK RECORD block (this holding and all holdings). Rule 10 says it is calibration, not evidence: it may change how confidently the check words things, and the feedback says when the record is mostly right or wrong, but it can never move a rating. Under 5 scored calls the check says the record is too small.

## Where things are

`server/services/sharesSignalScorecard.js` (`recordCall`, `scoreDue`, `summarise`, `formatTrackRecord`, `judge`, `thesisCall`), table in `server/db.js`, card in `client/src/components/shares/SharesThesisTab.jsx`, guide text in the `thesis` entry of `sharesTutor.js`.

## Tests

`node server/services/sharesSignalScorecard.test.js` (pure: call mapping, right/wrong, summary, prompt block). The SQL in `recordCall`/`scoreDue` has **not** been run against a database yet.

## Not built

Scoring sold shares (needs a historical quote); lessons pulled by similarity (pgvector) instead of plain counts; feeding the record into the daily briefing itself; a per-holding breakdown on the card.
