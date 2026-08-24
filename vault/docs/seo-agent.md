# SEO agent

Simple on-page SEO audit at **`/seo`**. Paste a public URL. Vault fetches the homepage HTML (plus a few same-origin links) and scores titles, headings, robots, HTTPS, and other crawl basics. No Google Ads keywords. No rank tracking.

**Frontend:** `vault/client/src/pages/SeoAuditPage.jsx`  
**Backend:** `vault/server/routes/seoAudit.js` · `vault/server/services/seo/seoAuditEngine.js`  
**Table:** `seo_audits`

---

## Flow

1. **New audit** — paste a website URL. Optional name (defaults to the page title).
2. **Scrape** — same SSRF-safe HTML fetch as Google Ads (homepage + up to four extra pages). No headless browser.
3. **Checks** — deterministic, no extra model call: HTTPS, title length, meta description, H1, viewport, `lang`, canonical, robots meta, robots.txt, Open Graph, JSON-LD, image alt text, thin copy, duplicate titles across scraped pages.
4. **Score** — starts at 100; fails subtract 12, warnings subtract 5. Findings list pass / warn / fail.

JavaScript-rendered sites often look thin. That is expected on this first pass.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/seo/audits` | List audits |
| `POST` | `/api/seo/audits` | `{ url, name? }` → scrape + report |
| `GET` | `/api/seo/audits/:id` | Full report. If the id is an old Google Ads project, `{ redirectTo: "/google-ads/:id" }` |
| `DELETE` | `/api/seo/audits/:id` | Remove audit |

Feature flag: **`seo`**.

---

## Data

`seo_audits` stores `url`, `score`, `summary`, `snapshot` (scrape without raw HTML), and `report` (`findings[]`, `pages[]`, `score`).
