# Property Scenario (Mortgage Agent)

Natural-language mortgage / property scenario tool: describe a refinance, sale, purchase, or lender switch in plain English → structured scenario → deterministic Australian calc modules → charts/tables → optional CDR live rates and quarantined T&Cs/PDS insights.

**UI:** `/property-scenario` (Apps → Finance tools)  
**Feature flag:** `propertyScenario`  
**Open/deferred work:** `server/services/propertyScenario/OPEN_ITEMS.md`

---

## Architecture (isolation matters)

Two different kinds of work live side by side — do not merge their outputs.

| Path | Nature | May change scenario totals? |
|------|--------|-----------------------------|
| **Scenario pipeline** (Stages 1–10) | Parse → ground → clarify → orchestrate → present | Yes (deterministic calc once ready) |
| **Document insights** (Stage 11) | Fetch lender T&Cs/PDS → cited Q&A | **No** — informational only |

Same honesty bar as bridging modelling: indicative / exploratory results never silently enter `totals`.

```
Free text
   │
   ├─ extractSpans (deterministic currency/％/duration/dates)
   ├─ LLM assign spans → Scenario           [probabilistic]
   ├─ grounding strip unspanned invents     [deterministic rules]
   ├─ clarify answers
   └─ orchestrate Stage 3 calcs → presentation (charts/tables)

CDR PRD lenders ──► comparison table / charts
                 └─→ insights/ (PDS fetch + cited answers)  ✦ quarantine
```

---

## Stages (what lives where)

| Stage | Responsibility | Key files |
|-------|----------------|-----------|
| 1 | Scenario / loan / event data model | `scenario.js`, `constants.js`, `validate.js` |
| 2 | NLP parse + clarifying questions | `parseScenario.js`, `parsePrompt.js` |
| 3 | Stamp duty/LMI, CGT, refinance, early payout | `calc/*` |
| 4 | Event orchestration + dependency cash flow | `orchestrate.js`, `runPipeline.js` |
| 5 | Standalone repayment / offset / borrowing power | `calc/repayment.js`, `offset.js`, … |
| 6 | Charts, tables, follow-ups UI | `presentation.js`, client `PropertyScenario*` |
| 7 | Live CDR Product Reference Data rates | `cdr/*` |
| 8 | Bridging modelling (refuse-default + indicative IO) | `calc/bridgingCost.js` |
| 9 | Deterministic pre-extraction spans | `extractSpans.js`, grounding span checks |
| 10 | Wire `runFromText` to HTTP + Describe UI | `wireApi.js`, routes `/parse` `/clarify` |
| 11 | Quarantined document insights | `insights/*` |
| 12 | Follow-up conversation + what-if mutation | `whatIf.js`, routes `/advice/ask` `/advice/what-if` |

---

## API

