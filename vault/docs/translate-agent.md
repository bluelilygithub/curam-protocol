# Translate agent

Professional document translation at **`/translate`**. Upload a source file, answer short intake questions, then Vault LLMs prepare a glossary, translate in chunks, optionally run a QA review, and the browser builds a bilingual PDF.

**Frontend:** `vault/client/src/pages/TranslatePage.jsx`  
**Backend:** `vault/server/routes/translate.js`  
**Services:** `translateLlmService.js` · `translateModelResolver.js` · `translateExtract.js` · `translateQaChecks.js` · `googleTranslateService.js` · `translateMemory.js` · `translateNativeOutput.js`  
**Tables:** `translate_jobs`, `translate_glossaries`, `translate_memory`  
**Settings:** Translate agent card — `translate_model` / `translate_review_model` (fallback: vault default + secondary tier) and `translate_target_language` (workspace default target language, overridable per job — see **Target language** below).

Feature flag / app: **Translate** (languages).

---

## Target language

**Settings → AI & Chat → Translate agent → Target language** (`translate_target_language`, default `fr`) sets the workspace default. Job intake shows it as a dropdown seeded from that default — change it there to translate a single job into a different language without touching the workspace setting. (An earlier revision made this read-only per job; that broke picking a one-off language for a single document, so it's a dropdown again — the Settings value is just the starting point now.) Multi-language fan-out per run is still removed (one language per job); the old `POST /api/translate/jobs/batch` route is still on the server (`translate_jobs."batchId"` and existing rows reference it) but has no client caller.

Same principle for the translate/review **model**: chosen once in the Translate agent Settings card (`translate_model` / `translate_review_model`), not per job — the per-job "this job only" model override dropdowns were removed from intake.

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

**Fonts.** `@react-pdf/renderer`'s built-in Helvetica only covers WinAnsi/Latin-1 — no macrons, no Polish diacritics. `FONT_BY_LANG` in `TranslatePage.jsx` routes a target language through an embedded Noto font instead when Helvetica can't render it: `zh-CN`/`ja`/`ko` → Noto Sans SC/JP, `ar` → Noto Sans Arabic, and `mi` (macrons: ā ē ī ō ū) / `pl` (ą ę ł ń ś ź ż) → `NotoSans-Regular.ttf` (`client/public/fonts/`). Confirmed on a real te reo Māori job: with `mi` missing from that map, every macron vowel rendered as a missing-glyph substitution — mojibake across the whole translated PDF ("Tā Mahere" → "TM Mahere", etc.) — invisible in the QA report because the underlying text content was correct; only the rendered glyph was wrong. Adding a target language with non-Latin-1 characters needs an entry here, not just an entry in the `LANGUAGES` list.

---

## Supported uploads

| Format | Extensions | Notes |
|---|---|---|
| PDF | `.pdf` | Native text + OCR for scanned pages (client preflight renders page images) |
| Word | `.docx` | Paragraph text via mammoth. Legacy `.doc` is rejected — save as `.docx` |
| Excel | `.xlsx`, `.xls` | Text cells only (numbers skipped). Each sheet is a section; cells prefixed `[A1]`-style |

Max size: **15 MB**. Google Docs / Sheets: export as `.docx` / `.xlsx` then upload (no Drive OAuth).

**Known limitation — multi-column / sidebar-tab PDF layouts, including plain data tables.** `translateExtract.extractFromPdf` reconstructs paragraphs by sorting text items by y-position then x-position, which assumes a single reading column. Confirmed on a real multi-column manual (product manual with a repeating 4-tab vertical sidebar and 3-column warning-box grids): unrelated columns sharing a y-range get interleaved into one garbled "paragraph" *before translation ever runs*. The model then produces fluent-sounding French from garbled English input — the corruption is invisible without comparing against the real source, and it produced at least one safety-relevant mistranslation (`Healthy Dehumidification Mode` → `mode déshydratation`, i.e. "dehydration") from reordered fragments. The same limitation hits an ordinary multi-column **data table** (a 3-column metric/forecast table in a commercial proposal, no sidebar involved) — two table rows sharing a y-range got merged into one garbled input paragraph, and the model resolved the mess by absorbing one row's content into its neighbour and rendering its own slot as a hallucinated `[REDACTED]` (see the `[REDACTED]` priming note above — the two defects compounded on the same document). A second job against the same table (different target language) hit the same root cause again, this time surfacing as `truncated_short` (see **Completeness rules** below) instead of a `[REDACTED]` hallucination — same garbled-table trigger, different downstream failure mode depending on how the model chose to cope with the mess.

**This extraction limitation is the actual root cause of both incidents** — the font and completeness-check fixes that shipped for them only cover the *symptoms* (a wrong glyph, a report that missed a truncation); a table on a source PDF can still garble on extraction until this is fixed. Not fixed — deferred as out of scope while the demo targets standard single-column A4 documents (reports, contracts). A real fix needs column-boundary detection (clustering x-position, not just y) plus stripping repeating margin/sidebar text, and must be verified against both layouts before shipping since it changes how every PDF is read.

Download filename: `translated-{basename}.pdf` (layout chosen per job).

---

## Pipeline

1. **Upload + intake** — domain (required), audience, tone, must-keep terms, notes; optional saved glossary; optional review pass.
2. **Extract** — `translateExtract.extractForTranslate` → `paragraphsByPage` (+ OCR for sparse PDF pages). PDF line-extraction groups text by y-position, which can chop a sentence mid-way on documents with uneven line leading (headers, table-like layouts). `translateExtract.stitchFragments` runs immediately after: a fragment with no terminal punctuation (`.!?:;"”)]`) is merged into the next one unless that next fragment looks like a fresh sentence/field start. This keeps "paragraphs" close to real sentences before chunking — fewer, cleaner segments, and no more mid-sentence grammar breaks at chunk/segment boundaries. Not applied to `.docx` (already splits on real blank-line breaks) or spreadsheets (cell values, `[A1]`-tagged — stitching would merge unrelated cells).
3. **Glossary prep + term locking (one call, LLM engine only)** — `translateLlmService.proposeGlossary` proposes/merges terms from intake + text skim + saved glossary, AND assigns canonical renderings to recurring defined-term candidates in the same call. Candidates come from `translateQaChecks.detectRepeatedTermCandidates` (a pure string scan, computed before the call — no LLM cost), which flags ordinary (non-brand) words/phrases that read as defined terms — `Warranty Schedule`, `Nominated Vehicle`, `Period`, `Make` — the kind too ordinary for a glossary skim to notice on its own, but exactly what drifts between chunks because nothing pins them down. A phrase qualifies on any of five signals: it recurs **mid-sentence** (≥2×, not just at sentence starts — plain capitalization isn't a signal on its own); it recurs as a **standalone paragraph** (≥2×, e.g. a field label like `Make` / `Model`); it's immediately followed by a **definition marker** (`means`, `refers to`, `is defined as`, `has the meaning`) — this alone qualifies it even on a single occurrence, catching a term that's only ever introduced once per definition clause (`"Warranty Schedule means..."`) and never referenced inline elsewhere; it's a **status word from a fixed whitelist** (`PASS`, `FAIL`, `REVIEW`, `WARN`, `PENDING`, `APPROVED`, `REJECTED`, `COMPLETE`, …) appearing ≥2× — a fixed list, not "any ALL-CAPS token", so real acronyms (`ERP`, `API`, `ISO`, `CAD`) that should stay untranslated aren't swept in; or it matches a **`Word N` numbered-label pattern** (`Tier 1`, `Phase 2`, `Level 3`) appearing ≥2× — confirmed on a real job where `Tier` recurred exactly twice, spread across a table row and a heading, and drifted (`Palier` in one chunk, `Tier` in the other) without this signal. (This used to be two sequential LLM calls — `proposeGlossary` then a separate `lockRepeatedTerms` — merged into one to remove a full serial round-trip from every job before translation starts.)
4. **Translate** — chunked paragraph batches via `callModel` + glossary substitutions. Paragraphs that look like leaked code/template debris (e.g. a serialized object dump, an unresolved internal token) are detected (`translateQaChecks.isCodeLikeArtifact`) and copied through verbatim instead of being sent to the translator.
5. **Glossary drift: auto-fix + report (LLM engine only)** — `translateLlmService.autoFixGlossaryDrift`. Chunks translate in parallel with no shared state between them, so even a term every chunk was told the same rendering for can still land two different ways in two different chunks. Confirmed on a real job: "Tier" locked to "Palier" in most chunks, left as literal English "Tier" in one. Two pure-string passes, no LLM calls:
   - **Auto-fix** the common case — the source term sitting untranslated, verbatim, inside the target — with a direct regex replace. Mutates `translatedByPage` in place; `qaSummary.glossaryDriftAutoFixedCount` reports how many occurrences were corrected this way.
   - **Report** whatever's left — a genuinely different wrong rendering, not a plain leftover — in the QA summary's uncertain terms, since guessing a fix for that case is worse than flagging it. (An earlier version re-translated all drifted segments with an LLM call each instead of this two-pass approach — it added real wall-clock time without reliably fixing anything, since the retry could just as easily pick a different wrong synonym.)

   For a document type you translate repeatedly, the durable zero-latency fix for a term that keeps drifting is still to add it to your saved glossary (Settings) with the rendering you want — that skips detection entirely and is honoured from the first chunk.

   `applyGlossarySubstitutions` also protects **filename tokens** from substitution — confirmed on a real job: a locked term ("Transmittal") sat inside a real filename (`Transmittal_2024-157_Scanned.pdf`) and got replaced, producing a filename that no longer exists on disk. An underscore/digit isn't a letter, so the existing word-boundary check didn't stop it. Filename-shaped tokens (`\S*\.(pdf|docx|xlsx|…)`) are swapped out for placeholders before any substitution runs and restored untouched afterward.
6. **Hard sanity gate (deterministic)** — `translateQaChecks.hardSanityGate` on every source⟶target pair. If too many segments are identical to source (>30%), contain placeholders (≥2 or >5%), or are empty (>10%), the job **fails** with an error and a QA summary — no bilingual PDF.
7. **Review (optional)** — deterministic completeness runs first on **all** pairs (auto “Garbled / incomplete rows”); then the review model compares every pair side-by-side in batches for subjective issues; claim verification spot-checks a sample of “None flagged” segments.

   **Polarity/meaning-inversion check was narrower than its name.** Confirmed on a real job: source "Our best campaign is budget-constrained and it hits hardest on weekends" (a weakness — the constraint's damage peaks on weekends) came back as "…et elle est la plus puissante le week-end" (a strength — it's *strongest* on weekends), a full meaning inversion. Grammatically fluent both ways, so it read as a clean translation; the `polarityOrSentenceTypeIssues` category existed and ran, but its prompt gave only one example (the compliance-status flip: "measured against" → "not compliant") and the reviewer model didn't generalize from it to this different flavor of inversion — a weakness reframed as a strength. Broadened both the review prompt and the translate-time hard rule (`TRANSLATOR_HARD_RULES_BASE` in `translateLlmService.js`) to describe the general pattern (a weakness/constraint reframed as a strength or vice versa, any negation dropped/added) instead of only the one compliance example — the category was real, its coverage wasn't.
8. **Client PDF** — `@react-pdf/renderer` bilingual PDF uploaded to complete the job.

The QA summary modal (jobs table → **View Results**) has its own **Download QA report** button — a plain-text export of the same sections shown on screen (uncertain terms, dialectal choices, polarity/sentence-type issues, restructured sentences, garbled rows, audience flags, completeness stats), generated client-side from `qaSummaryJson` for HITL review. It's distinct from **Download translated PDF** / **Download original** / native Word-Excel output next to it — the QA report describes the translation, it isn't the translation. Those file downloads live only in this modal now (the jobs table row itself only keeps the native Word/Excel button, View Results, and Delete) — one place for everything about a job's output.

Job stages: `pending` → `extracting` → `ocr` (PDF only) → `preparing` → `translating` → `reviewing` → `generating` → `done` / `failed`. The client shows this progression in the global blocking **ProcessingModal** (`processingStore`/`runWithStepLog` pattern, same as Property Scenario) rather than an inline row — polling `GET /jobs/:id/status` drives step state (`setProcessingSteps`) and the stage/percent detail line.

### Speed notes

Each pipeline stage above is a full serial barrier — it waits for the entire previous stage (including its single slowest call) before starting. Steps 1-3 above collapse what used to be two sequential single-call round-trips into one. The remaining biggest lever: step 7 (review) currently waits for the *entire* document to finish translating + repairing before reviewing any pair, even though most chunks typically finish translating well before the slowest one — streaming review per completed chunk-group instead of one call over the whole document would be the next real win, but is a larger restructuring of the stage-barrier shape, not done yet.

Model choice (`translate_model` / `translate_review_model` in Settings) is resolved entirely from this workspace's own `vault_models` catalog — there's no hardcoded fallback id. If a job's QA summary shows a `-preview` model id for the review slot, prefer a GA (non-preview) equivalent when one's available in the catalog: preview endpoints commonly carry tighter rate limits / more latency variance than a GA release, which can show up as an occasional slow tail in the review stage. This is a Settings change, not a code change.

### Completeness rules (per segment)

Before any subjective LLM check, each target must be:

- **(a)** non-empty  
- **(b)** different from the source (after normalize), except non-linguistic cells / same-language jobs  
- **(c)** free of placeholders such as `[Translation incomplete]`, `[unable to translate]`, `TBD`, `TODO`, etc.
- **(d)** not **disproportionately shorter** than the source — `isTruncatedShort()`/`TRUNCATION_RATIO` in `translateQaChecks.js`: for a source ≥200 chars, a target under 30% of its length is flagged `truncated_short`. Confirmed on a real job: a ~900-char financial table (flattened into one paragraph by the multi-column PDF extraction limitation) came back translated only as far as the header row — non-empty, not identical to source, no placeholder text, so every prior check passed it as clean while most of the table and a trailing paragraph were silently dropped. This check also feeds the repair pass (`repairIncompletePairs` retries a truncated segment the same as an empty/placeholder one, and won't accept a retry that's still truncated).

Hard-fail only when **>25%** of segments still have placeholders (mass failure). Moderate rates complete with a soft warning and Garbled rows listed. `[REDACTED]` must pass through unchanged (locked DNT + post-process) — this is about a source document that already contains literal `[REDACTED]` markers (e.g. a pre-redacted contract or FOI release) surviving translation intact; it's unrelated to the separate **document redaction agent** at `/document-redaction`. If a QA report flags a missing `[REDACTED]` token, it means the source had one that the translation dropped or paraphrased away. Deterministic checks also flag **bracketed process meta** in any language (e.g. `[texto no disponible para traducir]`), not only English `[Translation incomplete]`. Incomplete segments get a **repair pass** (LLM retry → optional Google fallback) before the gate.

The locked `[REDACTED]` do-not-translate term and its hard rule are only added to the prompt when the text actually being translated (that batch/paragraph, or the source skim for glossary prep) contains the literal token — `lockedDoNotTranslateTerms(text)` / `translatorHardRules(text)` in `translateLlmService.js` and `translateQaChecks.js`. Confirmed on a real job: injecting it unconditionally on every document primed the model to reach for "[REDACTED]" as a fallback for a paragraph it couldn't cleanly parse (a garbled table row on a document with **zero** legitimate redaction), producing a hallucinated redaction plus dumping that row's real content into the adjacent paragraph — a structural corruption with nothing in the source to justify it.

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
| `POST` | `/api/translate/estimate` | Extract-only (no translation) — returns `charCount`, `pageCount`, rough `estCostAud` before submitting |
| `GET` | `/api/translate/jobs` | List jobs |
| `GET` | `/api/translate/jobs/:id/status` | Poll status + `translatedTextJson` when generating |
| `POST` | `/api/translate/jobs` | Multipart: `file` (or legacy `pdf`), `targetLanguage`, `intakeAnswers`, optional `glossaryId`, `scannedPageImages`, `enableReview` |
| `POST` | `/api/translate/jobs/batch` | Same as above but `targetLanguages` (JSON array, 2-8 codes) instead of `targetLanguage` — one job per language sharing a `batchId`, extraction/OCR done once and reused |
| `POST` | `/api/translate/jobs/:id/complete` | Upload generated `translatedPdf` |
| `POST` | `/api/translate/jobs/:id/fail` | Mark failed from client |
| `GET` | `/api/translate/jobs/:id/download` | Download bilingual PDF |
| `GET` | `/api/translate/jobs/:id/download-native` | Download native `.docx`/`.xlsx` output, when available (see **Native output** below) |
| `GET` | `/api/translate/jobs/:id/download-original` | Download the untouched uploaded source file (`originalPdf` column, despite the name — holds whatever format was uploaded), for comparing against a flagged QA segment |
| `DELETE` | `/api/translate/jobs/:id` | Delete job |

Glossaries: CRUD under `/api/translate/glossaries`. `GET /api/translate/glossaries` returns `targetLanguage` + `isGlobal` on every row so the Glossaries tab can show a language column and a "Global · learned" badge — the same CRUD (rename, add/edit/remove terms) works on a global glossary as on a manually-created one, so it doubles as the review/edit UI for a language's accumulated terms.

**Global (auto-learned) glossary.** One glossary per `(userId, targetLanguage)`, flagged `"isGlobal"=TRUE` in `translate_glossaries`. `GET /api/translate/glossaries/global/:lang` looks it up (`null` if none yet). A single-language job (not the batch fan-out) can pass `useGlobalGlossary=true` instead of a `glossaryId` — the server resolves/creates that language's global glossary and uses it as the job's glossary. When the job finishes, `upsertGlobalGlossaryTerms` merges that run's `glossaryTerms` back into it, keyed by source text (case-insensitive); an existing entry always wins over a fresh proposal, so a term stays fixed once seen. Intake UI: a checkbox next to the manual glossary picker, **checked by default** (was opt-in at first — nothing ever accumulated because nobody thought to tick it on every run) — untick it to use a manually-picked glossary instead. To review or correct what a language has "learned," open its global glossary in the **Glossaries** tab like any other — edits there are picked up by the next job for that language.

Translation memory: `GET /api/translate/memory/stats` (segment counts + reuse counts per language pair), `GET /api/translate/memory/export.tmx` (TMX 1.4 export, optional `?sourceLang=&targetLang=` filter).

---

## Native (editable) output

Every job still produces the bilingual/side-by-side PDF as before. When the source was `.xlsx`/`.xls` or `.docx`, the pipeline also attempts to build a native output file in the *same* format, so the download isn't PDF-only:

- **Xlsx** (`translateNativeOutput.buildNativeXlsx`) — deterministic. `translateExtract` prefixes every cell paragraph with its exact ref (`[A1] text`), so the translated text is written straight back into that cell of the original workbook (styles/formulas on untouched cells are preserved; a translated cell's formula, if any, is dropped since it no longer applies).
- **Docx** (`translateNativeOutput.buildNativeDocx`) — best-effort. The original `document.xml` is split into `<w:p>` blocks and matched **by position** to our extracted paragraphs. If the counts don't line up (unusual structure — nested tables, text boxes — that mammoth's flattened text extraction counts differently than the raw XML), the function returns `null` and the job simply has no native output; the PDF is still generated normally.

Stored in `translate_jobs."translatedFile"` / `"translatedFileMime"` / `"translatedFileName"`; `hasNativeOutput` is exposed on the job list/status endpoints. Never blocks job completion — build failures are logged and swallowed.

---

## Translation memory (exact match)

`translateMemory.js` — after each job, every (source paragraph, translated paragraph) pair is upserted into `translate_memory`, keyed by `(userId, sourceLang, targetLang)` with an MD5 hash of the normalized source text (paragraphs can exceed Postgres's btree index row-size limit, so the raw text itself isn't indexed). Before translating, every paragraph is checked against this memory; an exact match is reused verbatim instead of being sent to the model, and its `hitCount` is bumped. No fuzzy matching — deliberately simple, but it guarantees identical wording for repeated boilerplate (standard clauses, repeated product blurbs) across jobs and skips the LLM call entirely for those segments. `qaSummary.tmReuseCount` reports how many segments were reused in a given job. Export via `GET /api/translate/memory/export.tmx` for use in another CAT tool.

---

## Multi-language fan-out

`POST /api/translate/jobs/batch` accepts `targetLanguages` (2-8 language codes) instead of a single `targetLanguage`. One `translate_jobs` row is created per language, all sharing a `batchId`. Extraction and OCR (the parts of the pipeline that don't depend on target language) run once against the first job in the batch and the result is reused for every language — `processTranslateJob`'s `sharedExtraction` parameter — so a scanned PDF doesn't get OCR'd N times. Each language then runs its own glossary/translate/QA/output stages independently and in parallel (pool of 3). The client UI exposes this as "Also translate into more languages" checkboxes next to the single target-language selector.

---

## Upfront estimate

`POST /api/translate/estimate` runs extraction only (no LLM calls) and returns `charCount`, `pageCount`, and a rough `estCostAud` — `costCalculator.calculateCost()` (USD, ~4 chars/token heuristic for both input and output) converted to AUD via `marketData.getUsdToAudRate()` (the same Frankfurter lookup Shares uses; 5-minute cache). Multiplied by language count when `targetLanguages` is passed. Informational only — actual usage varies with glossary size and whether the review pass runs.

---

## Models

Resolved by `translateModelResolver.js` from user settings (`translateAgent` on effective-models). Requires at least a translate model in Settings → Translate agent.
