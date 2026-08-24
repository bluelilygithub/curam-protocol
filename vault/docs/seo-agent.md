# SEO agent

On-page SEO audit at **`/seo`**. Paste a public URL and how many pages to crawl. Vault fetches same-origin HTML links (no headless browser), scores **each** page, and lists recommendations for every URL fetched. No Google Ads keywords. No rank tracking.

**Frontend:** `vault/client/src/pages/SeoAuditPage.jsx`  
**Backend:** `vault/server/routes/seoAudit.js` · `siteCrawler.js` · `seoAuditEngine.js`  
**Table:** `seo_audits`

---

## Flow

1. **New audit** — URL, optional name, **pages to crawl** (1–40, default 15).
2. **Crawl** — BFS over same-origin `<a href>` links. Skips files (pdf/images/css/js). Honours `robots.txt` `User-agent: *` Disallow. SSRF-safe fetch via `htmlFetch.js`. Thin or HTTP 202 responses are retried without compression; empty bodies are not treated as on-page SEO fails.
3. **Per page** — title, meta description, H1, viewport, lang, canonical, robots meta, Open Graph, image alts, thin copy, HTTPS/status.
4. **Site** — robots.txt, duplicate titles, crawl cap vs discovered URLs.
5. **Recommendations** — every fail/warn becomes an action on that page (and site-level items at the top).

JavaScript-rendered sites often look thin. Raise the page limit if important URLs were not linked in HTML.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/seo/audits` | List audits |
| `POST` | `/api/seo/audits` | `{ url, name?, pageLimit? }` → crawl + report |
| `GET` | `/api/seo/audits/:id` | Full report. Old Google Ads project ids return `{ redirectTo: "/google-ads/:id" }` |
| `DELETE` | `/api/seo/audits/:id` | Remove audit |

Feature flag: **`seo`**.

---

## Data

`seo_audits.report` includes `score`, `summary`, `crawled`, `discovered`, `pageLimit`, site `findings` / `recommendations`, and `pages[]` (`url`, `title`, `score`, `findings[]`, `recommendations[]`). Raw HTML is not stored.
