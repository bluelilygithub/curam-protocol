# SEO agent

On-page crawl at **`/seo`** for **organic SEO campaigns**. Paste a public URL and how many pages to crawl. Vault fetches same-origin HTML links (no headless browser), scores **each** page, and lists campaign work: indexation, SERP titles/descriptions, thin or duplicate URLs, schema, and internal links.

This is not HTML Lighthouse (`/html`), not Adwords (`/google-ads`), and not Search Console queries (`/search-console`).

**Frontend:** `vault/client/src/pages/SeoAuditPage.jsx`  
**Backend:** `vault/server/routes/seoAudit.js` · `siteCrawler.js` · `seoAuditEngine.js`  
**Table:** `seo_audits`

---

## What it is for

An SEO manager planning a campaign needs to know: which URLs Google can index, whether query-string filters create duplicates, whether titles/descriptions are unique enough for SERPs, which pages are thin, 4xx and orphans in this crawl, and www vs apex. Copy or download the campaign brief to share.

## What it does not do

Viewport, `html lang`, page speed, Core Web Vitals, contrast, and unused JS/CSS belong to **HTML**. Keywords and RSA copy belong to **Adwords**. Live Google queries, coverage, and rankings belong to **Search** (Search Console). No independent rank tracker or backlinks.

---

## Flow

1. **New audit** — URL, optional name, **pages to crawl** (1–40, default 25).
2. **Crawl** — BFS over same-site HTML `<a href>` links (`www` and apex count as the same site). Skips files. Honours `robots.txt` `User-agent: *` Disallow. Direct fetch is SSRF-safe via `htmlFetch.js`. If the host returns empty/HTTP 202, scrape via **Serper**, then WordPress REST / reader proxy.
3. **Per page** — title, meta description, H1, canonical (query URLs vs clean path), robots meta (noindex/nofollow), Open Graph, JSON-LD types, image alts, thin copy, HTTPS/status, hreflang, X-Robots-Tag, redirect hops, click depth.
4. **Site** — robots.txt (including Sitemap: lines), sitemap URLs not crawled or not linked, duplicate titles, crawl cap, 4xx, query-string risk, www vs apex, inbound links.
5. **Site-wide updates** — repeated gaps folded into one plugin/theme/hosting change.
6. **Copy / Download** — markdown campaign brief.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/seo/audits` | List audits |
| `POST` | `/api/seo/audits` | `{ url, name?, pageLimit? }` → crawl + report |
| `GET` | `/api/seo/audits/:id` | Full report. Old Google Ads project ids return `{ redirectTo: "/google-ads/:id" }` |
| `DELETE` | `/api/seo/audits/:id` | Remove audit |

Feature flag: **`seo`**.
