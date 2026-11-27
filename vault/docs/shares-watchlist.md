# Shares watchlist

Shares → **Watchlist**. Built 2026-11-27, part of roadmap step 10 ("watchlist"). Companies the owner is looking at but does not hold, each with dated AI research reports. The owner's example was a long CrowdStrike report: business, moat, financial quality, valuation, forward expectations, acquisition risk, competitive threats, bear/base/bull cases, what would change the view, position sizing.

## Decisions (owner, 2026-11-27)

- **The never-advice rule stays.** Reports cover everything in the example except a verdict ("watch / size carefully") and the position-sizing section. They may quote price targets and fair values published by others, attributed and cited, but never give their own.
- **Investor profile in Settings → Shares** (horizon, fall they can sit through, goals, things to avoid), stored per user as the setting `shares_investor_profile` (JSON text, saved through the normal `POST /api/settings`). The report also reads current holdings and weights.
- **Add by ticker, then research.** Ticker + exchange (NASDAQ, NYSE, ASX), optional company name and note. "Research" writes a dated report; "Research again" writes another that says what changed. "Write a thesis" opens the Thesis tab for that company (the existing thesis if there is one).

- **Analyst consensus and fit (owner, 2026-11-28).** The owner asked for a buy/hold/sell recommendation collated from at least five sources like Morningstar, a summary of the aggregated opinion, a final summary arguing whether the company fits their portfolio, and Copy / Download. This loosens the never-advice rule in one place only: the "Analyst consensus" section reports the ratings named sources published, maps each to Buy / Hold / Sell, and gives their majority as "Consensus of the sources". Vault still gives no rating, size or price of its own. The last section argues fit and ends "Fit with your profile: Fits / Partly fits / Does not fit".

## How a report is made

`runResearch` in `server/services/sharesWatchlist.js`: ten web searches in parallel (business, results/guidance, analyst consensus, moat/risks, this month's news, and five rating-site searches: Morningstar, MarketBeat, Simply Wall St, plus Zacks and TipRanks for US or Market Index and MarketScreener for ASX; the same `webSearch` and provider settings as the news briefings), the live quote, Finnhub `/stock/metric` figures (US only, `getFundamentals`), the dashboard (holdings and weights), the profile and the previous report. One call to the `standard` model (max 8000 output tokens), usage feature `shares_watchlist_research` (in the judgement list in `usageInsights.js`). The markdown, the numbered sources and the price at the time are saved in `share_research_reports`.

Prompt rules (`SYSTEM_PROMPT`, tested): no buy/sell/hold/size words or ratings in Vault's own voice (the consensus section reports others' ratings), no price predictions, every number from the pack with a `[n]` citation or "not found", general-knowledge sentences marked "(background)", web snippets treated as untrusted. The sections are fixed (Summary, What the company sells, moat table, financial quality, valuation, key risks, bear/base/bull table, what would change the view, bottom line, analyst consensus table + bold consensus line + aggregated summary, final summary on fit with a bold Fits / Partly fits / Does not fit line). The consensus count is done by the model from its own table, not checked in code. Copy and Download (client only) give the heading, report, numbered sources and disclaimer as one Markdown document; Download saves `<SYMBOL>-<EXCHANGE>-research-<date>.md`. Unlike the Thesis check, nothing is enforced in code after the reply: the screen carries the disclaimer.

## Quotes

`listWatchlist` shows a quote per company, cached in memory 15 minutes for US shares and 6 hours for ASX, because ASX quotes come from Alpha Vantage (25 a day, shared with holdings). A failed quote shows "—".

## Where things are

- `server/services/sharesWatchlist.js` (+ `sharesWatchlist.test.js`, run `node server/services/sharesWatchlist.test.js`)
- `server/routes/sharesWatchlist.js` at `/api/shares/watchlist`: `GET /`, `POST /`, `PUT /:id` (name, note), `GET /:id/reports`, `POST /:id/research` (AI rate limiter), `DELETE /:id`. Registered before `/api/shares`, behind `requireFeature('shares')`. All in `server/testing/routeManifest.json`.
- Tables `share_watchlist` (unique per user, symbol, exchange) and `share_research_reports` (cascade) in `server/db.js`.
- Delete goes to the recycle bin with the reports (`recycleBin/adapters/sharesWatchlist.js`, type `share-watch`); restore refuses if the ticker was added again since.
- `client/src/components/shares/SharesWatchlistTab.jsx`; the profile fields are in the Shares block of `SettingsPage.jsx`. Guide chat: `watchlist` entry in `CATALOG` in `server/services/sharesTutor.js`; the "How Shares works" box has a paragraph.

## Verified and not verified

Run locally on 2026-11-27: add, duplicate and bad-exchange errors, list, edit note, reports list, delete to the bin and restore with the report and its sources; the tab, the "Write a thesis" handoff and the Settings profile render in a browser with no console errors. **Not run:** a live report. The local Anthropic key is invalid and there is no search or Finnhub key locally, so the first real report on production is the first test of the prompt, the citations and the length (a long report may take one to two minutes).

## Not built

No tour step (the Shares tour still has 10 steps). No scheduled re-research. No company-name lookup from the ticker (the name is typed). No ASX fundamentals (same limit as Thesis). No price alerts on watched companies.
