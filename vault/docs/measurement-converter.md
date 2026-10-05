# Measurements (converter, formula library, document scanner)

Route `/measurements` (nav: Research & Utilities → **Measurements**, feature flag `measurements`, internal key the same). **Entirely client-side**: no new API route, no new table, no server processing of documents. Per-user preferences + the last 30 conversions are stored through the existing settings API (`measurements_prefs`, `measurements_history` — values only, never document contents).

## Layout of the code

| Path | Role |
|---|---|
| `client/src/utils/units/registry.mjs` | **Single source of truth**: every unit, factor, source, example, ambiguity note, cup standards (AU/US/UK), ingredient densities, gas-mark table, scanner target lists, regional families (gallon/pint/quart/fl oz/mpg/gpm/ton). No conversion constant exists anywhere else. |
| `utils/units/convert.mjs` | Engine: `convert`, `convertValues` (compound ft+in, st+lb, h+min, DMS), `formatResult`, `conversionProblem`. Types: factor / offset / inverse / lookup / compound. Display is cleaned to 12 significant digits (no `0.30000000000000004`). |
| `utils/units/numbers.mjs` | Numeric parsing (fractions, mixed numbers, `½`, thousands vs decimal comma) and spoken numbers ("one and a half", "three quarters", "point five"). |
| `utils/units/aliasIndex.mjs` | Alias lookups built from the registry (voice + ingredient names + region-aware pick). |
| `utils/units/voiceParser.mjs` | Whole spoken commands → value / from / to / ingredient ("five feet eleven in centimetres"). The UI shows what was understood before it is used. |
| `utils/units/scanner.mjs` | Pure measurement scanner + conversion proposals + converted-text export. |
| `utils/ocrEngine.js` | **Shared** on-device OCR (Tesseract.js worker, word boxes + confidence). First shared OCR module in Vault — `GraphicsPage` still calls `Tesseract.recognize` inline. |
| `utils/pdfPages.js` | pdfjs helpers: positioned text per page, render to canvas, image → canvas. |
| `components/voiceInput/VoiceInput.jsx` | `VoiceInputProvider` (one shared `useVoice({ lang:'en-AU', continuous:false })`), `MicButton`, `VoiceInput` (text/number/textarea with a mic). Reuses `hooks/useVoice.js` — which gained optional `{ lang, continuous }` (defaults unchanged for every other caller). |
| `pages/MeasurementsPage.jsx` + `pages/measurements/` | Page shell, `ConverterTab`, `FormulasTab`, `ScannerTab`, `scanPipeline.js` (file → pages, CSV, annotated PDF via pdf-lib), `prefs.js`, `shared.jsx`. |
| `utils/tours/measurementsTour.js` | Shepherd tour (8 steps); Settings → **Measurements Tour** opens `/measurements?tour=1`. The (i) How This Works modal auto-shows once. |

## Behaviour worth knowing

- **Voice on every text/number input.** Add `VoiceInput` (or a `MicButton`) with any new input. Unsupported browsers: the mic is shown disabled with an explanation; typing is unaffected.
- **Cup standards:** Australian default (250 ml cup, **20 ml** tablespoon, 5 ml teaspoon). US cup 236.588 ml; UK/metric 15 ml tablespoon. Cups/spoons ↔ grams use the *cooking* group and need an ingredient.
- **Ingredient densities are approximate** (`approximate: true`, generic source text). They are typical baking-chart values, **not individually verified citations** — review and replace `source` with specific references before treating them as authoritative.
- **Scanner never converts silently.** Every find starts `pending`; the user accepts, edits (typing or speaking) or ignores it. Flags: straight quotes / "in" (inches vs quote/word), `m` (metres vs minutes), `t`/`T` (teaspoon/tablespoon/tonne), `oz` (weight vs fluid), regional cups/gallons/pints/mpg, bare `°` (angle vs temperature — left unresolved), decimal comma vs thousands separator, OCR digit fixes (`O→0`, `l/I→1`, `S→5` only next to a unit), low OCR confidence (<80%, with a cropped image beside the edit field), unit taken from a table column header.
- **Context** (General / Recipe / Building / Product) only biases ambiguous units; it never hides a flag.
- **Annotated PDF** is built with **pdf-lib** in the browser (page images + boxes + converted labels). Vault's `@react-pdf/renderer` is server-side only, so it was not used here.
- Scanned PDF pages are OCR'd at ~300 dpi; pages with ≥25 extractable characters use the PDF's own text. OCR language data downloads once (cached by the browser).

## Tests

`npm run test:measurements` — registry/engine (known pairs both ways, round-trip over every unit pair, edge cases, AU tbsp = 20 ml, US vs imperial gallon, KB vs KiB, °C/°F offset, L/100 km ↔ mpg, gas marks), voice parser, scanner (formats, ambiguities, tables, recipes AU/US, OCR-style input, plan/spec sheet, proposals, export).

Fixtures are **text equivalents** of a text PDF, scanned PDF, phone photo, recipes and a plan sheet. Manual checks that need a real file: drop a real text PDF, a scanned multi-page PDF (UI should stay responsive, progress shows per page, Cancel works), and a phone photo; confirm boxes line up in **Annotated view**.

## Known gaps / not in v1

Currency, time zones, clothing/shoe sizes, measuring drawn lines on plans (needs a user-set scale), no opt-in server-side processing, no micro-prefix units beyond µm, no per-document language choice for OCR (English only), the OCR language model is fetched from Tesseract's CDN on first use.