All under `/api/property-scenario` (auth + `requireFeature('propertyScenario')`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/demo` | Fixture compound sell→buy→switch + Stage 6 presentation (+ CDR when available) |
| `POST` | `/parse` | `{ text, asOf? }` → `runFromText`; LLM failures → `{ ok:false, error:'parse_failed' }` (422) |
| `POST` | `/clarify` | `{ scenario, answers?, selling_cost_pct?, … }` → re-validate → calculate when ready |
| `GET` | `/lenders` | CDR PRD rows (`live=0` for stubs; `refresh=1` bypass cache); includes `average_variable_rate_pct` when live |
| `GET` | `/market-rate` | OO variable + fixed averages for form defaults (`variable_rate_pct`, `fixed_rate_pct`; optional `?type=fixed|variable` mirrors into `rate_pct`; warm cache or stub, 6.1%/5.5% fallbacks) |
| `POST` | `/cdr/refresh` | Clear CDR cache and refetch |
| `POST` | `/insights` | `{ product\|product_id, question }` — cited document Q&A |
| `POST` | `/insights/compare` | `{ products\|product_ids, question }` — multi-doc compare |
| `POST` | `/advice/ask` | `{ question, calcResult, scenarioType, history? }` — explain-only Q&A grounded in calc totals; `history` (last 6 Q&A pairs) threads prior turns into the prompt for multi-turn follow-up. Never changes totals. |
| `POST` | `/advice/what-if` | `{ scenario, question }` — exploratory recalculation. LLM maps the question to a whitelisted field change only (never invents a path); applies via the same `applyClarifications` as clarify, recalculates on a clone. Returns `original_totals` vs `what_if_totals`. Original scenario/calc untouched. |
| `POST` | `/calculators/*` | Standalone repayment / extra-repayments / offset / borrowing-power |
| `POST` | `/calculators/buyer-qualify` | Lite buyer qualification (serviceability, LVR, DTI, genuine savings, FHBG) |
| `POST` | `/calculators/qualification-proforma` | Full proforma: strict + levers + `leversDelta` + `bankPanel` (capacity + CDR) + supplement |
| `GET` | `/proformas` | List this user's saved proforma runs (summary rows), most recently updated first |
| `GET` | `/proformas/:id` | Full saved record (inputs + result) to resume |
| `POST` | `/proformas` | `{ id?, clientName, inputs, result? }` — create, or update when `id` is this user's own row |
| `DELETE` | `/proformas/:id` | Delete a saved run |

---

## Qualification proforma

Primary homepage path for “will a bank look at this file?”. Builds on the same strict engine as the lite qualify check (`buyerQualification.js`), then adds:

| Layer | Source | What it is |
|-------|--------|------------|
| **Strict** | Deterministic AU rules | Serviceability (incl. shaded overtime/bonus + self-employed add-backs), LVR, DTI, genuine savings (holding period + gift portion), employment tenure, FHBG/FHOG, etc. |
| **Levers** | `qualificationProforma.js` | Risk-rated presentation / timing / lender-selection choices — never invent income or hide debts. `leversDelta` stacks indicative capacity uplifts. |
| **Excluded** | Static list | Misrepresentation / NCCP fraud line — shown for transparency |
| **Bank panel** | `bankPosture.js` + CDR | Merged row per bank: **Fit** tier + **numeric score** (strong/fair/weak/unsuitable from capacity headroom + LVR/DTI + posture knobs), full **score breakdown** (expandable factor table per bank), sensitivity note, **per-bank indicative capacity** shown as ±3% range, **assessment rate floor** per bank (most 8.50%; Macquarie 8.65%, BOQ 8.55%), OT shade, documents list, live rate when CDR matches. Fit ≠ overall PASS/FAIL and is **not** a credit decision. PDF/UI include a Fit legend. |
| **Adverse simulation** | `bankPosture.js` (second run) | When `hasAdverseCredit` is false in the submitted inputs, `buildQualificationProforma` runs `buildBankPostureFit` a second time with `hasAdverseCredit: true`. Result returned as `bankPanelAdverse` / `bankPostureAdverse`. UI exposes a toggle ("Simulate: 1 adverse event") that switches the panel view and shows per-bank score delta and capacity delta. PDF renders a comparison table. |
| **Supplement** | `proformaSupplement.js` | Rate stress, product-fit guidance, income stress caveats, post-settlement cashflow |

**Per-bank capacity:** `estimateBankCapacity()` reuses surplus → max-loan maths with each bank’s curated knobs (`overtimeCrediting` → shade %, `rentalShadingPct`, `hemStance`). Assessment rate is `max(targetRate + 3.0, bank.assessmentFloorRate)` — each bank carries its own floor (8.50% for most; 8.65% Macquarie, 8.55% BOQ). The floor only binds when the product rate is low enough that adding 3% does not reach it. Always labelled indicative — not a quote or approval.

**Save / resume:** Client name field + Save/Update button on the proforma form, backed by `property_scenario_proformas` (userId-scoped). **Previous runs** panel lists saved rows (client name, status, loan amount, updated date), click to reload every field plus the last computed result, inline Yes/No delete per row.

**Journey:** Buy / lite qualify / refinance can **Continue to qualification proforma** with prefilled fields. Completing the **proforma** (or lite check) writes a shared browser **file profile** (`vault:propertyScenario:fileProfile`) that pre-fills related fields on every other agent (buy, sell, refinance, calculators, NLP state/PPOR, lite qualify). Homepage cards are grouped: Check my file · Plan a transaction · Quick tools.

**PDF:** Executive summary (verdict, loan vs capacity, top actions) → severity-ordered checks + levers delta → bank panel detail (fit, score breakdown, indicative capacity with assessment floor, reasons) → adverse credit simulation comparison table (when `bankPanelAdverse` is present) → supplement pages. Special characters in check text are ASCII-normalised for Helvetica (`>=`, `<=`, `->`).

**Honesty:** CDR cannot simulate credit committees. Bank capacity dollars move because curated knobs differ — they are not underwriting. Overall status is **lending checks only** — FHOG/FHBG ineligibility is never a loan block. QLD PPOR home concession applies independently of FHB status. Under-declaring expenses to HEM is excluded/compliance — never a lever with a dollar upside.

---

## UI modes

Homepage (Describe path) scenario cards:

1. **Check my file** — Qualification proforma (featured) · Lite serviceability check  
2. **Plan a transaction** — Refinance · Buy · Sell · Multiple events (NLP)  
3. **Quick tools** — Standalone calculators  

Each card has an **info** control that opens a purpose modal (what it does / doesn’t, best for).

**Interest rate defaults:** Every interest-rate input asks **Rate type** (variable/fixed) first where relevant. The rate field then defaults to the matching OO average from `GET /market-rate` (`variable_rate_pct` / `fixed_rate_pct`, with 6.1% / 5.5% fallbacks). Changing type updates the rate if the user hasn’t overridden it. NLP clarify forms follow the sibling `fixed_or_variable` answer. Buy/sell have no rate fields. **State** selects default to **QLD**.

Also:

4. **See an example** — deterministic fixture demo  
5. **Lenders tab → Ask about a lender's terms** — dashed exploration panel; never feeds scenario maths

---

## Honesty rules (do not relax)

- Numeric/date values in parse output must match pre-extracted spans or be stripped  
- `term_remaining_months` ≠ `fixed_period_remaining_months` — never copy one into the other  
- Bridging: `requires_user_decision: true`; refuse-until-clarified is default; IO cost is secondary  
- CDR: special-eligibility products excluded from mainstream comparison; per-row MOCK/CDR provenance; fees labeled estimated  
- Insights: every claim needs a document quote/location; otherwise `uncited_gaps` — locked `INSIGHT_DISCLAIMER`
- What-if (Stage 12): LLM may only assign a value to a field_path drawn from a server-built whitelist of the scenario's existing editable leaves — any other path is dropped, not applied. Runs on a clone; the on-screen scenario/calc is never mutated.

---

## Tests

```bash
npm run test:property-scenario              # data model
npm run test:property-scenario-spans
npm run test:property-scenario-grounding
npm run test:property-scenario-calc
npm run test:property-scenario-standalone
npm run test:property-scenario-bridging
npm run test:property-scenario-orchestrate
npm run test:property-scenario-presentation
npm run test:property-scenario-cdr
npm run test:property-scenario-wire
npm run test:property-scenario-insights
npm run test:property-scenario-insights-live   # real bank docs (network)
npm run test:property-scenario-cdr-live
npm run test:property-scenario-e2e             # live LLM parse (needs ANTHROPIC_API_KEY)
```

---

## Environment

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY` | Parse + insights (or model from `vault_models` / `PROPERTY_SCENARIO_MODEL`) |
| `PROPERTY_SCENARIO_MODEL` | Optional override for parse |
| `PROPERTY_SCENARIO_INSIGHT_MODEL` | Optional override for insights |
| *(none for CDR PRD)* | Public unauthenticated Product Reference Data |

Uses admin/user `vault_models` + `default_model` via `getModelsForUser` when `userId` is present on the request.

---

## Browser verification still open (W1)

Routes and UI for live `runFromText` are deployed. **Fully closing W1** still requires a signed-in Railway walkthrough: Describe → clarify → confirm Stage 6 charts/tables from a non-fixture result. Until then treat browser acceptance as open — see `OPEN_ITEMS.md`.
