# Finance Compliance Advisory (admin only)

Finance → **Compliance** is an admin-only, in-app note that watches the same fixed list of Australian Taxation Office pages as Shares, and says what may need a fresh look in personal and small-business finance records. It runs once a month and can be forced with **Check now**. It is **general information only, not tax or legal advice**; every report tells the person to check the linked ATO page and their accountant before acting.

Finance has its **own** report history, source snapshots, usage feature and spend cap. Nothing is shared with the Shares Compliance Advisory except the safe fetching code and the seven-page ATO allow-list.

## What it does

1. Reads a fixed allow-list of seven ATO pages (source registry: `server/services/financeCompliance/sources.js`, backed by `server/services/complianceAdvisory/sources.js`). No URL typed by a person, taken from a model answer or found in scraped text is ever fetched. The final URL after redirects is checked again against the two allowed hosts (`www.ato.gov.au`, `ato.gov.au`).
2. Checks robots.txt for our honest `CuramVault/1.0` agent, honours Crawl-delay, spaces requests at least two seconds apart, fetches through `utils/safeFetch` (public addresses only, pinned DNS, 15 s timeout, 2 MB cap) and keeps only a title, a 1,200-character excerpt and a SHA-256 hash per page. At most ten pages are read.
3. Defangs the page text (`&`, `<`, `>`, quotes and instruction-like phrases escaped or rewritten; links removed) before giving short excerpts to the configured **standard** text model from Settings → Models. No model id is hardcoded. The scraped text is data, never instructions.
4. Saves a JSON report plus one canonical Markdown file, with a SHA-256 content hash. The PDF is rendered from that same Markdown, so the screen, copy and PDF cannot drift. Each source snapshot keeps its URL, fetched-at time, hash, status and short excerpt.
5. Keeps one report per admin. Each admin sees and deletes only their own Finance history. A deleted report goes to the shared recycle bin for 30 days and can be restored with Undo or Settings → Recycle bin.

A page blocked by robots, refused (the ATO often returns 403), redirected off-list or empty is kept as a `source unavailable — verify manually` snapshot. A model failure, a missing model or a cap refusal produces a partial report with the sources still visible. Nothing is guessed from memory: the tool has no hardcoded ATO rate, date, threshold or tax rule.

## Schedule and cost

- Cron: `0 7 2 * *` in the workspace timezone (`user_timezone` from the first admin, falling back to `Australia/Sydney`). It runs inline under `withCronLock('finance-compliance', …)`, a separate lock from Shares, so a rolling deploy cannot make two reports. `DISABLE_EXTERNAL_CRON` disables it with the other external jobs.
- Force: `POST /api/finance/compliance/reports` is behind `aiLimiter`, a one-run-at-a-time guard and a monthly spend cap. It saves a `running` row and answers `202`; the tab polls `GET /reports/:id` until it is done.
- Spend: usage is logged as feature `finance_compliance_report`. `FINANCE_COMPLIANCE_MAX_COST_USD` (default `1`) is the monthly cap, `FINANCE_COMPLIANCE_ESTIMATED_COST_USD` (default `0.05`) is the pre-flight estimate. A bad number falls back to the default; `0` means spend nothing. These are separate from the Shares env vars.

## API

All routes require the `finance` feature **and** admin, and are classified `admin` in `server/testing/routeManifest.json`.

| Route | Purpose |
|---|---|
| `GET /api/finance/compliance/reports` | newest 100 saved Finance reports for this admin |
| `POST /api/finance/compliance/reports` | force a run; ignores the body; `202` with the running row |
| `GET /api/finance/compliance/reports/:id` | one report with its source snapshots |
| `DELETE /api/finance/compliance/reports/:id` | move the report and snapshots to the recycle bin |
| `GET /api/finance/compliance/reports/:id/markdown` | the canonical Markdown (`{ markdown }`) |
| `GET /api/finance/compliance/reports/:id/pdf` | PDF generated from that Markdown |

## Files

The behaviour lives in one shared core (`server/services/complianceAdvisory/`) so Shares and Finance cannot drift. Thin wrappers give each app its own config, API mount, cron, tables, guide and UI.

| Piece | File |
|---|---|
| shared config (tables, feature, env, cron lock) | `server/services/complianceAdvisory/config.js` |
| shared fixed ATO allow-list | `server/services/complianceAdvisory/sources.js` |
| polite SSRF-safe fetch + snapshots | `server/services/complianceAdvisory/fetchSources.js` |
| defanging, system prompt, JSON parse | `server/services/complianceAdvisory/prompt.js` |
| report object + Markdown | `server/services/complianceAdvisory/report.js` |
| PDF from Markdown | `server/services/complianceAdvisory/pdf.js` |
| orchestration, storage, delete | `server/services/complianceAdvisory/service.js` |
| monthly spend cap | `server/services/complianceAdvisory/spend.js` |
| admin API + cron factories | `server/services/complianceAdvisory/routes.js`, `cron.js` |
| Finance wrapper modules | `server/services/financeCompliance/` |
| admin API | `server/routes/financeCompliance.js` |
| cron | `server/cron/financeComplianceCron.js` |
| tables | `server/db.js` (`finance_compliance_reports`, `finance_compliance_sources`) |
| recycle-bin restore | `server/services/recycleBin/adapters/financeCompliance.js` |
| tab UI | `client/src/components/finance/FinanceComplianceTab.jsx` |
| guide and tour parity | `server/services/financeTutor.js`, `client/src/utils/tours/financeTour.js` |

Tests: `npm run test:finance-compliance` (no network, no model, no database) and `npm run test:finance-tutor` (tab/guide parity).

## Why the source text is untrusted

Anything on a public web page can contain words that look like instructions. The scraped text is never a prompt of its own: it is escaped, wrapped in a labelled page block, and the system prompt tells the model it is data. Links in the report come only from our own registry, never from the model or the page. That keeps a hostile or merely careless page from changing what the tool does, and makes every claim traceable to an ATO link.
