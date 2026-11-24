# Shares Compliance Advisory (admin only)

Shares → **Compliance** is an admin-only, in-app note that watches a fixed list of Australian Taxation Office pages and says what may need a fresh look in a personal share portfolio. It runs once a month and can be forced with **Check now**. It is **general information only, not tax or legal advice**; every report tells the person to check the linked ATO page and their accountant before acting.

## What it does

1. Reads a fixed allow-list of seven ATO pages (source registry: `server/services/sharesCompliance/sources.js`). No URL typed by a person, taken from a model answer or found in scraped text is ever fetched. The final URL after redirects is checked again against the two allowed hosts (`www.ato.gov.au`, `ato.gov.au`).
2. Checks robots.txt for our honest `CuramVault/1.0` agent, honours Crawl-delay, spaces requests at least two seconds apart, fetches through `utils/safeFetch` (public addresses only, pinned DNS, 15 s timeout, 2 MB cap) and keeps only a title, a 1,200-character excerpt and a SHA-256 hash per page.
3. Defangs the page text (`&`, `<`, `>`, quotes and instruction-like phrases escaped or rewritten; links removed) before giving short excerpts to the configured **standard** text model from Settings → Models. No model id is hardcoded.
4. Saves a JSON report plus one canonical Markdown file, with a SHA-256 content hash. The PDF is rendered from that same Markdown, so the screen, copy and PDF cannot drift.
5. Keeps one report per admin. Each admin sees and deletes only their own history. A deleted report goes to the shared recycle bin for 30 days and can be restored with Undo or Settings → Recycle bin.

A page blocked by robots, refused (the ATO often returns 403), redirected off-list or empty is kept as a `source unavailable — verify manually` snapshot. A model failure, a missing model or a cap refusal produces a partial report with the sources still visible. Nothing is guessed from memory: the tool has no hardcoded ATO rate, date, threshold or tax rule.

## Schedule and cost

- Cron: `0 7 2 * *` in the workspace timezone (`user_timezone` from the first admin, falling back to `Australia/Sydney`). It runs inline under `withCronLock('shares-compliance', …)`, so a rolling deploy cannot make two reports. `DISABLE_EXTERNAL_CRON` disables it with the other external jobs.
- Force: `POST /api/shares/compliance/reports` is behind `aiLimiter`, a one-run-at-a-time guard and a monthly spend cap. It saves a `running` row and answers `202`; the tab polls `GET /reports/:id` until it is done.
- Spend: usage is logged as feature `shares_compliance_report`. `SHARES_COMPLIANCE_MAX_COST_USD` (default `1`) is the monthly cap, `SHARES_COMPLIANCE_ESTIMATED_COST_USD` (default `0.05`) is the pre-flight estimate. A bad number falls back to the default; `0` means spend nothing.

## API

All routes require the `shares` feature **and** admin, and are classified `admin` in `server/testing/routeManifest.json`.

| Route | Purpose |
|---|---|
| `GET /api/shares/compliance/reports` | newest 100 saved reports for this admin |
| `POST /api/shares/compliance/reports` | force a run; ignores the body; `202` with the running row |
| `GET /api/shares/compliance/reports/:id` | one report with its source snapshots |
| `DELETE /api/shares/compliance/reports/:id` | move the report and snapshots to the recycle bin |
| `GET /api/shares/compliance/reports/:id/markdown` | the canonical Markdown (`{ markdown }`) |
| `GET /api/shares/compliance/reports/:id/pdf` | PDF generated from that Markdown |

## Files

| Piece | File |
|---|---|
| fixed ATO allow-list | `server/services/sharesCompliance/sources.js` |
| polite SSRF-safe fetch + snapshots | `server/services/sharesCompliance/fetchSources.js` |
| defanging, system prompt, JSON parse | `server/services/sharesCompliance/prompt.js` |
| report object + Markdown | `server/services/sharesCompliance/report.js` |
| PDF from Markdown | `server/services/sharesCompliance/pdf.js` |
| orchestration, storage, delete | `server/services/sharesCompliance/service.js` |
| monthly spend cap | `server/services/sharesCompliance/spend.js` |
| admin API | `server/routes/sharesCompliance.js` |
| cron | `server/cron/sharesComplianceCron.js` |
| tables | `server/db.js` (`shares_compliance_reports`, `shares_compliance_sources`) |
| recycle-bin restore | `server/services/recycleBin/adapters/sharesCompliance.js` |
| tab UI | `client/src/components/shares/SharesComplianceTab.jsx` |
| guide and tour parity | `server/services/sharesTutor.js`, `client/src/utils/tours/sharesTour.js` |

Tests: `npm run test:shares-compliance` (no network, no model, no database) and `npm run test:shares-tutor` (tab/guide parity).

## Why the source text is untrusted

Anything on a public web page can contain words that look like instructions. The scraped text is never a prompt of its own: it is escaped, wrapped in a labelled page block, and the system prompt tells the model it is data. Links in the report come only from our own registry, never from the model or the page. That keeps a hostile or merely careless page from changing what the tool does, and makes every claim traceable to an ATO link.
