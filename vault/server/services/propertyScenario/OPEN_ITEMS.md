# Property Scenario Agent — Open items

Tracked gaps that are **not blocking** the next independent stage, but must not be silently assumed done.

Last updated: 2026-07-15 (Stage 11 — document insight layer added; W1 browser click-through still open)

---

## Open — Stage 11 (additive)

### I1. Document / insight reasoning — **shipped; live browser + multi-bank doc fetch still to harden**

**Status:** Module + routes + Lenders-tab UI added. Structurally quarantined from Scenario/calc/orchestrator.

**Done:**

- `server/services/propertyScenario/insights/` — fetch/extract PDF|HTML, cache, `buildInsight`, `compareInsights`
- Citation enforcement (uncited claims stripped); locked `INSIGHT_DISCLAIMER`
- Structural isolation test (no imports into `scenario` / `orchestrate` / `calc/`)
- `POST /api/property-scenario/insights` + `/insights/compare`
- UI: “Ask about a lender's terms” under Lenders tab only (dashed exploration panel — not Scenario/Charts maths)
- Live probe (2026-07-15): 3/3 doc fetches (CommBank UTC PDF 35pp + Westpac HTML); Q&A on Digi Home Loan returned cited findings + explicit uncited_gaps; disclaimer locked

**Still watch:**

- Some CDR “terms” links are marketing HTML, not full PDS — insight already labels `kind=` and gaps when clause text is missing
- Browser verification of the Ask panel on Railway (depends on W1 login path)
- Not yet deployed with Stage 11 commit (ship with next `version-7` push)

---

## Partially closed — Stage 10

### W1. Live app never called `runFromText` — **routes/pipeline closed; browser click-through still open** (2026-07-15)

**Status:** Split deliberately.

| Layer | Status |
|---|---|
| `runFromText` HTTP wiring (`POST /parse`, `POST /clarify`) + structured LLM errors | **Closed** |
| UI code path (textarea → clarifying form → Stage 6 presentation reuse) | **Shipped in code** |
| Browser click-through against a deployed Vault (type → answer → see live charts/tables) | **Open until verified** |

Do **not** treat W1 as fully done from server smoke tests alone. Stages 1–9 already showed that fixture/unit confidence without exercising the real product path creates false closure. The only acceptance for the browser side is: a person opens `/property-scenario`, describes a situation, answers clarifying questions, and sees Stage 6 populate from that live (non-fixture) result.

**What was wrong**

- `GET /api/property-scenario/demo` → fixture only
- No `POST` that accepted free text
- UI had “Reload demo” only — no textarea, no clarify form
- LLM / malformed-JSON failures from `parseScenario` would have been unhandled 500s if ever wired naively

**Done (pipeline / routes)**

- `POST /api/property-scenario/parse` — body `{ text, asOf? }` → `executeParse` → `runFromText`; structured `{ ok: false, error: 'parse_failed' }` on LLM/JSON failure (HTTP 422, never bare 500)
- `POST /api/property-scenario/clarify` — in-progress scenario + answers → re-validate → orchestrate when ready
- UI code: **Describe your situation** path alongside kept **See an example** fixture demo
- Clarifying form also surfaces **validation errors** as editable rows when assumptions are empty
- `applyClarifications` refuses to overwrite nested objects (loan snapshots) with scalar form answers
- `wireApi.js` + `wireApi.test.js` + `test:property-scenario-wire`
- Live server smoke: `executeParse` against ground-truth compound text returned sell/buy/switch + clarifying form

**Still required to fully close W1**

- Deploy to Railway (`version-7`)
- Browser walkthrough on production: Describe → analyse → answer form → confirm Stage 6 charts/tables/summary render from the live pipeline (not demo fixture)
- Only then flip this item to **closed** with date + what was typed / observed

**Explicitly out of scope**

- Changing parse / grounding / orchestrator internals (Stage 10 is wire-up only)
- Persisting scenarios to DB / multi-turn chat history

