# HTML · Lighthouse

Lighthouse lab audit at **`/html`**. Paste a public URL. Vault runs Google PageSpeed Insights for **mobile and desktop**, then you toggle between the two reports. This is not the SEO crawl at `/seo`.

**Frontend:** `vault/client/src/pages/HtmlAuditPage.jsx`  
**Backend:** `vault/server/routes/htmlAudit.js` · `htmlLighthouse.js` · `htmlAuditService.js`  
**Table:** `html_audits`

---

## Flow

1. **New run** — URL and optional name.
2. **PageSpeed** — two `runPagespeed` calls in parallel (mobile + desktop), categories performance, accessibility, best-practices, SEO. Requires **`PAGESPEED_API_KEY`**.
3. **Saved run** — toggle Mobile / Desktop, then two tabs that both follow that toggle:
   - **Report**: category scores, progress chart, a "N things to fix" pointer to Actions, lab metrics and field data (side by side from `xl`; every row has a hover explanation), opportunities, diagnostics, failed checks, warnings (each with a one-line descriptor), and **Copy for AI** (a ready-to-paste improvement prompt for the chosen device, containing the findings and what to weigh up; built by `client/src/pages/pageSpeed/pageSpeedLlmBrief.mjs`, test `node client/src/pages/pageSpeed/pageSpeedLlmBrief.test.mjs`). **Copy mobile + desktop** beside it still copies the raw developer brief for both devices.
   - **Actions**: the work order as a plain-English to-do list grouped **Fix first / Do next / When there is time** (P0/P1/P2). Each card: what is wrong, why it matters, what to do, who usually does it (Developer / Content editor / Hosting), job size, and "Also on desktop" / "Mobile only". "For your developer" expands the original technical ticket and evidence. Category filter, progress bar, Hide done, Copy action list. **Ticks and notes are saved on the run**: column `html_audits."actionsDone"` JSONB `{ mobile: { <actionKey>: { done, doneAt, note } }, desktop: {...} }`, written by `PUT /api/html/audits/:id/actions/:view` `{ key, done?, note? }` (`applyActionUpdate()` in `htmlAuditService.js`, test `node server/services/htmlAuditService.test.js`; does not touch `"updatedAt"` so ticking never reorders the run list). Ticks made before this (browser-only, `localStorage` `vault:pagespeed-done:<auditId>:<view>`) are moved up once when the run opens, then the local copy is cleared. A new run starts with no ticks.
   - **PDF report** (button above the tabs and on the Actions tab): dialog with devices, All / Still to do / Done only, Scores and timings, Developer detail, optional Title, Prepared for, Prepared by, Summary (Prepared by, Developer detail and the filter are remembered per browser). Built in the browser with `@react-pdf/renderer` (`client/src/pages/pageSpeed/pageSpeedReportPdf.jsx`, lazy-loaded), A4, ticked boxes with done dates and notes, page numbers. Downloaded, not emailed. Logic and the plain-English text per Lighthouse audit id: `client/src/pages/pageSpeed/pageSpeedActions.mjs` (`ACTION_HELP`; unknown audits fall back to Lighthouse's title and the category's reason). Works on old runs too: tickets are matched to audits by title, no server change. Test: `node client/src/pages/pageSpeed/pageSpeedActions.test.mjs`.

**Score estimates** (`client/src/pages/pageSpeed/scoreImpact.mjs`, test `node client/src/pages/pageSpeed/scoreImpact.test.mjs`): each action shows a green badge with the points fixing it could add, the Actions header shows "Fix first list only" and "Everything still to do" as score from -> to (ticked actions left out), each group heading shows its total, and the Actions copy and PDF carry the same. Accessibility, Best practices and SEO are exact: `weight x (1 - score) / category total weight x 100`, using `weight` per finding and `categoryWeights` per view, stored by `htmlLighthouse.js` from each category's `auditRefs` (Lighthouse zeroes n/a and manual audits there). Performance (marked ~) is an estimate: the finding's Lighthouse `metricSavings` (LCP/FCP/TBT/CLS) is taken off the lab timings and the score recomputed with Lighthouse 10-12's log-normal curves and weights (FCP 10, SI 10, LCP 25, TBT 30, CLS 25; mobile and desktop curves), as a difference from the score recomputed from the unchanged timings so rounding cancels. Combined performance savings overlap, so per timing it takes the largest saving plus half of the rest. Runs saved before 2026-11-10 have neither weights nor savings, so they show a "run this page again" line instead.

**Guide chat:** Page speed guide (`guideId` `page-speed`, `POST /api/page-speed-tutor`, flag `html`, `server/services/pageSpeedTutor.js`, wrapper `client/src/pages/pageSpeed/PageSpeedTutorChat.jsx`). Shared list `pageSpeed/pageSpeedTools.mjs` (also the (i) box text, `HOW_IT_WORKS`, shown once per browser, key `vault_pagespeed_info_seen`). Test: `node server/services/pageSpeedTutor.test.js`. When a control is added, update `pageSpeedTools.mjs` and `CATALOG` together.

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

Every control (URL/name inputs, run button, mobile/desktop toggle, Report/Actions tabs, category score cards, metric and field-data rows, action badges/ticks/filters, copy/delete buttons, search/sort/website filter) shows a themed hover popover via the shared `client/src/components/Tooltip.jsx` component. The (i) icon next to the "Page speed" sidebar title opens the "How Page speed works" box (`ToolInfoModal`).

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
