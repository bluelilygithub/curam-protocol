# Product Scout

Unbiased purchasing agent: Amazon search → LLM value scoring → cross-market alternatives.

## Architecture

| Layer | Location |
|-------|----------|
| **CLI (Python)** | `product-scout/` — standalone `python main.py "query"` |
| **Vault API** | `POST /api/product-scout/run` → `productScoutService.js` |
| **UI** | `/product-scout` — Apps → Content tools → Product Scout |
| **History** | `product_scout_runs` table (JSONB result per run) |

Both CLI and Vault API implement the same core pipeline:

1. **Rainforest API** — plain Amazon search (top 8–10), sponsored listings included (see Sponsored listings below)
2. **LLM** — structured JSON comparison, top 3 by value score (`getModelsForUser` → `standard` tier in Vault)
3. **Web search** — external alternatives (`SEARCH_API_KEY`, same as chat `@search`)

Vault-only extras: max price + variance stretch, delivery filters, admin marketplace, structured UI cards, feature comparison table, run history with bulk delete.

## Environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `RAINFOREST_API_KEY` | Yes | Amazon product/search data |
| `AMAZON_DOMAIN` | No | Overrides admin marketplace; default `amazon.com.au` |
| `ANTHROPIC_API_KEY` | Yes* | LLM scoring (*or Gemini via vault_models) |
| `SEARCH_API_KEY` | Recommended | Cross-market step |
| `SEARCH_PROVIDER` | No | `brave` \| `serper` \| `serpapi` |

CLI-only LLM vars: see `product-scout/.env.example` (`LLM_PROVIDER`, `LLM_MODEL`, `OPENAI_API_KEY`, …).

## API

```
GET  /api/product-scout/config-check   — key presence + variance % + marketplace
GET  /api/product-scout/settings       — price variance % + amazon domain (admin write via POST)
GET  /api/product-scout/runs           — recent runs for user
GET  /api/product-scout/runs/:id       — single run
POST /api/product-scout/run            — { query, maxPrice?, freeDelivery?, within2Days? }
POST /api/product-scout/guide/brief       — { query, userFeatures?, budgetHint? } → feature brief + tier framework
POST /api/product-scout/guide/run         — { query, userFeatures?, budgetHint?, featureBrief } → tier ladder
POST /api/product-scout/compare-url    — { url, runId } — compare Amazon URL vs budget picks from a run
POST /api/product-scout/runs/delete    — { ids: [1, 2, …] }
POST /api/product-scout/settings       — admin: { priceVariancePct?, amazonDomain? }
```

Feature flag: `productScout` in Settings → Feature Access.

## Modes (Vault UI)

**Primary journey:** Buy guide → Product Scout per price tier.

1. Describe product + features → **feature brief** (editable): category-specific **key specs** + compact **feature grid** (click to cycle must/nice/skip)
2. **Scout products for each tier** — full top-3 comparison at Essentials, Smart upgrade, Enthusiast, and Pro price bands
3. Optional **Compare URL** against tier picks

**Quick scout** (collapsed): single max-price comparison without the guide — for when you already know your budget.

### Feature brief (Step 2)

After **Build my guide**, the brief splits into:

- **Key specs** — Amazon sidebar-style filters for **this** product (first 2–5 items from `amazon_sidebar_filters` in the brief JSON). Type/form factor always leads when relevant.
- **Features & capabilities** — compact grid; click each tile to cycle skip → nice → must. *All must* / *Clear all* bulk actions. *Why these matter* expands rationale text.

Spec values are passed into tier scouting and the final recommendation as concrete requirements (e.g. `Battery life: at least 30h`). Options and units are **category-specific** — generated per query, not hardcoded to laptops.

### Feature brief schema (guide)

Each item in `feature_brief.features`:

| Field | `kind: feature` | `kind: spec` |
|-------|-----------------|--------------|
| `feature` | Capability label | Measurable attribute label |
| `importance` | `must` \| `nice` \| `skip` | Usually `must` when set; `skip` when shopper dismisses |
| `why_it_matters` | Optional rationale | Optional rationale |
| `spec_type` | — | `numeric_min` \| `numeric_max` \| `enum` \| `text` |
| `spec_unit` | — | e.g. `GB`, `h`, `kg`, or `null` |
| `spec_value` | — | Default / shopper selection |
| `spec_options` | — | 3–6 category-appropriate quick-picks (LLM-generated) |

**Client:** `ProductScoutFeatureBrief.jsx` + `productScoutFeatureTypes.js` (normalise only — no hardcoded product-category patterns).