---

## Closed — Stage 4 / Stage 8

### O1. Buy-before-sell / negative-gap (bridging finance) — **closed** (2026-07-15)

**Status:** Detection (Stage 4) + banner (Stage 6) + product modelling (Stage 8) done.

**Done:**

- Orchestrator sets `bridging_required`, `deposit_shortfall`, `funding_alert` when buy is sequenced before a `funds_deposit` sell (or proceeds are insufficient)
- Stage 8 `bridgingCost.js` returns **both** paths always: default `refuse_until_clarified` + supplementary `bridging_loan` (indicative IO interest)
- Combined result sets `requires_user_decision: true` and `ready: false` when a funding gap is present (same honesty bar as Stage 2 `ready_for_calculations`)
- Stage 6 `FundingAlertBanner` is input-first ("your decision needed"); indicative cost is expandable/secondary, not the headline
- Tests: worked interest example, refuse-default, orchestrator wiring, presentation banner payload

**Explicitly out of scope (will not reopen O1 for these):**

- Bridging **eligibility / serviceability** modelling (stated as caveats only)
- Peak-debt product pricing, establishment fees, lender policy overlays
- NLP `source_text` fixture for buy-before-sell (optional Stage 2 hardening — see D1)

---

## Stage 7 notes (CDR PRD)

**Done:** Public PRD adapter (`server/services/propertyScenario/cdr/`), version negotiation, `RESIDENTIAL_MORTGAGES` filter, normalize → Stage 6 schema, demo/lenders API + UI coverage banner, 1h cache.

**Known bank quirks (graceful, not blockers):**

- `x-v` differs by bank **and** by endpoint (list vs detail) — client negotiates per request
- Westpac rejects `page=1` (422); first page must omit `page`
- Incomplete fees/features/`max_lvr` common — fields left null / estimated, never invent rates
- Special-purpose products (Sustainable Upgrades, Defence Force, SMSF, bridging, etc.) are **excluded** from the mainstream comparison table; badge is a UI backstop if one surfaces. Prefer omit-bank over showing a misleading restricted rate.

**Honesty labels:**

- Per-row `provenance` / `MOCK`|`CDR` badge — no silent live+mock blend
- Upfront/life-cost fees shown as **estimated** for CDR rows (heuristic fee sum, not a quote)

**Optional next:** NLP on PDS links, broader than big-8 bank set, optional “show restricted products” toggle.

---

## Closed — Stage 9 / Stage 2

### D1. NLP extraction hardening (deterministic pre-extraction) — **closed** (2026-07-15)

**Status:** Closed via Stage 9 pre-extraction + span-backed grounding.

**Done:**

- `extractSpans(text)` finds literal currency / percent / duration / date spans (chrono-node for relatives) with character positions — no field assignment
- `parseScenario` feeds spans into the LLM as an assignment list; framing is assign + flag qualitative gaps, not invent numbers
- `groundScenarioAgainstText` strips any remaining inventsed money/rate/date that has no matching span (same honesty bar as state/PPOR/term stripping)
- Duration spans also reinforce loan term/fixed-period grounding
- Unit tests cover extraction, invented-number strip, and “span present even if LLM omits assignment”

**Still optional (not reopening D1):**

- Schema-strict / tool-use parse
- Broader few-shot packs without `replace_scenario`
- Dedicated buy-before-sell NLP `source_text` fixture

---

## How to use this file

- New gaps that are acknowledged but not fixed in the same session → add a numbered item here (`O*` orchestration, `D*` deferred NLP, `C*` calc, `W*` wire-up, etc.)
- Closing an item requires tests that assert the **behaviour** in “Correct behaviour when closed”, or an explicit “won’t do / out of scope” note with date
- Prefer linking a fixture id or test name in the acceptance checks
- Vague “add a test for X” is not enough — spell out what the user must see vs forbidden silent outcomes
