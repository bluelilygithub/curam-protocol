# SEO agent

On-page crawl at **`/seo`** for **organic SEO campaigns**, built to hold up as a real professional SEO audit tool, not just an on-page checklist. Paste a public URL and how many pages to crawl. Vault fetches same-origin HTML links (no headless browser), scores **each** page with severity-weighted findings, and lists campaign work: indexation, SERP titles/descriptions, thin or duplicate URLs, near-duplicate content, schema, and internal links.

This is not HTML Lighthouse (`/html`), not Adwords (`/google-ads`), and not Search Console queries (`/search-console`).

**Frontend:** `vault/client/src/pages/SeoAuditPage.jsx`  
**Backend:** `vault/server/routes/seoAudit.js` · `siteCrawler.js` · `seoAuditEngine.js`  
**Table:** `seo_audits`

---

## What it is for

An SEO manager (or a professional auditor doing a real client audit) needs to know: which URLs Google can index, whether query-string filters create duplicates, whether titles/descriptions/H1s are unique enough and not duplicated site-wide, which pages are thin or near-duplicates of each other, 4xx and orphans in this crawl, and www vs apex — with findings weighted by real SEO impact so the report reads as a prioritised work order, not a flat checklist. Copy or download the campaign brief to share.

## What it does not do

Page speed, Core Web Vitals, contrast, and unused JS/CSS belong to **HTML** (Lighthouse) — this tool does check `html lang` and viewport *presence* (see below) since those are cheap, real SEO/accessibility signals distinct from Lighthouse's deeper mobile UX audit. Keywords and RSA copy belong to **Adwords**. Live Google queries, coverage, and rankings belong to **Search** (Search Console). No independent rank tracker or backlinks. hreflang validation is a same-crawl heuristic only (see below) — it does not fetch every alternate URL to verify reciprocal links site-wide.

---

## Flow

1. **New audit** — URL, optional name, **pages to crawl** (1–40, default 25).
2. **Crawl** — BFS over same-site HTML `<a href>` links (`www` and apex count as the same site). Skips files. Honours `robots.txt` `User-agent: *` Disallow. Direct fetch is SSRF-safe via `htmlFetch.js`. If the host returns empty/HTTP 202, scrape via **Serper**, then WordPress REST / reader proxy.
3. **Per page** — title, meta description, H1, canonical (query URLs vs clean path), robots meta (noindex/nofollow), Open Graph, JSON-LD types, image alts, thin copy, HTTPS/status, hreflang (+ x-default/self-reference validation), X-Robots-Tag, redirect hops (+ loop detection), click depth, `html lang` presence, viewport meta presence.
4. **Site** — robots.txt (including Sitemap: lines), sitemap URLs not crawled or not linked, duplicate titles/descriptions/H1s, near-duplicate content across pages, noindex-vs-sitemap conflicts, crawl cap, 4xx, query-string risk, www vs apex, inbound links, indexability breakdown.
5. **Site-wide updates** — repeated gaps folded into one CMS/SEO-plugin/theme/hosting change (platform-agnostic wording, with WordPress specifics offered as an example, not the only framing).
6. **Copy / Download** — markdown campaign brief.

---

## Weighted scoring

`scoreFromFindings()` no longer applies a flat -12/-5 per fail/warn. Each finding `id` carries a `weight` (in addition to the existing `severity: 'pass'|'warn'|'fail'`, kept as-is for client compatibility) looked up from a per-id table in `seoAuditEngine.js` (`FINDING_WEIGHTS`), calibrated by real SEO impact:

| Tier | Examples | fail weight | warn weight |
|---|---|---|---|
| **Critical** (indexability-blocking) | `fetch`, `status` (4xx/5xx), `x-robots` (X-Robots-Tag noindex), `redirect-loop`, `robots-txt` (blocks everything), `robots-meta` (noindex) | 30 | 4–6 |
| **High** | `title`, `h1`, `query-canonical`, `dup-title`, `dup-description`, `dup-h1`, `duplicate-content`, `broken`, `noindex-sitemap`, `internal-links` | 14–18 | 8–10 |
| **Medium** | `description`, `canonical`, `schema`, `schema-fields`, `thin`, `query-params` | 10 | 5–6 |
| **Low** | `og`, `alt`, `redirect-chain`, `hreflang`, `html-lang`, `viewport`, `js-heavy` | 6 | 3 |
| default (unlisted id) | — | 12 | 5 |

