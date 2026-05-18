# Shares — Market Data API Research

History of providers trialled for the Shares module and why each was rejected or adopted. The core challenge: Railway uses shared datacenter IPs that many financial data providers actively block or rate-limit for server-side requests.

---

## Final stack (current)

| Exchange | Provider | Key env var | Free tier |
|---|---|---|---|
| NYSE / NASDAQ | **Finnhub** | `FINNHUB_API_KEY` | 60 req/min, no IP block on Railway |
| ASX | **Alpha Vantage** | `ALPHA_VANTAGE_API_KEY` | 25 req/day — see conservation notes below |
| USD → AUD FX | **Frankfurter** | none (no key) | No rate limit, open API |

**Alpha Vantage conservation:** ASX cron polls twice per day (5 AM + 1 PM Sydney) using `['ASX']` exchange filter. A 15-minute in-memory quote cache (`quoteCache` Map in `sharesPortfolio.js`) prevents redundant calls during user page loads. With fewer than 10 ASX holdings, this stays well under the 25 req/day cap.

---

## Providers trialled and rejected

### 1. Finnhub (initial — for all exchanges)

**What we tried:** Used Finnhub for both US and ASX quotes via `GET /api/v1/quote?symbol=...`.

**Outcome:** ASX symbols are not supported on the free tier — Finnhub returned `403 Forbidden` for any `XXX.AX` ticker. Finnhub was subsequently removed entirely, then reintroduced for US-only after confirming it works from Railway for NYSE/NASDAQ.

**Kept for:** NYSE/NASDAQ quotes + company news (`GET /api/v1/company-news`).

---

### 2. Yahoo Finance — direct HTTP (Chart API)

**What we tried:** Direct calls to `https://query1.finance.yahoo.com/v8/finance/chart/BHP.AX` and US tickers, with browser-mimic headers including `User-Agent`, `Accept-Language`, `Origin: https://finance.yahoo.com`, and `Referer`.

**Outcome:** Failed from Railway with `fetch failed` (connection reset / TLS rejection). Worked locally but not from Railway's datacenter IPs. Yahoo Finance actively blocks all known hosting provider IP ranges. Adding `Origin` and `Referer` headers resolved it in local testing only.

---

### 3. yahoo-finance2 npm package

**What we tried:** `require('yahoo-finance2')` as a Node package that handles Yahoo auth via cookies/headers internally.

**Outcome:** `ERR_PACKAGE_PATH_NOT_EXPORTED` on the `require` call (ESM-only package). Adapted to dynamic `import()` but still failed on Railway with the same underlying IP block as direct HTTP. Abandoned.

---

### 4. Stooq (CSV endpoint)

**What we tried:** `https://stooq.com/q/d/l/?s=bhp.au&i=d` — no key required, returns CSV. ASX tickers use `.au` suffix.

**Outcome:** Returned "No Stooq close for coh.au" — the CSV response was empty or contained only headers. Stooq appears to silently deny server requests or requires a paid account for reliable data. No official documentation.

---

### 5. Twelve Data

**What we tried:** `https://api.twelvedata.com/price?symbol=BHP/AUD&exchange=ASX&apikey=...` after obtaining a free-tier API key (`TWELVE_DATA_API_KEY`).

**Outcome:** US stocks (TSM, GOOG) returned quotes correctly. ASX stocks returned:

> "This symbol is available starting with the Pro or Venture plan. Consider upgrading now at https://twelvedata.com/pricing"

International/ASX coverage is a paid-only feature on Twelve Data. The `TWELVE_DATA_API_KEY` env var can be removed from Railway; it is no longer used.

---

### 6. Alpha Vantage (ASX trial)

**What we tried:** `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=COH.AX&apikey=...` using the `.AX` suffix convention for ASX tickers.

**Outcome:** Returned an empty JSON object `{}` — no error, no quote. Alpha Vantage's free tier (`ALPHA_VANTAGE_API_KEY`) **does not include international stocks** (including ASX). The free tier covers US stocks only. The paid "Premium" plan adds international coverage.

Despite this, Alpha Vantage was kept as the ASX provider with the understanding that it may not return data. The code handles empty responses gracefully (quote warning logged, `—` shown in the UI). When/if the user upgrades to Alpha Vantage Premium, ASX quotes will start flowing without any code changes.

---

## Options not yet trialled

These were identified as potential alternatives if the current Alpha Vantage free-tier limitation becomes blocking:

- **QuoteAPI** (`quoteapi.com`) — ASX/CHIX/NZX specific, no deployment-environment restrictions. May have a free dev tier.
- **OpenBB** (self-hosted) — open-source financial middleware. Could be deployed as a Railway sidecar service to act as a quota-free proxy.
- **FinMCP** (GitHub: Steve-sy/finmcp) — uses `yahoo-finance2` with session-cookie handling that reportedly bypasses Railway IP blocks. Not tested.

---

## Key learnings

1. **IP reputation is the primary barrier.** Yahoo, Finnhub (international), and initially Twelve Data all respond differently to Railway IPs than to residential or cloud IPs with good reputation. There is no header-level workaround for providers that block at the IP level.

2. **API-key-bound providers are more reliable server-side** than cookie/session-based scrapers. Alpha Vantage and Finnhub authenticate by key, not by IP reputation.

3. **Free tiers for international data are rare.** Almost every provider gates non-US exchange data behind paid plans. Alpha Vantage is the closest thing to a free ASX option, though its free tier is technically US-only.

4. **Conservative polling + caching is essential** with tight free-tier limits. The 25 req/day Alpha Vantage cap with a 2×/day cron and 15-minute UI cache should remain sustainable for up to ~12 ASX holdings indefinitely.
