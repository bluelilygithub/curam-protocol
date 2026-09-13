# HTML · Lighthouse

Lighthouse lab audit at **`/html`**. Paste a public URL. Vault runs Google PageSpeed Insights for **mobile and desktop**, then you toggle between the two reports. This is not the SEO crawl at `/seo`.

**Frontend:** `vault/client/src/pages/HtmlAuditPage.jsx`  
**Backend:** `vault/server/routes/htmlAudit.js` · `htmlLighthouse.js` · `htmlAuditService.js`  
**Table:** `html_audits`

---

## Flow

1. **New run** — URL and optional name.
2. **PageSpeed** — two `runPagespeed` calls in parallel (mobile + desktop), categories performance, accessibility, best-practices, SEO. Requires **`PAGESPEED_API_KEY`**.
3. **Report** — toggle Mobile / Desktop. **Work order** (P0–P2 tickets a developer can implement, tagged by category so Accessibility/SEO/Best-practices issues get real tickets too, not just Performance), category scores, CrUX, lab metrics, opportunities with URLs/savings, diagnostics, failed checks with selectors and contrast values, copyable brief.

SSRF-safe: the page URL is DNS-checked before it is sent to Google.

---

## Work order

`workOrder()` in `htmlLighthouse.js` builds the ranked ticket list in two passes:

1. **Curated tickets** — a handful of well-understood, high-value patterns (redirect chains, LCP image discoverability, unused/render-blocking JS, unused/unminified CSS, heading order, colour contrast, forced reflow) get specific, code-level guidance (exact HTML attributes, exact fix) rather than a generic audit description. Each curated ticket records the audit id(s) it consumed.
2. **Generic tickets** — every remaining failed audit, opportunity, or low-scoring diagnostic/warning across **all four PSI categories** (Performance, Accessibility, SEO, Best practices) that wasn't already claimed by a curated ticket gets its own ticket, titled from the audit and using Lighthouse's own description as the action text. This is what closes the gap where Accessibility/SEO/Best-practices audits used to score a number with no accompanying guidance.

Priority: failed audits (binary, outright fail) → P0; opportunities with ≥300ms or ≥100KB savings → P0, else P1; low-scoring diagnostics → P1 (score < 0.5) or P2; warnings → P2. Every ticket carries a `category`/`categoryLabel` so the UI can show which of the four scores it addresses.

---

## API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/html/audits` | List runs |
| `POST` | `/api/html/audits` | `{ url, name? }` → mobile + desktop |
| `GET` | `/api/html/audits/:id` | Full report |
| `DELETE` | `/api/html/audits/:id` | Remove run |

Feature flag: **`html`**.

Every control (URL/name inputs, run button, mobile/desktop toggle, category score cards, work-order priority/category badges, copy/delete buttons, search/sort/website filter) shows a themed hover popover via the shared `client/src/components/Tooltip.jsx` component — same one used by Graphics, PDF Tools, Video Tools, YouTube, and Domain. A `?` icon next to the "Lighthouse" sidebar title opens a modal with the tool's full description and feature list — the same click-to-open help layer as Graphics/PDF, absent until now since this is otherwise a single-purpose page.

**Filter by website:** the sidebar's website dropdown (only shown once 2+ distinct hostnames have runs) narrows the run list to one site and drives the progress chart below from just that site's history.

**Progress chart:** `ScoreTrendChart` in `HtmlAuditPage.jsx` — a plain inline SVG line chart (no charting library) plotting Performance score over time for one website, built from the already-stored `score`/`createdAt` fields on `listAudits()` results (no extra query). Single series, so no legend is needed (the chart title names it); the line uses the app's own `--color-primary` token rather than a fixed hex, so it follows whichever theme (including dark mode) is active. Shows automatically on the detail page once a site has 2+ runs, and on the landing page once a website filter is selected.

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
