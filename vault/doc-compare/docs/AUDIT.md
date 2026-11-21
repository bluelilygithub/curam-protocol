# DocCompare — audit against SPEC.md and the submission-check addendum

Written 2026-11-21, before any addendum work, as the addendum's §1 requires. Code at commit `3f50e6cd`. The existing code is treated as the source of truth where it differs from SPEC.md; differences are flagged in §2.

## 1. What exists and where

| Area | Where | State |
|---|---|---|
| Readers (PDF, DOCX, Markdown, text) → `NormalizedDoc` | `src/readers/` (`pdf.ts`, `docx.ts`, `markdown.ts`, `text.ts`, `finalize.ts`, `registry.ts`) | Done. DOCX read straight from XML with styles and theme fonts; PDF paragraphs from line spacing, headings from size, paragraphs rejoined across pages. **No footnotes, endnotes, references, numbering text or version detection.** |
| Gate 1 (file type) | `src/checks/fileType.ts`, `src/compare/read.ts` | Done (magic bytes, legacy .doc, password, damaged, scanned PDF). |
| Gate 2 (same document) | `src/checks/similarity.ts` | Done, threshold 60 (Settings). Exact shingle Jaccard (no MinHash). |
| Metadata | `src/checks/metadata.ts` | Done. Whole-document word-count drop only (no per-section). |
| Alignment, content, formatting, layout | `src/compare/align.ts`, `content.ts`, `formatting.ts`, `layout.ts`, `normalize.ts`, `textSim.ts` | Done. Removed/added/moved, grouped sections and table rows, number / typo / wording (High when a paragraph lost a large part), formatting by character range, PDF pixel diff. |
| Change model, severity | `src/report/model.ts`, `src/report/severity.ts` | `Change` has category, severity, location, original/edited, detail, diffHtml, children, trivial, group, page. Severity rules in one table. |
| Reports | `src/report/pdfExport.ts` (comparison report), `src/report/authorReport.ts` (review for the author: every change with an action and tick box) | Done. Latin-1 font. No verdict, no watermark, no decisions. |
| UI | `src/ui/` (`App.tsx` views, `Results.tsx`, `PageViewer.tsx`, `SettingsDrawer.tsx` = Settings view, `guide.ts`, `theme.ts`, `InfoModal.tsx`) | Views: Compare documents, Changes, File details, PDF pages, PDF report, Settings. |
| Vault shell | `client/src/pages/DocComparePage.jsx`, `client/src/pages/docCompare/docCompareTools.mjs`, `client/src/utils/tours/docCompareTour.js`, guide `server/services/docCompareTutor.js` | Graphics-style page: tool list, 12-job start screen, job bar, (i) box, tour, guide chat, Vault theme. |
| Storage | `src/settings.ts` | Settings in `localStorage` only. **Nothing else is stored: no IndexedDB, no projects, no decisions, no file hashes.** |
| Tests | `tests/` (84 tests: units, e2e per fixture, guide bridge, review PDF, no-network) and `tests/fixtures/generate.mjs` | Fixture generator builds DOCX/PDF/MD/TXT pairs in memory. |

## 2. Differences between the code and SPEC.md (code wins; flagged)

