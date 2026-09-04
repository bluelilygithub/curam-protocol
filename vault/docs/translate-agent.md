# Translate agent

Professional document translation at **`/translate`**. Upload a source file, answer short intake questions, then Vault LLMs prepare a glossary, translate in chunks, optionally run a QA review, and the browser builds a bilingual PDF.

**Frontend:** `vault/client/src/pages/TranslatePage.jsx`  
**Backend:** `vault/server/routes/translate.js`  
**Services:** `translateLlmService.js` · `translateModelResolver.js` · `translateExtract.js`  
**Tables:** `translate_jobs`, `translate_glossaries`  
**Settings:** Translate agent card — `translate_model` / `translate_review_model` (fallback: vault default + secondary tier)

Feature flag / app: **Translate** (languages).

---

## Supported uploads

| Format | Extensions | Notes |
|---|---|---|
| PDF | `.pdf` | Native text + OCR for scanned pages (client preflight renders page images) |
| Word | `.docx` | Paragraph text via mammoth. Legacy `.doc` is rejected — save as `.docx` |
| Excel | `.xlsx`, `.xls` | Text cells only (numbers skipped). Each sheet is a section; cells prefixed `[A1]`-style |

Max size: **15 MB**. Google Docs / Sheets: export as `.docx` / `.xlsx` then upload (no Drive OAuth).

Output is always a **bilingual PDF** (source section + translation section per page/sheet), regardless of upload type. Download filename: `translated-{basename}.pdf`.

---

## Pipeline

1. **Upload + intake** — domain (required), audience, tone, must-keep terms, notes; optional saved glossary; optional review pass.
2. **Extract** — `translateExtract.extractForTranslate` → `paragraphsByPage` (+ OCR for sparse PDF pages).
3. **Glossary prep** — Vault translate model proposes / merges terms from intake + text skim + saved glossary.
4. **Translate** — chunked paragraph batches via `callModel` + glossary substitutions.
5. **Review (optional)** — second model returns structured QA (uncertain terms, polarity, restructures, audience flags, dialectal choices).
6. **Client PDF** — `@react-pdf/renderer` bilingual PDF uploaded to complete the job.

Job stages: `pending` → `extracting` → `ocr` (PDF only) → `preparing` → `translating` → `reviewing` → `generating` → `done` / `failed`.

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
