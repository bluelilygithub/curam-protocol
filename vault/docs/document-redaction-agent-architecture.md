# Document Redaction Agent — Architecture & PRD

**Status:** Implemented (Milestones 1–6)  
**Date:** 2026-07-25  
**Audience:** Product + engineering

---

## Dependency: model inventory `execution` field

Before the document-redaction agent card can safely restrict its **local** slot, Vault `vault_models` entries must carry admin-confirmed `execution: 'local' | 'hosted'`. See Settings → AI Models and `getModelsByExecution()` in `server/services/modelResolver.js`. Do not infer locality from `provider` / `ollama:` id prefixes.

**Model card (registered):** agentId `document-redaction-agent` — settings keys `document_redaction_local_model` / `document_redaction_frontier_model`. Runtime: `resolveDocumentRedactionModels({ userId, jobId })`. Local dropdown is sourced only from `getModelsByExecution('local')` (empty list if none confirmed — no fallback).

**Milestone 1 (ingest + propose):** `POST /api/document-redaction/propose` (multipart `file` + `brief`). Pipeline in `server/services/documentRedaction/`. Returns architecture-shaped `candidates[]`; logs a summary to the server console.

**Milestone 2 (HITL):** UI `/document-redaction`. Approve / reject / edit / add-from-preview; decisions saved with the job; **Request more suggestions** feeds HITL feedback back into the local LLM only.

**Milestone 3 (apply):** `POST /api/document-redaction/jobs/:id/apply` (`confirmApply: true`). Consistent synthetic replacements via local card model; entity map in `internal/`; metadata scrub; `redacted.docx` + `sanitized.pdf`. Statuses: **`pdf_ready`** vs **`docx_ready_pdf_pending`**. Tracked changes fail-closed unless `acceptTrackedChanges: true`.

**Milestone 4 (compare / HITL₂):** Side-by-side original ↔ redacted DOCX; category-colored substitution highlights; **local LLM coherence check**; leftover real-value scan (paragraph + elided context; no `realValue` in API). **Approve for frontier** requires `sanitized.pdf` **and** zero leftovers (`PDF_REQUIRED` / `UNRESOLVED_LEFTOVERS`). **Fix leftovers** = targeted entity-map patch of `redacted.docx` (invalidates PDF). Retry PDF convert-only. No frontier API calls.

**Milestone 5 (frontier analysis):** `POST .../frontier-analyze` re-verifies live job state at call time (current `frontierApprovedAt`, PDF present, SHA256 matches `frontierApprovedPdfSha256` stamped at approve, zero leftovers) — does not trust “client already approved.” Frontier model from agent card only. Native PDF for Anthropic/Gemini; extracted-text-only for DeepSeek/Ollama; same leak guard either way. `ENTITY_LEAK_IN_PAYLOAD` (and other gate aborts) are audit-logged as `frontier_analysis_blocked` with masked hits only. Returns analysis + `frontier_suggested` candidates. Successful calls audit request/response (no keys / no PDF base64). Apply / fix-leftovers / PDF retry clear approval + SHA.

**Milestone 6 (selective apply + three-way + final):** Same HITL table for frontier suggestions. `POST .../apply` with `applyPass: 'frontier'` (shared M3 pipeline on `redacted.docx`, entity-map merge, `local-pass.docx` snapshot). Three-way compare (original / local / final) with pass-colored spans. `POST .../approve-final` → status `completed` + export package including `INTERNAL-ONLY-audit-trail.json` (gated download; may contain original values).

### Prompt 4 note — status branch (compare / HITL₂)

Milestone 4 compare UI **must branch on post-apply job status**:

