# Translate agent

Professional document translation at **`/translate`**. Upload a source file, answer short intake questions, then Vault LLMs prepare a glossary, translate in chunks, optionally run a QA review, and the browser builds a bilingual PDF.

**Frontend:** `vault/client/src/pages/TranslatePage.jsx`  
**Backend:** `vault/server/routes/translate.js`  
**Services:** `translateLlmService.js` · `translateModelResolver.js` · `translateExtract.js` · `translateQaChecks.js` · `googleTranslateService.js`  
**Tables:** `translate_jobs`, `translate_glossaries`  
**Settings:** Translate agent card — `translate_model` / `translate_review_model` (fallback: vault default + secondary tier)

Feature flag / app: **Translate** (languages).

---

## Engines

Choose per job:

| Engine | When to use | Needs |
|---|---|---|
| **Vault LLM** | Domain tone, glossaries, te reo Māori policy, QA review | Translate model in Settings |
| **Google Translate** | Fast drafts / common languages (~seconds not minutes) | `GOOGLE_TRANSLATE_API_KEY` |

Google skips LLM glossary prep; uses language detect + saved/must-keep glossary. Optional LLM QA review can still be enabled after Google.

LLM translate chunks ~20 paragraphs / ~8000 chars per call and runs **up to 8 chunks in parallel** (`TRANSLATE_LLM_CONCURRENCY`, default 6) with a **45s per-call timeout**, so a stuck model call fails over to split/retry instead of hanging the job. QA review batches (35 pairs each) also run in parallel (`TRANSLATE_REVIEW_CONCURRENCY`, default 4). Still slower than Google on large docs — use Google when speed matters.

## PDF layouts

| Layout | Output |
|---|---|
| **Side by side** | Original and translation in two columns on the same page |
| **Separate translated document** | Translation pages only |
| **Bilingual pages** | Full original page, then full translation page (legacy) |

---

## Supported uploads

| Format | Extensions | Notes |
|---|---|---|
| PDF | `.pdf` | Native text + OCR for scanned pages (client preflight renders page images) |
| Word | `.docx` | Paragraph text via mammoth. Legacy `.doc` is rejected — save as `.docx` |
| Excel | `.xlsx`, `.xls` | Text cells only (numbers skipped). Each sheet is a section; cells prefixed `[A1]`-style |

Max size: **15 MB**. Google Docs / Sheets: export as `.docx` / `.xlsx` then upload (no Drive OAuth).

Download filename: `translated-{basename}.pdf` (layout chosen per job).

---

## Pipeline

