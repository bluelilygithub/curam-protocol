# Google Ads agent

Google Ads campaign starter at **`/google-ads`**. Create a project from a URL, scrape the public site, then generate an initial Search setup: **100 keywords**, **100 negatives**, and ad copy (RSA or a 10/10 pack), plus destination URLs and sitelinks.

This is not an SEO audit. On-page checks live in the **SEO** agent at `/seo`.

**Frontend:** `vault/client/src/pages/SeoPage.jsx`  
**Backend:** `vault/server/routes/seo.js` mounted at **`/api/google-ads`** · `vault/server/services/seo/`  
**Tables:** `seo_projects`, `seo_artifacts` (JSONB payload per tool)

---

## Flow

1. **New project** — paste a website URL and **what they sell** (the offer is ground truth for keywords and ads). Optional name + notes (locations, competitors).
2. **Scrape** — homepage plus up to four same-origin pages (about / services / products / pricing when those links exist). SSRF-safe fetch via `htmlFetch.js` (DNS + private IP reject).
3. **Keywords** — `standard` text model builds 100 keywords and 100 negatives from the **offer**. Scrape supplies brand, URLs, and extra detail only when it matches.
4. **Ads** — choose **RSA** (three ad groups: 15 headlines ≤30, 4 descriptions ≤90) or **10 headlines / 10 descriptions** (one copy pack). Destination URLs from scraped pages, plus sitelinks.
5. **Use** — on the **Ads** tab, headlines and descriptions list under the format buttons (copy or CSV). Keyword lists use Google Ads syntax (`"phrase"`, `[exact]`, broad unquoted) one per line.
6. **Regenerate** — keywords and ads can be rebuilt independently. On Ads, pick the format then regenerate. Edit **What they sell** and save to rebuild from a corrected offer.

Long operations use the global **ProcessingModal**.

JavaScript-heavy sites may yield little text. The scrape is HTML-only (no headless browser). A thin scrape emits a Suggestions inbox alert.

Character limits are enforced after the model returns (headlines ≤30, descriptions ≤90). Destination URLs are restricted to pages actually scraped (homepage fallback). New projects generate RSA by default; use the Ads tab for the 10/10 pack.

---

## API

Mounted at **`/api/google-ads`**. Same paths as before (`/status`, `/projects`, `/projects/:id/keywords`, `/projects/:id/ads`).

Feature flag: **`googleAds`**. If that flag has never been saved, it inherits the old **`seo`** workspace flag until an admin saves Feature Access.

Bookmarks to `/seo/:id` that still point at an Ads project are redirected to `/google-ads/:id`.
