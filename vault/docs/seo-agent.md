# SEO agent

Website SEO / Google Ads helper at **`/seo`**. Create a project from a URL, scrape the public site, then generate an initial Google Ads setup: **100 keywords**, **100 negatives**, and **Responsive Search Ads** (headlines, descriptions, destination URLs, sitelinks). More tools can attach to the same project later.

**Frontend:** `vault/client/src/pages/SeoPage.jsx`  
**Backend:** `vault/server/routes/seo.js` · `vault/server/services/seo/`  
**Tables:** `seo_projects`, `seo_artifacts` (JSONB payload per tool)

---

## Flow

1. **New project** — paste a website URL and **what they sell** (the offer is ground truth for keywords and ads). Optional name + notes (locations, competitors).
2. **Scrape** — homepage plus up to four same-origin pages (about / services / products / pricing when those links exist). SSRF-safe fetch via `htmlFetch.js` (DNS + private IP reject).
3. **Keywords** — `standard` text model builds 100 keywords and 100 negatives from the **offer**. Scrape supplies brand, URLs, and extra detail only when it matches.
4. **Ads** — three RSA ad groups: 15 headlines (≤30 chars), 4 descriptions (≤90 chars), final URL from scraped pages, display paths, plus sitelinks.
5. **Use** — copy or download. Keyword lists use Google Ads syntax (`"phrase"`, `[exact]`, broad unquoted) one per line so they paste into Ads. RSA copy is plain lines or CSV.
6. **Regenerate** — keywords and ads can be rebuilt independently. Edit **What they sell** and save to rebuild from a corrected offer.

Long operations use the global **ProcessingModal**.

JavaScript-heavy sites may yield little text. The scrape is HTML-only (no headless browser). A thin scrape emits a Suggestions inbox alert.

RSA character limits are enforced after the model returns. Destination URLs are restricted to pages actually scraped (homepage fallback).

The HTML extractor keeps header/nav/footer copy (many sites put unique text there), reads JSON-LD, and decompresses gzip. A bot User-Agent was causing empty pages on some hosts.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/seo/status` | Whether a text model is available |
| `GET` | `/api/seo/projects` | List projects (no full scrape payload) |
| `POST` | `/api/seo/projects` | `{ url, offer, name?, notes? }` → scrape + keywords + ads |
| `GET` | `/api/seo/projects/:id` | Project + keyword and ads artifacts |
| `PATCH` | `/api/seo/projects/:id` | `{ name?, notes?, offer? }` |
| `DELETE` | `/api/seo/projects/:id` | Remove project and artifacts |
| `POST` | `/api/seo/projects/:id/keywords` | Regenerates keyword lists from stored scrape |
| `POST` | `/api/seo/projects/:id/ads` | Regenerates RSA copy from stored scrape |

Named routes (`/status`, `/projects`) are registered before `/:id`.

Feature flag: **`seo`** (Settings → Feature Access).

---

## Data

`seo_projects` holds the URL, **offer** (what they sell — keywords follow this), notes, and `siteSnapshot`. If the scrape describes a different industry than the offer, the UI warns and generation still follows the offer.

`seo_artifacts` is keyed by `(projectId, kind)`:

| kind | Payload |
|---|---|
| `google_ads_keywords` | `{ business, geo, keywords[], negatives[], counts, generatedAt, model }` |
| `google_ads_copy` | `{ campaignName, ads[], sitelinks[], counts, generatedAt, model }` |

Keyword items: `{ phrase, matchType: broad\|phrase\|exact, intent? }`.

Ad items: `{ adGroup, finalUrl, path1, path2, headlines[], descriptions[] }`.

Sitelinks: `{ text, url, description1, description2 }`.

---

## Model routing

| Step | Resolver | Settings key |
|---|---|---|
| Keyword + negative lists | `pickTextModel` → **`standard`** | `vault_models` / `default_model` |
| RSA headlines / descriptions | `pickTextModel` → **`standard`** | `vault_models` / `default_model` |

No hardcoded model ids.

---

## Environment

Uses existing chat keys (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`). No extra env vars.
