# SEO agent

Website SEO / Google Ads helper at **`/seo`**. Create a project from a URL, scrape the public site, then generate an initial Google Ads keyword set: **100 keywords** and **100 negative keywords**. More tools will attach to the same project later.

**Frontend:** `vault/client/src/pages/SeoPage.jsx`  
**Backend:** `vault/server/routes/seo.js` · `vault/server/services/seo/`  
**Tables:** `seo_projects`, `seo_artifacts` (JSONB payload per tool)

---

## Flow

1. **New project** — paste a website URL (optional name + notes: locations, offers, competitors).
2. **Scrape** — homepage plus up to four same-origin pages (about / services / products / pricing when those links exist). SSRF-safe fetch via `htmlFetch.js` (DNS + private IP reject).
3. **Generate** — `standard` text model builds two lists grounded in the scrape.
4. **Use** — copy (Google Ads token syntax: `"phrase"`, `[exact]`, broad) or download CSV (`Keyword,Match type`).
5. **Regenerate** — re-runs the lists from the stored scrape without fetching the site again.

Long operations use the global **ProcessingModal**.

JavaScript-heavy sites may yield little text. The scrape is HTML-only (no headless browser). A thin scrape emits a Suggestions inbox alert.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/seo/status` | Whether a text model is available |
| `GET` | `/api/seo/projects` | List projects (no full scrape payload) |
| `POST` | `/api/seo/projects` | `{ url, name?, notes? }` → scrape + generate |
| `GET` | `/api/seo/projects/:id` | Project + latest `google_ads_keywords` artifact |
| `PATCH` | `/api/seo/projects/:id` | `{ name?, notes? }` |
| `DELETE` | `/api/seo/projects/:id` | Remove project and artifacts |
| `POST` | `/api/seo/projects/:id/keywords` | Regenerates keyword lists from stored scrape |

Named routes (`/status`, `/projects`) are registered before `/:id`.

Feature flag: **`seo`** (Settings → Feature Access).

---

## Data

`seo_projects` holds the URL, notes, and `siteSnapshot` (title, description, headings, page texts).

`seo_artifacts` is keyed by `(projectId, kind)` so later tools can add rows without new tables:

| kind | Payload |
|---|---|
| `google_ads_keywords` | `{ business, geo, keywords[], negatives[], counts, generatedAt, model }` |

Keyword items: `{ phrase, matchType: broad\|phrase\|exact, intent? }`.

---

## Model routing

| Step | Resolver | Settings key |
|---|---|---|
| Keyword + negative lists | `pickTextModel` → **`standard`** | `vault_models` / `default_model` |

No hardcoded model ids.

---

## Environment

Uses existing chat keys (`ANTHROPIC_API_KEY` / `GEMINI_API_KEY`). No extra env vars.
