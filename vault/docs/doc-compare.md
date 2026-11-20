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

## Page layout (like Graphics and Video Tools)

`DocComparePage.jsx` draws the shell with Vault's shared pieces: `ToolSidebar` on the left (six tools in three groups: Compare documents; Changes, File details, PDF pages; PDF report, Settings — a results tool shows "Compare two files first" until there are results), the `JobStart` "What do you want to do?" screen with seven jobs (`DOC_COMPARE_GOALS`), and `BackToJobs` + `JobBar` above each tool. The app in the frame is the tool content: each tool is a view of the app (`doc-compare/src/ui/App.tsx`), and the frame stays loaded while switching, so files and results survive (also going back to the job screen). A job step can preset the Changes filters (`filter: { categories, severities }`), and when Compare finishes during a job the page moves on to the job's next step by itself. Standalone (not in Vault) the app shows its own header and tabs instead. Bridge messages: `doc-compare:view` (Vault → app: show a view, optional filter), `doc-compare:open` (the guide's Open buttons), `doc-compare:context` (app → Vault: current part, view, whether there are results / PDFs, and `cause: 'self'` when the app changed view by itself so the tool list follows).

## Review for the author

**Download review for the author** (top of the PDF report tool, and on the Comparison done card) makes `review_<edited name>_<date>.pdf` in the browser (`doc-compare/src/report/authorReport.ts`, jsPDF): a to-do list to send back to whoever made the edit. It always covers **every** non-trivial change, whatever filters are set (trivial differences are only counted; file details only when flagged Medium or High), sorted into Must fix / Please review / Minor with a count box on the cover. Each item has a tick box, its location, one plain instruction from `actionFor()` ("Restore the missing section …", "Check the changed figure: "30" -> "60" …"), and the text: the word diff with removed words red and struck through and added words green and underlined, a missing section's contents listed once, or the text once when only its place or formatting changed. Footer "Page n of N". Test: `tests/authorReport.test.ts` (reads the generated PDF back with pdf.js). The comparison report (`pdfExport.ts`) is still there, for the person's own records, and follows the filters.

## Menu placement

A new tool only appears where the admin's saved menu layout puts it (Settings → menu layout, `workspace_settings.nav_layout`); otherwise it lands in an "Unsorted" group. `server/services/navSeed.js` (run on boot from `db.js`) places each item in `NEW_NAV_ITEMS` into the saved layout **once**, next to a neighbour (DocCompare goes after Contract Review), and remembers it in `nav_layout_seeded`, so an admin who later moves it back to the pool is not overruled. Test: `node server/services/navSeed.test.js`. Add the next new tool to `NEW_NAV_ITEMS` the same way.

## Look

Inside Vault the app wears Vault's chosen theme and font (`doc-compare/src/ui/theme.ts`, the same approach as Route Tracer: reads the same-origin `vault-settings` key and Vault's own `client/src/themes.js`, sets the `--color-*` variables and `--font-sans`, follows changes from other tabs). Buttons, inputs and chips use Vault's sizes (text-sm, medium weight, rounded-lg, opacity hover, 200 ms). Only when embedded: the font is a Google Font, so loading it is a network request for the typeface (never anything about the files; Vault's page already loads it). The standalone single-file build stays fully offline with system fonts and its own light/dark palette.

## Guided tour

`client/src/utils/tours/docCompareTour.js` (Shepherd, the shared `vault-tour` look): 11 steps — welcome, the jobs, the tool list, Compare documents, the two checks, Changes, File details and PDF pages, the review for the author, Settings, the (i) and compass buttons, the guide. A tour cannot reach inside the frame, so a step about a tool switches the frame to it (the same as clicking it in the list) and points at the frame. Starts from the compass beside the title, Settings → DocCompare Tour (`/doc-compare?tour=1`), or the guide's Open button (`tour`). Completion key `vault_tour_doc_compare_completed`. Its step counter writes into the step's own card (`this.getElement()`); the other Vault tours write into the first `.shepherd-element.vault-tour` in the page, which after step 1 is a hidden earlier card, so their "Step n of N" disappears from step 2 on.

## Help

Tooltips on every control (Vault's `Tooltip` in the tool list and job screen; planner-core `TooltipHost look="vault"` inside the app), the (i) "How DocCompare Works" box (`ToolInfoModal`, opens once per browser and from the (i) beside the title; standalone the app has its own), and the guide chat whose Open buttons switch to the tool and scroll to and highlight the part (`data-guide="<id>"`), or open the (i) box or the page viewer. When a tool, job or control is added or renamed, update `docCompareTools.mjs` and `CATALOG` together (`node server/services/docCompareTutor.test.js` fails otherwise, and checks every job step names a real tool). **Not built:** a guided tour, and the shared microphone (browser speech recognition sends audio to the browser maker, which would break the "never leaves your computer" promise for the one search box).

## Known limits

- PDF report fonts are Latin-1 only: other characters print as `?`.
- PDF text position (the transform matrix) is not compared; the page pixel diff covers layout. Merged table cells are not compared.
- Similarity uses exact shingle Jaccard (no MinHash); fine to a few hundred thousand words.
- Tested on generated fixture documents and a synthetic 200-page DOCX (under 1 s); not yet on real AI edits or on Railway.
- `npm run build:single` inside `doc-compare/` makes a one-file `dist/index.html` that opens from disk (not used by Vault).