1. **Upload + intake** — domain (required), audience, tone, must-keep terms, notes; optional saved glossary; optional review pass.
2. **Extract** — `translateExtract.extractForTranslate` → `paragraphsByPage` (+ OCR for sparse PDF pages). PDF line-extraction groups text by y-position, which can chop a sentence mid-way on documents with uneven line leading (headers, table-like layouts). `translateExtract.stitchFragments` runs immediately after: a fragment with no terminal punctuation (`.!?:;"”)]`) is merged into the next one unless that next fragment looks like a fresh sentence/field start. This keeps "paragraphs" close to real sentences before chunking — fewer, cleaner segments, and no more mid-sentence grammar breaks at chunk/segment boundaries. Not applied to `.docx` (already splits on real blank-line breaks) or spreadsheets (cell values, `[A1]`-tagged — stitching would merge unrelated cells).
3. **Glossary prep + term locking (one call, LLM engine only)** — `translateLlmService.proposeGlossary` proposes/merges terms from intake + text skim + saved glossary, AND assigns canonical renderings to recurring defined-term candidates in the same call. Candidates come from `translateQaChecks.detectRepeatedTermCandidates` (a pure string scan, computed before the call — no LLM cost), which flags ordinary (non-brand) words/phrases that read as defined terms — `Warranty Schedule`, `Nominated Vehicle`, `Period`, `Make` — the kind too ordinary for a glossary skim to notice on its own, but exactly what drifts between chunks because nothing pins them down. A phrase qualifies on any of three signals: it recurs **mid-sentence** (≥2×, not just at sentence starts — plain capitalization isn't a signal on its own); it recurs as a **standalone paragraph** (≥2×, e.g. a field label like `Make` / `Model`); or it's immediately followed by a **definition marker** (`means`, `refers to`, `is defined as`, `has the meaning`) — this alone qualifies it even on a single occurrence, catching a term that's only ever introduced once per definition clause (`"Warranty Schedule means..."`) and never referenced inline elsewhere. (This used to be two sequential LLM calls — `proposeGlossary` then a separate `lockRepeatedTerms` — merged into one to remove a full serial round-trip from every job before translation starts.)
4. **Translate** — chunked paragraph batches via `callModel` + glossary substitutions. Paragraphs that look like leaked code/template debris (e.g. a serialized object dump, an unresolved internal token) are detected (`translateQaChecks.isCodeLikeArtifact`) and copied through verbatim instead of being sent to the translator.
5. **Glossary drift report (LLM engine only)** — `translateLlmService.reportGlossaryDrift`. Chunks translate in parallel with no shared state between them, so even a term every chunk was told the same rendering for can still land two different ways in two different chunks. This is pure string comparison (no LLM calls, no added latency) — it finds pairs whose source contains a forced glossary term but whose target doesn't contain that term's canonical rendering, and surfaces them in the QA summary's uncertain terms rather than guessing at a fix. (An earlier version re-translated drifted segments with an LLM call each — it added real wall-clock time without reliably fixing anything, since the retry could just as easily pick a different wrong synonym. Visible-but-unfixed beats slow-and-still-wrong.) For a document type you translate repeatedly, the durable zero-latency fix for a term that keeps drifting is to add it to your saved glossary (Settings) with the rendering you want — that skips detection entirely and is honoured from the first chunk.
6. **Hard sanity gate (deterministic)** — `translateQaChecks.hardSanityGate` on every source⟶target pair. If too many segments are identical to source (>30%), contain placeholders (≥2 or >5%), or are empty (>10%), the job **fails** with an error and a QA summary — no bilingual PDF.
7. **Review (optional)** — deterministic completeness runs first on **all** pairs (auto “Garbled / incomplete rows”); then the review model compares every pair side-by-side in batches for subjective issues; claim verification spot-checks a sample of “None flagged” segments.
8. **Client PDF** — `@react-pdf/renderer` bilingual PDF uploaded to complete the job.

Job stages: `pending` → `extracting` → `ocr` (PDF only) → `preparing` → `translating` → `reviewing` → `generating` → `done` / `failed`.

### Speed notes

Each pipeline stage above is a full serial barrier — it waits for the entire previous stage (including its single slowest call) before starting. Steps 1-3 above collapse what used to be two sequential single-call round-trips into one. The remaining biggest lever: step 7 (review) currently waits for the *entire* document to finish translating + repairing before reviewing any pair, even though most chunks typically finish translating well before the slowest one — streaming review per completed chunk-group instead of one call over the whole document would be the next real win, but is a larger restructuring of the stage-barrier shape, not done yet.

Model choice (`translate_model` / `translate_review_model` in Settings) is resolved entirely from this workspace's own `vault_models` catalog — there's no hardcoded fallback id. If a job's QA summary shows a `-preview` model id for the review slot, prefer a GA (non-preview) equivalent when one's available in the catalog: preview endpoints commonly carry tighter rate limits / more latency variance than a GA release, which can show up as an occasional slow tail in the review stage. This is a Settings change, not a code change.

### Completeness rules (per segment)

Before any subjective LLM check, each target must be:

- **(a)** non-empty  
- **(b)** different from the source (after normalize), except non-linguistic cells / same-language jobs  
- **(c)** free of placeholders such as `[Translation incomplete]`, `[unable to translate]`, `TBD`, `TODO`, etc.

Hard-fail only when **>25%** of segments still have placeholders (mass failure). Moderate rates complete with a soft warning and Garbled rows listed. `[REDACTED]` must pass through unchanged (locked DNT + post-process). Deterministic checks also flag **bracketed process meta** in any language (e.g. `[texto no disponible para traducir]`), not only English `[Translation incomplete]`. Incomplete segments get a **repair pass** (LLM retry → optional Google fallback) before the gate.

**Non-determinism:** LLM runs of the same document can differ. Treat one clean run as a sample, not proof the instructions “worked.” Prefer stronger models for finals; turn review off for drafts (review does not fix polarity/meta reliably).

---

## te reo Māori policy

When **target language** is `mi` (te reo Māori):

- **Default:** standard / general te reo as codified by **Te Taura Whiri i te Reo Māori** (national media style, e.g. Te Hiku Media, Waatea News). Do **not** default to an iwi dialect.
- **Optional field:** *Iwi / rohe audience* — only when the user specifies a regional context (e.g. Ngāi Tahu). The model may adapt vocabulary and must **flag dialectal choices** vs the standard form in glossary prep and QA (`dialectalChoices`: `used`, `standardForm`, `context`).
- **QA panel** shows `maoriPolicy` mode and dialectal choices, plus a note that language-body guidance can change — verify critical output against current Te Taura Whiri recommendations for production use.

Policy text is injected into glossary, translate, and review prompts via `maoriLanguagePolicy()` / `languagePolicyBlock()` in `translateLlmService.js`.

---

## API (jobs)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/translate/config` | Models configured? |
| `GET` | `/api/translate/jobs` | List jobs |
| `GET` | `/api/translate/jobs/:id/status` | Poll status + `translatedTextJson` when generating |
| `POST` | `/api/translate/jobs` | Multipart: `file` (or legacy `pdf`), `targetLanguage`, `intakeAnswers`, optional `glossaryId`, `scannedPageImages`, `enableReview` |
| `POST` | `/api/translate/jobs/:id/complete` | Upload generated `translatedPdf` |
| `POST` | `/api/translate/jobs/:id/fail` | Mark failed from client |
| `GET` | `/api/translate/jobs/:id/download` | Download bilingual PDF |
| `DELETE` | `/api/translate/jobs/:id` | Delete job |

Glossaries: CRUD under `/api/translate/glossaries`.

---

## Models

Resolved by `translateModelResolver.js` from user settings (`translateAgent` on effective-models). Requires at least a translate model in Settings → Translate agent.