Findings not in the table fall back to the old flat 12/5 so nothing silently loses weight. Reasoning is documented in a comment block directly above `FINDING_WEIGHTS` in `seoAuditEngine.js`.

---

## New professional-grade checks

- **`duplicate-content`** (site-level) — near-duplicate content across crawled pages via plain-JS word-shingle (5-gram) Jaccard similarity, no library, O(n²) pairwise (fine at the 40-page cap). Pages with <200 chars of body text are excluded (already caught by `thin`). Threshold ≥80% similarity.
- **`dup-description`** / **`dup-h1`** (site-level) — same duplicate-detection pattern as the existing `dup-title`, applied to meta descriptions and H1 text.
- **`noindex-sitemap`** (site-level) — any URL that is both in the sitemap and noindex (meta robots or X-Robots-Tag): wastes crawl budget and sends Google conflicting signals.
- **`hreflang`** (per-page, extended) — now validates the page's own hreflang tags for a missing `x-default` alternate and a missing self-referencing entry. Explicitly heuristic: it does not fetch every alternate URL to verify reciprocal links across the site — the finding detail says so.
- **`html-lang`** (per-page) — missing `<html lang="...">` attribute.
- **`viewport`** (per-page) — missing `<meta name="viewport">`. A different, cheaper signal than Lighthouse's mobile UX audit (presence only, not usability).
- **`redirect-loop`** (per-page) — an actual loop (same URL twice in the redirect chain) is now a distinct `fail`, separate from a long-but-terminating `redirect-chain` `warn`.
- **Indexability breakdown** (`report.indexability`) — site-level summary object: `indexable` / `noindexed` / `blockedByRobots` / `error` counts + `totalCrawled`. `blockedByRobots` is derived from sitemap URLs robots.txt disallows, since URLs actually blocked at crawl time are skipped before fetch by `siteCrawler` and never appear as crawled pages — the object's `note` field says this explicitly.

## Checks considered and left out

- **Full reciprocal hreflang verification** (fetching every alternate URL to confirm it links back) — out of scope for a same-crawl check; would multiply fetch volume per page. Documented as a limitation in the `hreflang` finding instead of overclaiming.
- **Robots.txt-blocked pages as a live crawled category** — `siteCrawler` skips disallowed URLs before fetching them, so they can't appear in `pageReports`; the indexability breakdown approximates this from the sitemap instead of pretending to have crawled them.

---

## Generalised (no longer WordPress-specific)

`GLOBAL_SPECS` recommendation text (the "fix once" site-wide update copy) now leads with platform-agnostic language — "your CMS/SEO plugin" or "hardcode it in the template" — with WordPress specifics (Yoast/Rank Math/AIOSEO, WordPress Address / Site Address) offered as a parenthetical example, not the only framing. The `looksProduct` heuristic in `auditPage()` (used to nudge for Product schema on commercial-looking paths) dropped an overly specific `cabinet` keyword; it's documented in-code as a heuristic, not real product detection (real detection already happens via the separate JSON-LD Product schema check).

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/seo/audits` | List audits |
| `POST` | `/api/seo/audits` | `{ url, name?, pageLimit? }` → crawl + report |
| `GET` | `/api/seo/audits/:id` | Full report. Old Google Ads project ids return `{ redirectTo: "/google-ads/:id" }` |
| `DELETE` | `/api/seo/audits/:id` | Remove audit |

Feature flag: **`seo`**.

## UI

Click-to-open help icon (`?` next to the page title) opens a modal describing the tool (mirrors the pattern in `HtmlAuditPage.jsx`'s `HelpModal`/`TOOL_HELP`). Every control (search, sort, new-audit button, URL/name/page-limit inputs, run button, per-audit list rows, copy/download/delete buttons, per-page rows) has a `Tooltip` (`client/src/components/Tooltip.jsx`). The indexability breakdown renders as a 4-stat row (Indexable / Noindexed / Blocked by robots / Error) near the top of a report, each stat with a tooltip explaining what it counts.
