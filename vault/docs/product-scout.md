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

1. **Rainforest API** — plain Amazon search (top 8–10), not sponsored picks
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

- **Key specs** — measurable requirements for **this product category** (LLM picks labels, units, and quick-pick options — e.g. laptop RAM, headphone battery hours, camera sensor size). Quick-pick chips + custom value. Marked *Not important* to skip.
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

**Server:** `productScoutGuideService.js` (`buildBriefPrompt`, `formatFeatureRequirement`) passes must-have specs into tier scouting via `shopperPriorities` on `executeScoutComparison`.

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
