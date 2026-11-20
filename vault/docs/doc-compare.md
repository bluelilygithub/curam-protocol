# DocCompare

**DocCompare** (AI tools menu, `/doc-compare`, flag `docCompare`, lifecycle `preview`) compares an original document with an LLM-edited version and reports every change: missing content, added content, wording and typos, number/date changes, formatting, PDF page layout and file metadata. Its main job is catching content an LLM silently skipped or altered. Built 2026-11-21 from the spec in the owner's brief.

## Where it lives

| Piece | Where |
|---|---|
| The app | `doc-compare/` — its own Vite + React + TypeScript app (pdf.js, jszip + fast-xml-parser, remark, jsdiff, pixelmatch, jsPDF). Built into `dist/doc-compare-app/` by `scripts/buildDocCompare.js` (non-fatal, like Route Tracer). |
| Host page | `client/src/pages/DocComparePage.jsx` — iframe to `/doc-compare-app/?embedded=1`; shows a "not built" notice if the app's marker tag (`name="doc-compare-app"`) is missing |
| Shared tools list | `client/src/pages/docCompare/docCompareTools.mjs` — the (i) box text (`HOW_IT_WORKS`), the guide's Open-button ids (`GUIDE_TOOLS`) and the bridge message types. The app imports it through its `@vault-client` alias. |
| Guide chat | `server/services/docCompareTutor.js` (on `guideCore.js`) + `server/routes/docCompareTutor.js` (on `guideRouter.js`), `POST /api/doc-compare-tutor` behind `requireFeature('docCompare')` and `aiLimiter`; wrapper `client/src/pages/docCompare/DocCompareTutorChat.jsx`; registry id `doc-compare` |
| Tests | `cd doc-compare && npm test` (readers, aligner, classifiers, severity, an end-to-end test per generated fixture pair, the guide bridge, and a test that fails if `fetch`/`XMLHttpRequest` is called during a comparison); `node server/services/docCompareTutor.test.js` (guide drift, no model) |

## Privacy: files never leave the browser

The app reads and compares both files inside the iframe. It makes **no network calls** after loading: the pdf.js worker and the comparison worker are bundled inline (blob URLs, allowed by the CSP's `worker-src 'self' blob:`), no fonts or CDNs are fetched, and nothing is saved except the person's Settings in `localStorage` (`doc-compare:settings`, `doc-compare:info-seen`). Only the guide chat, which lives in Vault's page outside the frame, calls the server, and it never sees the files or results. Do not add an API call to the app.

## How it works (short)

1. **Gate 1, file type** (`src/checks/fileType.ts`): magic bytes (`%PDF`, ZIP containing `word/document.xml`), extension for `.md`/`.txt`. Different types, unsupported, legacy `.doc`, damaged, password-protected and scanned (no text layer) files stop with a plain message.
2. **Readers** (`src/readers/`): each returns a `NormalizedDoc` (blocks with runs and locations, plus metadata). DOCX is read directly from the XML (not mammoth) so fonts, sizes and styles survive; theme fonts are resolved. PDF lines are grouped into paragraphs by spacing, headings by font size, and paragraphs that run over a page break are rejoined. A new file type is one new reader in `registry.ts`.
3. **Gate 2, same document** (`src/checks/similarity.ts`): 40% headings, 40% word 5-gram overlap, 20% structure; below the threshold (60) the person can Cancel or Compare anyway (recorded in the report).
4. **Compare** (in a Web Worker): LCS over block fingerprints, fuzzy pairing between anchors, moves, grouped removed sections and table rows, word diffs classified as number / typo / wording, formatting by character range, metadata flags. Severity rules are all in `src/report/severity.ts`.
5. **PDF layout** (main thread, after the results show): pages rendered at 1× and compared with pixelmatch; over 0.5% changed is a Layout change. The viewer renders at 1.5×.

## Help

Tooltips on every control (planner-core `TooltipHost look="vault"`, driven by `title`), the (i) "How DocCompare works" box (opens once per browser and from the ⓘ button), and the guide chat whose Open buttons scroll to and highlight the part (`data-guide="<id>"`), or open Settings, the (i) box or the page viewer. When a control is added or renamed, update `docCompareTools.mjs` and `CATALOG` together (`node server/services/docCompareTutor.test.js` fails otherwise). **Not built:** a guided tour, and the shared microphone (browser speech recognition sends audio to the browser maker, which would break the "never leaves your computer" promise for the one search box).

## Known limits

- PDF report fonts are Latin-1 only: other characters print as `?`.
- PDF text position (the transform matrix) is not compared; the page pixel diff covers layout. Merged table cells are not compared.
- Similarity uses exact shingle Jaccard (no MinHash); fine to a few hundred thousand words.
- Tested on generated fixture documents and a synthetic 200-page DOCX (under 1 s); not yet on real AI edits or on Railway.
- `npm run build:single` inside `doc-compare/` makes a one-file `dist/index.html` that opens from disk (not used by Vault).