| `job.status` / `pdfStatus` | Meaning | Compare UI |
|---|---|---|
| `pdf_ready` / `ready` | `redacted.docx` + `sanitized.pdf` both present | Full original ↔ redacted compare; PDF download available; frontier (M5) may proceed |
| `docx_ready_pdf_pending` / `pending` | DOCX written; LibreOffice PDF failed or unavailable | **Decided:** allow HITL₂ on **DOCX only** (original ↔ redacted compare, leftover-entity checks, approve/reject local pass). Show a persistent “PDF pending” banner + **Retry PDF conversion** (convert-only; do not re-apply redactions). **Block** frontier handoff, PDF download, three-way/PDF-side compare, and any export that requires `sanitized.pdf` until status becomes `pdf_ready`. |

**Frontier approval gates (server-side, all required):**
1. `sanitized.pdf` present (`PDF_REQUIRED`)
2. Zero leftover real-value hits in `redacted.docx` (`UNRESOLVED_LEFTOVERS`) — apply leak, not a soft warning
3. Explicit `confirm: true`

**Leftover remediation:** `POST .../fix-leftovers` patches remaining real→synthetic spans in `redacted.docx` from the entity map (invalidates PDF + clears frontier approval). Alternative: return to candidates and full re-apply.

Do not treat `ok: true` from apply as “PDF ready”. Do not hard-block the entire compare screen when PDF is pending — the redacted DOCX is enough for local coherence review.

### Prompt 6 note — selective apply reuses Milestone 3 pipeline

Applying an approved frontier suggestion **must** route through the same apply path as Milestone 3 (`applyService` / `POST .../apply`), including the tracked-changes gate, leftover re-scan, PDF status transitions (`pdf_ready` vs `docx_ready_pdf_pending`), and clearing of `frontierApprovedAt` / `frontierApprovedPdfSha256`. Do not add a second apply code path for frontier suggestions — HITL₃ only changes *which candidates* are approved; the write/export gates stay shared.

**Implemented (M6):** `POST .../apply` with `applyPass: 'frontier'` uses `redacted.docx` as base, merges entity-map entries (`appliedPass: frontier`), snapshots `local-pass.docx` before the first frontier write, and shares all M3 gates. Three-way compare + `POST .../approve-final` + `INTERNAL-ONLY-audit-trail.json` (downloadable only after final approval).

---

## 1. Goal (product summary)

A user uploads a Word (`.docx`) document and describes in natural language what to redact (intent/context, not a fixed PII taxonomy). A **local LLM** proposes a scored list of redaction candidates. The user reviews those candidates in a **HITL** UI (approve / reject / edit replacement / add missed items). After approval, the local stack applies **synthetic-but-plausible substitutions** (not black bars), keeping every instance of the same real entity mapped to one synthetic value. The user compares original vs redacted, then gives a second HITL approval on the local pass.

Only the **sanitized PDF** is sent to a **frontier model** (Claude) for residual-risk / coherence analysis. The user may selectively apply frontier suggestions. Final gate: a **three-way compare** (original / local-redacted / frontier-informed) + HITL approval + export.

**Non-negotiable privacy rule:** No sensitive raw content leaves the machine. The local entity-mapping table never leaves the machine.

---

## 2. Trust & data-flow boundaries