1. **Settings is a view, not a drawer** (changed at the owner's request for the Graphics-style layout). The addendum's "settings drawer moves behind Settings" is already true in spirit.
2. **The main screen is a job dashboard**, not two drop zones (owner's request). This conflicts with addendum §6.3 — see decision D1.
3. **Inside Vault the app loads Vault's font from Google Fonts** (owner's request for Vault styling). SPEC §9 "no network after load" now holds for the standalone build and for file handling, not for the embedded font.
4. **Severity extras not in SPEC**: a wording change that drops a large part of a paragraph is High; removed table rows are grouped into one change; table column-count changes are formatting.
5. **No MinHash** (exact Jaccard is fast enough: 96,000 words compared in under 1 s).
6. **PDF text position is not compared** (layout pixel diff covers it); merged DOCX table cells are not compared.
7. **A "review for the author" PDF exists** that SPEC did not ask for; the addendum's report changes (§8) should extend both PDFs.

## 3. What each addendum section needs

Size: S under a day, M one to three days, L more than three days of focused work. "Touches" lists modules that change; everything else is new code.

| § | Needs | Size | Touches |
|---|---|---|---|
| 0.1 / 9 fixtures | ~25 new fixture pairs named `ucNN-…`, plus multi-round sequences | M | `tests/fixtures/generate.mjs` |
| 0.2 Intentional versions | A mode flag; Gate 2 at 30; section grouping (both / only A / only B / reworded); no verdict; report title | M | `App.tsx`, `pdfExport.ts`, new `compare/sections.ts` |
| 2 Change fields + `messages.ts` | Optional fields (`tier`, `summary`, `whyItMatters`, `action`, `decision`, `decidedAt`, `origin`), new categories, one message catalogue. `authorReport.actionFor()` moves into it. | S–M | `model.ts`, `content.ts`, `metadata.ts`, `authorReport.ts`, UI labels |
| 3 Re-tiering | Tier rules; per-section word-count drop (>15%) is new; several existing test expectations change (to be listed in the commit) | S | `severity.ts`, `metadata.ts`, `content.ts`, tests |
| 4 New claims | Claim-token scan of added/modified blocks against the whole original (percentages, money, units, years, counts, quotes ≥4 words, citations, URLs/DOIs, attributions) | M | new `checks/claims.ts`; pipeline |
| 5.1 References and citations | DOCX footnotes/endnotes (`word/footnotes.xml`, `endnotes.xml`), Markdown footnotes and reference links, PDF best-effort; reference-list detection, entry splitting and fingerprint matching (≥0.85); citation resolution | L | `readers/docx.ts`, `readers/markdown.ts`, `readers/pdf.ts` (additions only), new `checks/references.ts`, metadata count |
| 5.2 Quotes | Quote extraction (marks, `>` blocks, DOCX Quote styles), exact-match check | S–M | new `checks/quotes.ts` |
| 5.3 Numbering | DOCX numbering (numPr is read today, the rendered number is not), text patterns; gaps, duplicates, restarts, renumbering; figure/table numbers | M | `readers/docx.ts` (numbering.xml), new `checks/numbering.ts` |
| 5.4 Word counts and limits | Per-section counts table; optional word/page limit on the main screen and in Settings; exclude references, include footnotes (toggles) | S–M | `settings.ts`, new `checks/wordCount.ts`, UI |
| 5.5 Spelling and terms | ~300 AU/US pairs JSON (curated, ambiguous ones excluded); dominant standard from the original; one grouped amber change. Defined terms, acronyms, capitalised phrases; optional glossary upload | M–L | new `checks/spelling.ts`, `checks/terms.ts`, data file |
| 5.6 Required headings | Default: every original heading (reuse section removal, no double report); optional pasted list saved as named templates; order check | S–M | new `checks/headings.ts`, Settings |
| 6 Verdict + review queue | Verdict banner and sentence, accuracy line, review cards (Restore copies the original to the clipboard / Accept / Fix later; amber Accept / Dismiss all similar), progress, R/A/L and arrow keys, decisions in IndexedDB keyed by file hashes | L | new UI layer above the current views; `App.tsx`; new `store/` (IndexedDB) |
| 7 Projects and rounds | Project/Round/StoredFile/TrackedItem model in IndexedDB; accepted state rebuilt from decisions; three-way status per item; stable `itemId`; drift; timeline; make-this-round-the-original with reason and audit trail; storage meter, quota warning, compaction; home screen; export/import `.doccompare` zip; delete-round dependency rules | L+ (the largest part, roughly half the addendum) | new `project/` modules, new home screen; the comparison pipeline is reused as is |
| 7.10 Version numbers | Version identifier and version-history-table detection; amber/red rules | S–M | new `checks/version.ts` |
| 8 Report | Verdict page, decisions summary, review items, "Full detail", watermark when red is open, round summary, timeline, original replacements | M | `pdfExport.ts`, `authorReport.ts` |

Overall: several weeks of focused work in total. It splits cleanly into phases that each ship on their own (§5).

## 4. Decisions needed before building (the addendum's "get approval first")

- **D1. Main screen.** Addendum §6.3 wants a bare screen (two drop zones, optional word limit, a big Check button) with settings hidden. The page now has the Graphics-style tool list and job dashboard you asked for. Proposal: keep the Vault shell, make **Check a document** the first and largest job (verdict-first flow), and show the verdict and review queue as the first tool after checking; the current views move under "Show all changes".
- **D2. Where projects live.** The addendum stores projects, rounds and files in the browser's IndexedDB (files never leave the computer, but a cleared browser loses them; export is the backup). Vault's normal pattern is server storage per user (Postgres + uploads), which survives browsers and devices but means the files *do* leave the computer. Proposal: IndexedDB as the addendum says, with the export reminder; server storage could be an opt-in later.
- **D3. Restructures the audit finds necessary** (approval asked now): (a) `App.tsx` state moves into a small store so the review queue, projects and the existing views share one comparison result; (b) `authorReport.actionFor()` moves into `messages.ts`; (c) the pipeline gains a post-processing stage for the new checks (§4–5) instead of growing `content.ts`. No reader or comparison module is rewritten.
- **D4. Re-tiering changes existing results** (§3): typo and formatting stay info; moved becomes amber (it is Medium today, same); per-section word drop >15% becomes red (new). Test expectations that change will be listed in that commit.
- **D5. Spelling list.** The ~300 AU/US pairs have to be curated (no network to fetch one). I would write the list from standard references and keep ambiguous words out; it can be reviewed as a plain JSON file.

### Decided (owner, 2026-11-21)

- **D1:** keep the Vault shell (tool list, job screen); add "Check a document" as the first and largest job; after checking, the verdict and review queue show first and today's views move under "Show all changes".
- **D2:** projects live in the browser (IndexedDB) as the addendum says, with export/import and the export reminder.
- **D3:** restructures approved. (a) the shared results store is done in Phase 2, where the review queue first needs it; (b) and (c) are done in Phase 1.
- **D4, D5:** as proposed. Phase 1 approved.

## 5. Proposed phases (each one shippable, tested and pushed on its own)

1. **Foundations**: Change fields, `messages.ts`, tiers (§2, §3), new fixtures per use case (§0.1) for what already works. *No visible change except wording.* — **Done 2026-11-21.** Also: `compare/postChecks.ts` (the post-processing stage) with the per-section word-count drop (red over 15%, sections under 40 words skipped, not raised where a removal or move in that section already explains it); the aligner now pairs a paragraph cut down to a few of its own words as "modified" (word containment ≥ 0.9) instead of removed + added. Use-case fixtures added: uc01 (caveat dropped, section tightened), uc02, uc03, uc07, uc09 on a white-paper base; uc04-06, uc08 and uc10 come with the phases that build their checks.
2. **Verdict and review queue** for a quick comparison (§6), decisions in IndexedDB by file hashes, PDF verdict page and watermark (§8 part). *The biggest visible improvement.*
3. **Submission checks, part 1**: new claims (§4), quotes (§5.2), word counts and limit (§5.4), required headings (§5.6), version number (§7.10).
4. **Submission checks, part 2**: references and citations (§5.1), numbering (§5.3), spelling and terminology (§5.5).
5. **Projects and rounds** (§7): data model, accepted state, three-way status, drift, timeline, new original, storage, export/import, home screen; report additions (§8 rest).
6. **Intentional-versions mode** (§0.2).