**Server:** `productScoutGuideService.js` — brief prompt requires `amazon_sidebar_filters` (2–5 Amazon sidebar dimensions per query), merged into `features` for the UI. `formatFeatureRequirement` passes must-have specs into tier scouting via `shopperPriorities`.

| Field | Type | Notes |
|-------|------|-------|
| `query` | string | Required search phrase |
| `maxPrice` | number | Optional budget ceiling (AUD for AU marketplace) |
| `freeDelivery` | boolean | Filter to listings with free delivery signal |
| `within2Days` | boolean | Filter to listings with today/tomorrow/2-day delivery signal |

### Compare URL (after a scout run)

Paste an Amazon product URL to compare it against the ranked budget picks from that run. Returns two AI paragraphs:

1. **upgrade_benefits** — major advantages over your picks; whether stretching budget is worth it  
2. **budget_guidance** — features missing on budget picks + suggested mid-range budget (AUD)

Also: `feature_gaps`, `worth_stretching`, `recommended_budget_min/max`. Saved on the run as `url_comparisons[]`.

## Budget & variance

- **Max price** — optional per-search field on `/product-scout`. Top 3 are chosen only from products at or below this price.
- **Variance %** — admin setting in **Settings → Product Scout** (`workspace_settings.product_scout_price_variance_pct`, default 10%). Products above max price but within `max × (1 + variance/100)` are scored separately as **stretch suggestions** (up to 2) when value justifies the extra cost.
- Products above the variance ceiling are excluded entirely.

## Amazon marketplace

- **Admin UI** — Settings → Product Scout → country dropdown (`product_scout_amazon_domain`, default `amazon.com.au`).
- **Env override** — `AMAZON_DOMAIN` in Railway beats the workspace setting (shown in Settings UI when set).
- Resolver: `productScoutSettings.js` (`getAmazonDomain`, `setAmazonDomain`, `marketplaceLabel`).

## Delivery filters

Parsed from Rainforest search item fields in `productScoutDelivery.js`:

- **Free delivery** — `delivery.price.is_free`, “free delivery/shipping” text, or Prime + free signal
- **Within 2 days** — today/tomorrow/overnight/same-day text, or numeric day counts ≤ 2

When toggles are on, candidates are filtered before LLM scoring. Delivery text is shown on result cards and as the second row in the feature comparison table (after price).

## Results UI

- **Cards** — top 3 picks + optional stretch cards with value score, priority features, links
- **Listing ratings** — review count label clarifies these are per-listing ratings, not brand reputation
- **Feature table** — side-by-side comparison for top 3 + first stretch pick; price and delivery always first columns; LLM `feature_table` merged with bullet fallback via `productScoutCompareTable.js`
- **Why these three?** — LLM summary paragraph
- **History** — recent runs list; Tasks-style bulk select + delete

## Suggestions inbox

`productScout` emitter calls `SuggestionService.captureIf` when cross-market search returns no external results (`category: source`).

## CLI usage

```bash
cd product-scout
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py "standing desk mat" --json
```

CLI does not yet expose delivery filters or workspace marketplace settings — set `AMAZON_DOMAIN` in `.env`. See `product-scout/README.md` for full CLI docs.

## Performance

- **Tier scouting runs in parallel.** `runBuyGuide` (`productScoutGuideService.js`) scouts all selected tiers via `Promise.all`, not sequentially — each tier's LLM compare call used to stack one after another, so scouting all 4 tiers meant 4 round-trips in serial. Now they overlap.
- **Rainforest search cache.** `rainforestClient.searchProducts` caches results 10 min in-memory, keyed on query+domain+resultCount+sortBy+delivery filters. Covers tier-band refetches, retries, and re-opening the same run without re-hitting the API. In-process only — clears on deploy/restart, fine for Railway's single instance.

## Tier framework sanity checks

An LLM-guessed 4-tier price framework can be entirely disconnected from what Amazon actually sells — both a floor set too high (excluding real cheap listings) and a ceiling set too high (offering a tier, e.g. Enthusiast $600–$1200, that has zero real listings because the category tops out around $509). `buildGuideBrief` runs two small Rainforest samples (10 results each, ascending and descending price sort) as part of Step 1 and fixes both ends:

- **Floor** (`sanityCheckEssentialsFloor`) — lowers the Essentials floor to just under the cheapest genuinely relevant listing found, if the LLM's floor was higher. Only ever down, only Essentials.
- **Ceiling** (`sanityCheckTierCeiling`) — finds the first tier whose floor sits above the real max price found, and compresses that tier (and everything above it) into the space between the real ceiling (`realMax * 1.15`) and 70% of that ceiling — instead of leaving a dead band nobody could ever fill. Marks affected tiers `ceiling_adjusted: true` and appends a note to their subtitle.

