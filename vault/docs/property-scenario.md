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

---

## API

All under `/api/property-scenario` (auth + `requireFeature('propertyScenario')`).

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/demo` | Fixture compound sell→buy→switch + Stage 6 presentation (+ CDR when available) |
| `POST` | `/parse` | `{ text, asOf? }` → `runFromText`; LLM failures → `{ ok:false, error:'parse_failed' }` (422) |
| `POST` | `/clarify` | `{ scenario, answers?, selling_cost_pct?, … }` → re-validate → calculate when ready |
| `GET` | `/lenders` | CDR PRD rows (`live=0` for stubs; `refresh=1` bypass cache) |
| `POST` | `/cdr/refresh` | Clear CDR cache and refetch |
| `POST` | `/insights` | `{ product\|product_id, question }` — cited document Q&A |
| `POST` | `/insights/compare` | `{ products\|product_ids, question }` — multi-doc compare |
| `POST` | `/calculators/*` | Standalone repayment / extra-repayments / offset / borrowing-power |
| `POST` | `/calculators/buyer-qualify` | Lite buyer qualification (serviceability, LVR, DTI, genuine savings, FHBG) |
| `POST` | `/calculators/qualification-proforma` | Full broker-style proforma: strict + levers + excluded + CDR lenderFit + curated `bankPosture` |

---

## Qualification proforma

Primary homepage path for “will a bank look at this file?”. Builds on the same strict engine as the lite qualify check (`buyerQualification.js`), then adds:

| Layer | Source | What it is |
|-------|--------|------------|
| **Strict** | Deterministic AU rules | Serviceability (incl. shaded overtime/bonus + self-employed add-backs), LVR, DTI, genuine savings (holding period + gift portion), employment tenure, FHBG/FHOG, etc. |
| **Levers** | `qualificationProforma.js` | Risk-rated presentation / timing / lender-selection choices — never invent income or hide debts |
| **Excluded** | Static list | Misrepresentation / NCCP fraud line — shown for transparency |
| **Bank posture** | `bankPosture.js` | Curated broker knowledge per major lender (tenure windows, self-employed appetite, overtime shading). **Not** CDR and **not** a credit decision |
| **Lender fit** | CDR PRD | Live published products/rates for the loan purpose — product publication only |

**Journey:** Buy / Quick qualify / Refinance results can **Continue to qualification proforma** with prefilled fields. PDF download includes bank posture + CDR fit.

**Honesty:** CDR cannot simulate credit committees. Bank posture is editorial/indicative. Overtime irregular → 0% in strict (conservative); 1yr → 50%; 2yr → 80%.

---

## UI modes

1. **Describe your situation** — textarea → Analyse → clarifying form → Stage 6 results when ready  
2. **See an example** — deterministic fixture demo (fast reference)  
3. **Lenders tab → Ask about a lender's terms** — dashed exploration panel; never feeds scenario maths

---

## Honesty rules (do not relax)

- Numeric/date values in parse output must match pre-extracted spans or be stripped  
- `term_remaining_months` ≠ `fixed_period_remaining_months` — never copy one into the other  
- Bridging: `requires_user_decision: true`; refuse-until-clarified is default; IO cost is secondary  
- CDR: special-eligibility products excluded from mainstream comparison; per-row MOCK/CDR provenance; fees labeled estimated  
- Insights: every claim needs a document quote/location; otherwise `uncited_gaps` — locked `INSIGHT_DISCLAIMER`

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