```text
┌──────────────────────────────── LOCAL MACHINE (trusted) ────────────────────────────────┐
│  .docx upload → ingest/scrub → local LLM candidates → HITL₁ → apply redactions          │
│       ↕ entity map (real ↔ synthetic)  ↕ audit log                                       │
│  side-by-side original | local-redacted → HITL₂ → export sanitized PDF                   │
└──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                           │ sanitized PDF only
                                           ▼
┌──────────────────────────────── FRONTIER API (untrusted for raw) ───────────────────────┐
│  Claude analysis / residual-risk suggestions (no raw entity map, no original DOCX)       │
└──────────────────────────────────────────┬───────────────────────────────────────────────┘
                                           │ suggestions (text only)
                                           ▼
┌──────────────────────────────── LOCAL MACHINE ──────────────────────────────────────────┐
│  HITL₃ selective apply → three-way compare → HITL₄ final approve → export               │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

**Allowed off-box:** redacted PDF (+ optional non-sensitive job metadata: title hash, page count, redaction *categories* without originals).  
**Forbidden off-box:** original DOCX, extracted plain text of originals, entity map, audit rows containing real values, user NL intent if it embeds secrets (prefer storing intent locally; send only sanitized excerpts if needed).

---

## 3. Component breakdown

### 3.1 Ingestion

- Accept `.docx` only in v1 (reject `.doc` / PDF-as-input unless later scoped).
- Unpack OOXML; extract:
  - **Body text** with stable location anchors (paragraph index, run index, optional bookmark/XML path).
  - **Headers/footers**, footnotes, endnotes, text boxes, tables, comments (for candidate discovery *and* scrub).
  - **Core/app/custom properties** (author, company, last modified by, etc.).
  - **Revision history / tracked changes / comments** as first-class scrub targets.
- Produce an internal **Document IR** (immutable original snapshot + mutable working copy).
- Hash original file (SHA-256) for audit; store original only on disk under a local job directory.

### 3.2 Intent interpretation

- User NL brief → structured **Redaction Brief** (local LLM):
  - goals / categories in free text
  - examples (“client names”, “invoice amounts over $X”, “internal project codenames”)
  - exclusions (“keep city names”, “do not touch statute citations”)
- Brief is **not** a closed taxonomy; it constrains prompting and scoring weights.

### 3.3 Entity / candidate extraction (local LLM)

- Chunk Document IR to fit context (overlapping windows by paragraph/section).
- Per chunk: propose candidates `{entity, category_label, spans[], confidence, rationale, suggested_replacement}`.
- Merge across chunks with **entity resolution** (string + fuzzy + type affinity) so “Jane Doe” / “J. Doe” / “Ms Doe” can collapse to one map key when justified.
- Optional deterministic helpers (regex for emails, ABN/TFN patterns, phone) as **proposal boosters**, always still HITL-gated — never silent auto-apply.

### 3.4 Scoring / weighting

Each candidate gets a composite score (0–1 or 0–100), e.g.:

| Signal | Role |
|--------|------|
| Model confidence | Primary |
| Brief alignment | Upweight if matches user intent |
| Frequency / centrality | More appearances → higher priority for review |
| Deterministic pattern hit | Boost emails/IDs when relevant to brief |
| Ambiguity / common noun risk | Downweight (“Apple” corp vs fruit) |

UI sorts by score; low-score items remain visible but collapsed.

### 3.5 HITL review layer (pass 1)

- Table/list of candidates: approve, reject, edit replacement, merge/split entities, add manual candidate (user picks text or types entity + category + replacement).
- Bulk actions by category / score band.
- Nothing is applied until user confirms this pass.

### 3.6 Redaction application engine

- Load **entity map** (approved only).
- Walk Document IR spans; replace text runs with synthetic values (**consistent** via map).
- Prefer XML-aware substitution (preserve styles/runs where possible); fall back to paragraph-level rewrite if run surgery fails.
- **Metadata scrub pass** (always, not optional): strip author/company/revision, remove comments & tracked changes (or accept “accept all then scrub” policy — see open questions), clear custom properties, remove personal info from core.xml / app.xml.
- Emit redacted `.docx` + intermediate plain-text manifest for diff.

#### Substitution target (chain-ready interface)

Apply takes a **`target` object**, not a bare style string:

```json
{
  "consumer": "human-review | frontier-logic-check | legal-disclosure | public-summary | …",
  "requirement": "must-remain-readable | must-be-unambiguously-withheld | must-preserve-aggregate-properties | must-remain-arithmetically-consistent | …"
}
```

- `consumer` / `requirement` are **free text for now** (not closed enums) so future orchestrating agents can name new consumers without a schema break.
- **Why this shape:** the eventual caller is another agent specifying *what it needs from the redacted output*. The human Settings/HITL dropdown is **one caller** that maps a friendly label → `target` (e.g. Realistic → `{ consumer: "human-review", requirement: "must-remain-readable" }`). Agent-to-agent orchestration itself is **NOT built yet** — this refactor only makes the apply interface ready.
- Optional `strategyOverride` forces a plugin id (`blackout` | `realistic` | `generalized`) when a caller disagrees with the requirement’s default mapping.
- Implementation: `server/services/documentRedaction/substitution/` (`target.js`, `strategies/*`, `arithmeticConsistency.js`, `index.js` → `generateSubstitutions`).

#### Strategy plugins (requirement → default)

| Strategy | Satisfies (default) | Behaviour |
|---|---|---|
| **`blackout`** | `must-be-unambiguously-withheld` | Token replacement (`[REDACTED_CATEGORY_N]`). No plausible fabrication. |
| **`realistic`** | `must-remain-readable` | Current behaviour: local-model plausible fakes + heuristics. |
| **`generalized`** | `must-preserve-aggregate-properties` | Buckets/ranges (`$1.1M–$1.2M`, `Major Bank`) — not a specific false fact. |

#### Arithmetic consistency (orthogonal constraint, not a strategy)

- Requirement `must-remain-arithmetically-consistent` defaults to the **`realistic`** strategy **plus** a linked-entity pass.
- **`blackout`** and **`generalized`** satisfy this requirement **for free by construction** (no precise fabricated numbers that can disagree).
- Only **`realistic`** actively rewrites linked values today.
- **Implemented relationship (minimum):** `income_surplus_capacity`  
  - `surplus′ = income′ × (surplus/income)`  
  - `capacity′ = surplus′ × (capacity/surplus)`  
- **Gaps (follow-up):** no general constraint solver; no automatic relationship discovery from the document; only currency entities with income/surplus/capacity(/buffer) category cues; multi-loan graphs unsupported.

#### Human UI status

HITL **Apply redactions** opens a style picker (Blackout / Generalized / Realistic / Realistic + linked figures) with a **before/after sample preview**. Apply defaults to fast heuristics; optional “Higher-quality names via local model” can be slow. Processing overlay includes **Cancel** (aborts the client request; server stops between apply stages when the connection closes).

### 3.7 Diff / compare view

- **Two-way:** original vs local-redacted (word/paragraph-level diff + highlight of substituted spans).
- Coherence checks (local, heuristic): broken sentences, leftover real-entity string scan against map keys, orphaned titles.
- HITL₂: approve local pass or return to candidate review.

### 3.8 PDF export (sanitized outbound artifact)

- Convert redacted DOCX → PDF **locally** (LibreOffice headless / docx-pdf pipeline — choice TBD).
- Scrub PDF metadata (author, producer if possible).
- This PDF is the **only** artifact eligible for frontier upload.

### 3.9 Frontier API integration

- Upload sanitized PDF (or text extracted from *redacted* PDF only) + a **sanitized analysis prompt** (no real names).
- Ask for: residual inference risks, inconsistent replacements, content analysis on sanitized doc, suggested *additional* redactions described by **location + category + suggested synthetic** without needing originals.
- Map frontier suggestions into local candidate objects with `source: frontier_suggested` (still no real→synthetic map leave).

### 3.10 Selective apply + three-way + final export

- HITL₃: accept/reject/edit frontier suggestions → **re-run the Milestone 3 apply pipeline** (same tracked-changes gate, leftover re-scan, PDF status transitions, approval invalidation) → new working copy. Frontier-sourced candidates are just another `source`; they must not get a separate apply path.
- **Three-way compare:** original | local-only | frontier-informed final.
- HITL₄: final approve → export DOCX and/or PDF + optional audit report (PDF of decisions with **synthetic values only**, or local-only full audit).

### 3.11 Audit log

Append-only local store: every candidate lifecycle event (created, scored, decided, edited, applied), job stage transitions, frontier call metadata (timestamp, model id, bytes sent, **not** raw content). **Blocked** frontier attempts (`frontier_analysis_blocked`) — including `ENTITY_LEAK_IN_PAYLOAD` with masked hit metadata only — are first-class audit evidence, same trail as successful `frontier_analysis` events. Support export of redacted audit summary.

---

## 4. Proposed data model

### 4.1 Job

```text
RedactionJob {
  id: uuid
  createdAt, updatedAt
  status: uploaded | extracting | proposing | hitl_candidates
        | applying_local | hitl_local_compare | exporting_pdf
        | frontier_review | hitl_frontier | hitl_final | completed | failed
  originalFilePath: local path
  originalSha256: string
  brief: { rawText, structuredNotes? }   // local only
  workingDocxPath, redactedLocalDocxPath, finalDocxPath, sanitizedPdfPath
  frontierModel?: string
  settings: { replacementStyle, scrubTrackedChangesPolicy, … }
}
```

### 4.2 Redaction candidate

```text
RedactionCandidate {
  id: uuid
  jobId: uuid
  source: local_llm | deterministic | user_added | frontier_suggested
  categoryLabel: string          // free-form from brief/model, not enum-locked
  entityKey: string              // stable id into EntityMapping (nullable until resolved)
  surfaceForms: string[]         // variants observed in doc
  locations: [{
    part: body | header | footer | comment | footnote | property
    paragraphId?: string
    runId?: string
    xmlPath?: string
    startOffset: number
    endOffset: number
    quote: string                // local only — real text span
  }]
  confidence: number             // 0–1 model self-score
  score: number                  // composite sort score
  scoreBreakdown?: object
  suggestedReplacement: string
  userReplacement?: string       // wins when set
  decision: pending | approved | rejected | edited
  decisionAt?: iso
  decidedBy: user
  rationale?: string             // model or user note
  createdAt, updatedAt
}
```

### 4.3 Entity mapping table (local-only, never transmitted)

```text
EntityMapping {
  id: uuid
  jobId: uuid
  entityKey: string              // canonical key
  realValue: string              // sensitive — local disk/DB only
  syntheticValue: string
  categoryLabel: string
  consistencyGroup: string       // same group → same synthetic
  approvedCandidateIds: uuid[]
  createdAt, updatedAt
}
```

**Rule:** Frontier payloads and any “shareable” audit export must strip `realValue` and location `quote` fields, or substitute with synthetic + location indices only.

### 4.4 Audit event

```text
AuditEvent {
  id: uuid
  jobId: uuid
  at: iso
  actor: user | local_llm | frontier | system
  type: candidate_created | candidate_scored | candidate_decided
      | mapping_upserted | redaction_applied | metadata_scrubbed
      | compare_approved | pdf_exported | frontier_called
      | frontier_suggestion_imported | final_approved
  candidateId?: uuid
  payload: object                // prefer synthetic / ids; avoid real values in exportable views
}
```

---

## 5. Recommended local model choice

**Primary recommendation (v1):** **Qwen2.5-14B-Instruct** (or **Qwen2.5-32B-Instruct** if the machine has ≥24GB VRAM / unified memory headroom), served via **Ollama**.

**Why:**

| Criterion | Notes |
|-----------|--------|
| NER / structured extraction | Strong instruction following for JSON candidate lists vs older 7B class; better at “follow this brief” than pure classic NER tags. |
| Ollama / LM Studio | First-class Ollama support; easy local swap. LM Studio equally fine if you prefer GUI server. |
| Context window | 32k-class usable in practice for chunked docs; still **chunk** long DOCX (full-doc single-shot is fragile and slow). |
| Consistency | Good enough for replacement *proposals*; **authoritative consistency is the entity map**, not the model’s memory. |
| Privacy | Weights and inference stay local. |

**Alternatives:**

- **Llama 3.1 8B / 70B:** 8B is lighter but weaker on nuanced brief alignment; 70B is excellent if hardware allows.
- **Gemma 2 27B:** solid instruction model; slightly less “enterprise doc” folklore than Qwen for some users.
- **Dedicated NER (spaCy / GLiNER) + LLM:** hybrid for v1.5 — deterministic/GLiNER proposals + LLM for brief-conditioned categories and synthetic replacements. Worth planning as an enhancement, not a blocker.

**Not recommended as sole engine:** tiny 3B models for full-doc redaction candidate quality; cloud “local-feeling” hosts that still exfiltrate text.

**Replacement generation:** same local model, constrained by category + style (“AU realistic names”, “plausible ABN format”) and uniqueness checks against other synthetics in the map.

---

## 6. HITL stages (explicit gates)

| Gate | Purpose |
|------|---------|
| HITL₁ | Candidate list decisions |
| HITL₂ | Original vs local-redacted coherence |
| HITL₃ | Selective frontier suggestions |
| HITL₄ | Three-way final approve + export |

No stage auto-advances past a gate without explicit user action.

---

## 7. Non-functional requirements (draft)

- **Local-first:** default deploy = desktop or Vault feature with “local LLM required”; frontier optional and clearly labeled.
- **Crash safety:** job folder + SQLite (or JSONL audit) so refresh doesn’t lose map/decisions.
- **Performance:** stream candidate proposals per chunk; show progress.
- **Failure modes:** frontier timeout must not corrupt local artifacts; PDF export failure blocks frontier step.

---

## 8. Open questions (need answers before build)

1. **Host context:** Standalone desktop app, Curam Vault feature, or CLI+local UI? This drives auth, storage paths, and whether Ollama is assumed on the same machine as the browser.
2. **Hardware target:** Typical RAM/VRAM (Apple Silicon unified memory size vs NVIDIA)? Decides 14B vs 32B/70B default.
3. **DOCX fidelity bar:** Must we preserve complex layouts (text boxes, embedded Excel, content controls) or is “body + tables + headers” enough for v1?
4. **Tracked changes policy:** **Decided — fail-closed.** If the DOCX contains tracked changes (`w:ins` / `w:del` / moves), apply returns **409 `TRACKED_CHANGES`** and does not mutate the file unless the client re-submits with **`acceptTrackedChanges: true`** (explicit accept-all-then-scrub). Silent accept is not allowed.
5. **Synthetic style:** Locale (AU/US), tone (realistic vs obviously fake tokens like `PERSON_A`), and whether replacements must pass format validators (email/ABN).
6. **Partial redaction UX:** If user rejects a candidate that shares an `entityKey` with approved spans, do we split the map or force all-or-nothing per entity?
7. **Frontier input:** PDF upload to Claude vs text extracted from redacted PDF only? (PDF may re-introduce metadata or OCR issues.)
8. **Frontier suggestion apply:** May Claude propose redacting text that was *not* in the sanitized doc (inference)? If so, do we only allow suggestions that point at still-visible sanitized strings?
9. **Re-identification / “unredact”:** Is the entity map a deliberate recovery feature for the owner, or encrypted-at-rest with passphrase, or destroy-on-export?
10. **Audit retention & export:** Full local audit with real values forever, or auto-purge `realValue` after N days? Legal/compliance audience?
11. **Multi-user:** Single operator per job, or review/approve roles?
12. **Success metric for v1:** Time-to-first-approved-PDF, residual-leak rate in self-tests, or layout fidelity?

---

## 9. Suggested build order (after approval)

1. Ingest + metadata scrub + DOCX round-trip without LLM  
2. Candidate schema + HITL₁ UI with manual candidates only  
3. Local LLM proposal pipeline + scoring  
4. Apply engine + entity map consistency + two-way diff (HITL₂)  
5. PDF export + frontier analysis + HITL₃/₄ three-way  
6. Hardening: chunking quality, hybrid NER, adversarial residual-leak tests  

---

## 10. Out of scope for v1 (recommended)

- Image/OCR redaction inside DOCX  
- `.doc` binary Word  
- Automatic apply without HITL  
- Sending original or entity map to any cloud  
- Legal certification / formal DPIA (can be parallel track)

---

*End of architecture draft — revise after open questions are answered; then proceed to implementation PRD / tickets.*
