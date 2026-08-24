# HTML · Lighthouse

Lighthouse lab audit at **`/html`**. Paste a public URL, pick **Mobile** or **Desktop**, and Vault runs Google PageSpeed Insights (the hosted Lighthouse engine). This is not the SEO crawl at `/seo`.

**Frontend:** `vault/client/src/pages/HtmlAuditPage.jsx`  
**Backend:** `vault/server/routes/htmlAudit.js` · `htmlLighthouse.js` · `htmlAuditService.js`  
**Table:** `html_audits`

---

## Flow

1. **New run** — URL, optional name, strategy (mobile default).
2. **PageSpeed** — `pagespeedonline/v5/runPagespeed` with performance, accessibility, best-practices, and SEO categories. Optional `PAGESPEED_API_KEY`.
3. **Report** — four category scores (the ring number is performance), lab metrics (FCP, LCP, TBT, CLS, Speed Index, TTI), opportunities, failed binary audits.

SSRF-safe: the page URL is DNS-checked before it is sent to Google.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/html/audits` | List runs |
| `POST` | `/api/html/audits` | `{ url, name?, strategy? }` |
| `GET` | `/api/html/audits/:id` | Full report |
| `DELETE` | `/api/html/audits/:id` | Remove run |

Feature flag: **`html`**.

A run often takes 30–60 seconds. Use ProcessingModal. Google’s unauthenticated quota is small — set **`PAGESPEED_API_KEY`** on Railway for production.

## Get a PageSpeed Insights API key

There is no separate “Lighthouse API” signup. HTML uses Google’s **PageSpeed Insights API**.

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create or select a project (free; billing is not required for the default quota).
2. Enable **PageSpeed Insights API**: [API library](https://console.cloud.google.com/apis/library/pagespeedonline.googleapis.com).
3. Create an API key: [Credentials](https://console.cloud.google.com/apis/credentials) → **Create credentials** → **API key**.
4. Restrict the key to **PageSpeed Insights API** only.
5. Put the key in Railway as **`PAGESPEED_API_KEY`**.

Google’s getting-started page (includes **Get a Key**): [PageSpeed Insights API](https://developers.google.com/speed/docs/insights/v5/get-started).