Both filter candidates through the same relevance guards used at scout time (`filterFormFactorMismatches`, `filterAccessoryMismatches`) so an accessory or wrong-category listing can't skew the real min/max. Both fail silently (keep the LLM's original framework) on any search error — this is a safety net, not a hard dependency. `ProductScoutTierSelect.jsx` auto-selects any tier marked `floor_adjusted` or `ceiling_adjusted` by default so the fix isn't just a subtitle nobody reads. Step 1 is consequently no longer Amazon-fetch-free — two extra small Rainforest searches per brief (cached 10 min, so repeat brief attempts on the same query don't re-fetch).

## Must-haves as capability thresholds, not exact phrases

Confirmed gap: a shopper describes a category generically ("dual microphone"), but a market-leading product uses its own vocabulary ("five-mic array") — every layer (enrichment string, must-have matching, scoring) was keyword-literal, so the leader could be excluded purely on wording even when it exceeds the requirement.

`BRIEF_SYSTEM` + `buildBriefPrompt` (`productScoutGuideService.js`) now instruct the brief LLM to phrase must-haves as capability **thresholds** — `kind: "spec"`, `spec_type: "numeric_min"` (e.g. "Microphone count: at least 2") — instead of a fixed `kind: "feature"` label ("Dual microphone") whenever the requirement is really a minimum count/capacity. A numeric threshold is satisfied by anything meeting-or-exceeding it regardless of wording; `buildEnrichedSearchQuery` also naturally turns a numeric spec into a plain number term ("2 mics") rather than a fixed phrase, which is less likely to exclude differently-worded listings from Amazon's own search ranking.

This is a partial fix — it only helps requirements that are genuinely a count/capacity. It doesn't teach the LLM comparison step to recognize synonymous capabilities described in totally different terms (e.g. "ANC" vs "active noise suppression"); that's a harder, not-yet-done fix.

## Pipeline version stamp

Every saved run (scout or guide) carries `pipeline_version` (`PIPELINE_VERSION` in `productScoutService.js`, e.g. `ps-v6`) — bumped whenever a change alters what a run actually returns (candidate sourcing, filtering, scoring, tier framework), not for cosmetic UI tweaks. Same idea as the `creationtoolversion` stamp translate embeds in its TMX export. Shown in the PDF report header and under the tier ladder in the UI, so a run is traceable to the exact pipeline behavior that produced it without asking "what was live when this ran."

## Sponsored listings

