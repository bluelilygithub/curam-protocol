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

LLM translate chunks ~10 paragraphs / ~6000 chars per call and runs **up to 8 chunks in parallel** (`TRANSLATE_LLM_CONCURRENCY`, default 6) with a **45s per-call timeout**, so a stuck model call fails over to split/retry instead of hanging the job. QA review batches (35 pairs each) also run in parallel (`TRANSLATE_REVIEW_CONCURRENCY`, default 4). Still slower than Google on large docs — use Google when speed matters.

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
2. **Extract** — `translateExtract.extractForTranslate` → `paragraphsByPage` (+ OCR for sparse PDF pages).
3. **Glossary prep** — Vault translate model proposes / merges terms from intake + text skim + saved glossary.
4. **Translate** — chunked paragraph batches via `callModel` + glossary substitutions.
5. **Hard sanity gate (deterministic)** — `translateQaChecks.hardSanityGate` on every source⟶target pair. If too many segments are identical to source (>30%), contain placeholders (≥2 or >5%), or are empty (>10%), the job **fails** with an error and a QA summary — no bilingual PDF.
6. **Review (optional)** — deterministic completeness runs first on **all** pairs (auto “Garbled / incomplete rows”); then the review model compares every pair side-by-side in batches for subjective issues; claim verification spot-checks a sample of “None flagged” segments.
7. **Client PDF** — `@react-pdf/renderer` bilingual PDF uploaded to complete the job.

Job stages: `pending` → `extracting` → `ocr` (PDF only) → `preparing` → `translating` → `reviewing` → `generating` → `done` / `failed`.

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
