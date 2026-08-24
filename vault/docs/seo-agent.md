# SEO agent

On-page SEO audit at **`/seo`**. Paste a public URL and how many pages to crawl. Vault fetches same-origin HTML links (no headless browser), scores **each** page, and lists recommendations for every URL fetched. No Google Ads keywords. No rank tracking.

**Frontend:** `vault/client/src/pages/SeoAuditPage.jsx`  
**Backend:** `vault/server/routes/seoAudit.js` · `siteCrawler.js` · `seoAuditEngine.js`  
**Table:** `seo_audits`

---

## Flow

1. **New audit** — URL, optional name, **pages to crawl** (1–40, default 25).
2. **Crawl** — BFS over same-site HTML `<a href>` links (`www` and apex count as the same site). Skips files. Honours `robots.txt` `User-agent: *` Disallow. Direct fetch is SSRF-safe via `htmlFetch.js`. If the host returns empty/HTTP 202 (common from Railway), Vault scrapes the page through **Serper** (`SERPER_SEARCH_API_KEY` / `scrape.serper.dev`) so HTML and links come from Serper’s IPs, then continues the crawl. WordPress REST and a reader proxy remain as extra fallbacks. Empty direct bodies are not treated as on-page SEO fails.
3. **Per page** — title, meta description, H1, viewport, lang, canonical (including query-string URLs vs the clean path), robots meta (noindex/nofollow), Open Graph, JSON-LD types, image alts, thin copy, HTTPS/status.
4. **Site** — robots.txt, duplicate titles, crawl cap, 4xx URLs, query-string duplicate risk, www vs apex 301 + canonical host, inbound links in this crawl.
5. **Site-wide updates** — issues that repeat across pages (viewport, lang, Open Graph, titles, H1, alts, HTTPS) folded into one theme / SEO-plugin / hosting change, with how many crawled pages they affect.
6. **Per-page recommendations** — remaining fail/warn actions on each URL.

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

`seo_audits.report` includes `score`, `summary`, `crawled`, `discovered`, `pageLimit`, site `findings` / `recommendations`, `globalUpdates[]` (`action`, `applyIn`, `pagesAffected`), `pages[]` (`url`, `title`, `score`, `findings[]`, `recommendations[]`), plus JSON-LD types, image alts, inbound links, 4xx list, and www/apex host probe. Page speed, CWV, and backlinks stay in `notCovered`. Raw HTML is not stored.