`rainforestClient.searchProducts` no longer sets `exclude_sponsored` — sponsored results are included in every search. A sponsored placement can be the best product for the query, and our scoring (`pre_score`: price/rating/reviews) is placement-blind, so excluding them only shrank the pool for no benefit. Each candidate now carries `is_sponsored` (from Rainforest's `sponsored` field) for future UI/audit use — not currently used to filter or penalize.

## Plain-query pool supplement

Confirmed via Railway logs: an enriched search string (`smart glasses Smart sunglasses 6h 40degrees 100g`) never surfaced Ray-Ban Meta Wayfarer anywhere in its 40-result Amazon pool, which topped out at $129.99 — a well-known branded product was invisible to the whole scoring pipeline before any LLM ran, buried by Amazon's own ranking under generic dropship listings that happened to match the literal enrichment keywords better.

`runBuyGuide` now runs a small supplementary search (15 results) on the **plain, unenriched base query** whenever the enriched search string differs from it, and merges any new ASINs into the candidate pool (deduped). This doesn't replace the enriched search — it still runs first and is the primary source — it just gives a recognisable brand a second chance to be seen even when it doesn't literally contain the enrichment terms. Logged as `[productScout] guide plain-query supplement`.

## "Why wasn't this in the original scout?"

When a shopper-compared URL turns out cheaper/better than the scouted picks, `compareUrlToScout` (`productScoutCompareUrl.js`) computes `not_included_reason` deterministically from the guide's own tier framework — not an LLM guess:

- priced below every tier's floor → says so, and names the lowest floor
- priced above every tier's ceiling → says so
- falls in a tier that hasn't been searched yet → names the tier, suggests searching it
- falls in an already-searched tier but wasn't in that tier's top 3 → says it lost on ranking/reviews or Amazon's search for that tier's query didn't return it

Shown in `ProductScoutUrlCompare.jsx` under "Why wasn't this in the original scout?".

## Progress steps during long operations

Brief generation, tier scouting, recommendation refresh, external check, and URL compare now use `runWithStepLog` (`client/src/store/processingStore.js`) instead of a static `startProcessing` message — the `ProcessingModal` shows a live step list (e.g. "Searching Amazon (Rainforest)" → "Filtering by price band & relevance" → "Scoring candidates" → "AI value comparison" → "Building recommendation") that advances on a timer while the request is in flight, plus an elapsed-time readout. The steps are illustrative pacing, not a real server-side progress feed — there's no SSE for these endpoints — but they replace the previous single static "please wait" message.

## Relevance filtering

Two post-fetch guards drop candidates that don't match the shopper's product category, before pre-scoring/LLM ranking runs on them:

- **`filterFormFactorMismatches`** — mono call-headsets vs. stereo earbuds/headphones queries.
- **`filterAccessoryMismatches`** — a query naming a recognised device (monitor, laptop, tablet, camera, TV, speaker, watch, keyboard, mouse, printer, router, vacuum, blender, drone, projector, SSD/hard drive, …) drops candidates whose title reads as ONLY that device's accessory (case, bag, tote, sleeve, mount, stand, tripod, charger, cable, adapter, dock, strap, screen protector, skin, holder, stylus). Both guards never empty the pool entirely — if filtering would leave nothing, the original list is kept and a warning logged.

`buildEnrichedSearchQuery` (`productScoutGuideService.js`) also keeps accessory nouns (e.g. a must-have "carrying bag" feature) out of the raw Amazon search string — injecting them as literal keywords was steering Amazon's own ranking toward accessory-only listings (a $55 monitor bag outranking actual monitors). Those requirements still reach the LLM via `shopperPriorities`.

## Model override

Product Scout (brief, tier compare, final recommendation) uses the workspace `standard` tier by default like everything else. Settings → Amazon Search → **Model override** lets a user (or admin, as a workspace-wide fallback) pin Product Scout to a specific connected model instead — e.g. to avoid a reasoning-heavy DeepSeek id (`-flash`/`-reasoner`) that can spend its entire token budget on hidden reasoning and return an empty structured-JSON response (see `callModel.js` deepseek retry-with-larger-budget fix for the underlying failure mode).

- Settings key: `product_scout_model` (empty = inherit `standard`)
- Resolution: user's own setting → first admin's setting → `standard`
- Server: `productScoutModelResolver.js` (`resolveProductScoutModel`, `getProductScoutModelConfig`, `saveProductScoutModel`)
- API: `GET /api/product-scout/model-config`, `POST /api/product-scout/model-config { modelId }`

## Reports

Any saved run (scout or guide mode) can be downloaded or emailed as a PDF via `productScoutReportPdf.js` (pdf-lib, no headless browser):

- `GET /api/product-scout/runs/:id/pdf` — streams the PDF for download
- `POST /api/product-scout/runs/:id/email` — `{ to }`, sends via `sendEmail` (attachment) — same MailChannels/SMTP path as password reset / shares emails

Guide-mode reports list each scouted tier's own top pick + rationale first, then the overall cross-tier recommendation — same order as the UI (`ProductScoutTierLadder.jsx` renders `ProductScoutFinalRecommendation` after the tier ladder, not before). Client: `ProductScoutReportActions.jsx` (Download PDF / Email PDF buttons), used on both the guide ladder and quick-scout result panel.

## Design notes

- **Value score** — LLM judges features/specs vs price and review quality, not Amazon rank
- **Non-circular check** — web query excludes `amazon.com` / `amazon.com.au`
- **No hardcoded model** — Vault uses Settings; CLI uses `LLM_PROVIDER` env
- **LLM JSON** — `parseModelJson` + retry with compact prompt on parse failure (8192 max tokens)

## Key files

| File | Role |
|------|------|
| `server/routes/productScout.js` | HTTP routes |
| `server/services/productScoutService.js` | Full pipeline + history |
| `server/services/productScoutSettings.js` | Variance % + marketplace |
| `server/services/productScoutDelivery.js` | Delivery parse + filter |
| `server/services/rainforestClient.js` | Rainforest search |
| `server/services/productScoutFormat.js` | Markdown for stored runs |
| `client/src/pages/ProductScoutPage.jsx` | Search form + history |
| `client/src/components/productScout/ProductScoutResults.jsx` | Cards + table |
| `client/src/utils/productScoutCompareTable.js` | Comparison table builder |
