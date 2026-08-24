# HTML · Lighthouse

Lighthouse lab audit at **`/html`**. Paste a public URL. Vault runs Google PageSpeed Insights for **mobile and desktop**, then you toggle between the two reports. This is not the SEO crawl at `/seo`.

**Frontend:** `vault/client/src/pages/HtmlAuditPage.jsx`  
**Backend:** `vault/server/routes/htmlAudit.js` · `htmlLighthouse.js` · `htmlAuditService.js`  
**Table:** `html_audits`

---

## Flow

1. **New run** — URL and optional name.
2. **PageSpeed** — two `runPagespeed` calls in parallel (mobile + desktop), categories performance, accessibility, best-practices, SEO. Requires **`PAGESPEED_API_KEY`**.
3. **Report** — toggle Mobile / Desktop. **Work order** (P0–P2 tickets a developer can implement), category scores, CrUX, lab metrics, opportunities with URLs/savings, diagnostics, failed checks with selectors and contrast values, copyable brief.

SSRF-safe: the page URL is DNS-checked before it is sent to Google.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/html/audits` | List runs |
| `POST` | `/api/html/audits` | `{ url, name? }` → mobile + desktop |
| `GET` | `/api/html/audits/:id` | Full report |
| `DELETE` | `/api/html/audits/:id` | Remove run |

Feature flag: **`html`**.

A run often takes about a minute (two PSI jobs in parallel). Use ProcessingModal.

## Get a PageSpeed Insights API key

There is no separate “Lighthouse API” signup. HTML uses Google’s **PageSpeed Insights API**.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project (free; billing is not required for the default quota).
2. Enable **PageSpeed Insights API**: [API library](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com). Same project as the key.
3. Create an API key: [Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials** → **API key**.
4. **Application restrictions:** None. Do not use HTTP referrers (Vault is server-side) and do not lock a Railway IP.
5. **API restrictions:** “Don’t restrict key”, **or** Restrict key with **PageSpeed Insights API** ticked. Enabling the API in the Library is not enough if the key is restricted to other APIs — that returns **API_KEY_SERVICE_BLOCKED** (“Requests to this API are blocked”).
6. Railway: variable name **`PAGESPEED_API_KEY`** on the **Vault web** service (not Postgres). No quotes around the value. Redeploy after adding it.

Google’s getting-started page (includes **Get a Key**): [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started).
