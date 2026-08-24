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
