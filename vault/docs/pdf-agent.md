# PDF Tools

The PDF Tools page is a PDF toolkit mounted in Vault at **`/pdf`**. Stateless — every tool takes a `dataUrl` (base64 PDF/image) in and returns a `dataUrl` out; nothing is persisted server-side and there is no dedicated DB table.

**Frontend:** `vault/client/src/pages/PdfPage.jsx`
**Backend:** `vault/server/routes/pdf.js` (mounted at `/api/pdf`)
**Office conversion:** `vault/server/services/officeConvert.js` (LibreOffice headless)
**Password protect/remove:** `vault/server/services/pdfCrypto.js` (qpdf headless — see **Password Protect / Remove Password** below)
**Text → PDF:** `vault/server/services/textToPdf.js`
**PDF manipulation:** `pdf-lib` · **Image handling:** `sharp` · **Text extraction (Compare's text-diff tab):** `pdf-parse` · **Google Drive:** `googleapis` (reuses `gmail_tokens` OAuth)

Not currently gated by a feature flag and not listed in `FEATURE_ACCESS_KEYS` — same known-gap pattern as `translate`/`guitar` (see **Feature access** in `vault/CLAUDE.md`).

Two tooltip layers, matching Graphics and Video Tools: a click-to-open help icon (`ToolHeader`, `getIcon('help-circle')`) next to every tool's title opens a modal with that tool's full title/description/feature list (`TOOL_HELP`); every in-panel control across all 31 tools also shows a themed hover popover on its own, via the shared `client/src/components/Tooltip.jsx` component.

---

## Endpoints

| Route | What it does |
|---|---|
| `POST /chat` | SSE chat over an uploaded file's `extractedText` (from `files` table), `standard` tier |
| `POST /text2pdf` | Plain text → PDF via `generateTextPdf()` |
| `POST /merge` | Concatenate 2+ PDFs |
| `POST /split` | Extract a page range (`parsePageList`, e.g. `1-3,5,7-9`) |
| `POST /rotate` | Rotate all or listed pages by an angle |
| `POST /img2pdf` | JPEG/PNG images → one PDF (page size or fit-to-image, margin) |
| `POST /watermark` | Diagonal text watermark (size/opacity/colour/angle) |
| `POST /pagenumbers` | Stamp `{n}`/`{total}` page numbers, 6 positions |
| `POST /inspect` | List AcroForm fields (name/type/value/required/readOnly) |
| `POST /fill` | Fill AcroForm fields. Default (`flatten: true`): stamps each TextField/Dropdown value as static page text at the field's position with a chosen standard font/size/colour, then removes the field — immune to viewer font-substitution, output not re-editable. `flatten: false`: legacy live-field fill (`setText`/`select`) |
| `POST /flatten` | Bake form fields into static content |
| `POST /addfields` | Draw new AcroForm fields (text/checkbox/dropdown) at PDF-point coordinates — see **Field designer** below |
| `POST /metadata` | Read/write Title/Author/Subject/Keywords/Creator |
| `POST /office-to-pdf` | DOCX/DOC/ODT/RTF/XLSX/XLS/ODS/CSV/PPTX/PPT/ODP/TXT → PDF via LibreOffice |
| `POST /pdf-to-office` | PDF → DOCX/ODT/TXT via LibreOffice (no Drive equivalent this direction) |
| `POST /google-to-pdf` | Google Docs/Sheets/Slides/Drive file URL → PDF, via the user's connected Drive |
| `POST /organize` | Reorder/delete/insert/extract pages — see **Organize Pages** below |
| `POST /sign` | Stamp a signature/date/initials onto page content — see **Fill & Sign** below |
| `POST /compress` | Shrink file size — see **Compress** below |
| `POST /annotate` | Burn highlight/strikeout/freehand-draw/sticky-note/text-box markup into page content — see **Annotate / Markup** below |
| `POST /compare-text` | Per-page plain text for both PDFs (text-diff tab of **Compare** — see below) |
| `POST /protect` | Encrypt a PDF with a password (qpdf, AES-256) — see **Password Protect / Remove Password** below |
| `POST /unprotect` | Decrypt a password-protected PDF given its password — see **Password Protect / Remove Password** below |
| `POST /crop` | Trim margins (mm, as seen on screen) off all or listed pages; sets CropBox and MediaBox — see **Extra tools** below |
| `POST /headerfooter` | Left/centre/right header and footer text with `{n}` `{total}` `{date}` `{filename}` tokens |
| `POST /nup` | 2/4/6/9 pages per A4 or Letter sheet |
| `POST /extract-images` | Pull embedded pictures out (JPEG unchanged, raw pictures as PNG, JPEG 2000 as .jp2), returned as a zip |
| `POST /ocr-layer` | Draw invisible OCR words (boxes measured in the browser) onto the original PDF |

`office-to-pdf`/`pdf-to-office` return `500` with an explicit message if LibreOffice isn't on the server image (`err.code === 'ENOENT'`). `google-to-pdf` checks the stored OAuth scope string for `drive.readonly` before calling the API and returns `needsReconnect: true` if it's missing.

---

## Field designer (`addfields`)

Client renders the PDF page to a canvas (`pdfjs-dist`), user drags a box to place a field; on save the box list posts to `/api/pdf/addfields` with PDF-point coordinates (bottom-left origin, converted from canvas pixels via `renderScale`).

**Field name uniqueness:** server de-dupes against existing AcroForm field names and other fields in the same batch (`field`, `field_1`, `field_2`, …).

**Typography — font, size, colour:**
- Font is one of pdf-lib's **14 built-in standard PDF fonts** (`StandardFonts`), picked from a grouped `<select>`: **Sans Serif** (Helvetica ×4 weights/styles), **Serif** (Times Roman ×4), **Monospace** (Courier ×4) — `STANDARD_FONT_GROUPS` in `PdfPage.jsx`. No fetching, no embedding, no fontkit — these fonts are part of the PDF spec and are guaranteed present in every PDF viewer.
- **Google Fonts were tried here and abandoned** after three separate dead ends, in order: (1) `fontkit` was never registered with pdf-lib, so every custom-font embed silently failed and fell back to Helvetica; (2) once registered, the IE6 User-Agent trick used to coax a TTF out of Google's CSS endpoint actually returns EOT (Embedded OpenType), which fontkit also can't parse — switching to an old-Android UA fixed that; (3) even with a correctly embedded custom TTF, Chrome, Edge (both PDFium), and Adobe Reader were all confirmed substituting Helvetica for a *form field's* embedded custom font at render/type time regardless — and fontkit itself hard-crashed (`Offset is outside the bounds of the DataView`) parsing certain Google Font files during that testing. None of this is fixable from the PDF-generation side; it's inherent to how these viewers regenerate AcroForm field appearances.
- **Live sample text:** the canvas overlay draws placeholder text ("Sample text", or a dropdown's first option) inside each text/dropdown field box at 55% opacity, in that field's actual `fontFamily`/`fontSize`/`color`, using a CSS approximation of the standard font (`standardFontCss()`) — a preview of what a fillable field's value will look like. Checkboxes don't get sample text.
- Dropdown/text fields call `field.updateAppearances(embeddedFont)` before `applyFieldTypography()` sets size/colour on the Default Appearance string — order matters, `updateAppearances` bakes the font into the AP stream first. `resolveStandardFont()` embeds+caches each `StandardFonts` entry once per request.

**Other field options:** border on/off + colour + width, required flag, multiline (text), options list (dropdown).

**Stamp static text instead of a fillable field (recommended for anything that must look right everywhere):** In the field designer, a **`text`** field with a **value typed in at design time** (`f.value`) is *not* turned into an AcroForm field at all — `addfields` draws it directly into the page's content stream with `page.drawText()` (same technique as the watermark/page-numbers tools). Content-stream text isn't re-rendered by the viewer the way form-field annotations are, so this is the one path immune to the AcroForm font-substitution behaviour above — it renders identically everywhere regardless of font choice. Leave the value blank to still get an ordinary empty fillable AcroForm text field. Dropdown and checkbox are unaffected; only `text` fields support the stamp path. **`/fill` defaults to the same stamp behaviour** (`flatten: true`): each TextField/Dropdown value is drawn at the field's widget position and the field removed, rather than written into the live field; pass `flatten: false` for the old live-field behaviour.

**Script fonts — allowed, but only on the stamp path.** `SCRIPT_FONTS` in `pdf.js` (10 Google Fonts: Pacifico, Lobster, Great Vibes, Sacramento, Alex Brush, Allura, Satisfy, Kalam, Caveat, Homemade Apple) are fetched as TTF (`fetchScriptFontBytes()`, old-Android UA — a modern UA gets woff2, IE6 gets EOT, neither of which fontkit can parse) and embedded via `resolveStampFont()`, which is called **only** from the two `page.drawText()` stamp sites (`addfields`'s text-with-value branch, `/fill`'s `stampFieldText`) — never from anything that calls `field.updateAppearances()`. Each font was manually verified against a real `page.drawText()` call with names/apostrophes/accented characters before being allowlisted; **Dancing Script was tested and excluded** — it hard-crashes fontkit (`Offset is outside the bounds of the DataView`) regardless of what's drawn, a bug in that specific font file, not the embedding approach. `addfields`/`fill` keep two separate font caches (`stampFonts` vs `acroFormFonts`/`fillFontCache`) so a script font resolved for a stamp can never leak into a dropdown or empty-fillable-field's font resolution, which stays `StandardFonts`-only. Client-side, the Script group is offered in Fill Form's picker (always stamp-only there) and a field-designer `text` field's picker, but not a `dropdown` field's picker (`STAMP_FONT_GROUPS` vs `STANDARD_FONT_GROUPS` in `PdfPage.jsx`) — picking a script font where the server can't safely honour it silently falls back to Helvetica.

---

## Organize Pages (`organize`)

Client renders every page of the uploaded PDF to a small thumbnail (same `pdfjs-dist` render-to-canvas technique as the field designer and page preview, just at thumbnail scale — `renderPdfThumbnails()` in `PdfPage.jsx`). The thumbnail grid supports plain HTML5 drag-and-drop reorder (no drag library — matches the "no new dependency" precedent set by the field designer's canvas interactions), an inline **Delete? Yes/No** confirm per page (routine deletion, not a `ConfirmModal` — per the Destructive confirms rule), and inserting all pages of a second uploaded PDF by dragging its thumbnails into the main list at any position.

Request body:
```json
{
  "dataUrl": "<primary PDF>",
  "insertedDataUrl": "<second PDF, only when any page below references it>",
  "pages": [ { "source": "primary", "index": 0 }, { "source": "inserted", "index": 2 }, { "source": "primary", "index": 1 } ]
}
```
`pages` is the complete final page order, referencing 0-based page indices in either source document. Deleting a page is simply omitting it. The server copies each requested page individually via `copyPages()` (the same primitive `/merge` uses) rather than batching by source, so the same source page can appear more than once without index collisions. **Extract as separate file** (per-thumbnail button) doesn't call `/organize` at all — it reuses the existing `/split` endpoint with `pages: "<n>"` for a single page, since that's already exactly what's needed.

## Fill & Sign (`sign`)

Distinct from `/fill` (AcroForm field values only) and `addfields`/field designer (empty fields for someone else to fill later): **Fill & Sign** stamps a signature directly into a PDF's page content, on any PDF, form or not. Client renders the current page to a canvas (same field-designer technique — drag a box to place, drag an existing placement to move it, Delete key to remove the selected one, canvas-pixel → PDF-point conversion via `renderScale`).

Three signature sources, picked before dragging a placement box:
- **Draw** — a small HTML5 canvas signature pad (plain mouse/touch strokes, no library), captured as a PNG data URL when a box is placed.
- **Type** — a name typed into a text input, rendered in a font from `STAMP_FONT_GROUPS` (defaults to Great Vibes). **Today's date** and **Initials** are the same `type` path with different preset text/font — no separate server-side type.
- **Image** — an uploaded photo/scan, sent as-is.

Request body:
```json
{
  "dataUrl": "<PDF>",
  "signatures": [
    { "page": 1, "x": 72, "y": 620, "width": 160, "height": 50, "type": "draw", "dataUrl": "<PNG of pad strokes>" },
    { "page": 1, "x": 72, "y": 560, "width": 120, "height": 30, "type": "type", "text": "Jane Doe", "fontFamily": "Great Vibes" },
    { "page": 2, "x": 400, "y": 40,  "width": 90,  "height": 24, "type": "type", "text": "12/03/2026", "fontFamily": "Helvetica" }
  ]
}
```
`x`/`y` are PDF points, bottom-left origin, matching every other coordinate-based tool in this file. `draw`/`image` types embed via `embedJpg`/`embedPng` (same mime-branching `/img2pdf` uses) and `page.drawImage()`; `type` reuses `resolveStampFont()` — the same script-font stamping mechanism as `/fill`'s flatten mode and `addfields`'s stamped text fields — and `page.drawText()`. All three are burned into the page content stream, not a live AcroForm annotation, so they're immune to the same Chrome/Edge/Adobe-Reader font-substitution issue described in **Field designer** below — that's the whole reason this tool exists as a stamp-based alternative to a fillable field.

## Compress (`compress`)

`pdf-lib` alone can't re-encode embedded images, so real compression has two tiers:

1. **Baseline (always runs):** `doc.save({ useObjectStreams: true })` — zero quality loss, pure PDF-structure optimization.
2. **Recompress images (opt-in, `recompressImages: true` + `quality: 'low'|'medium'|'high'`):** walks every indirect object via `doc.context.enumerateIndirectObjects()`, and for each `PDFRawStream` whose `/Subtype` is `/Image`, `/Filter` includes `DCTDecode` (i.e. it's already a JPEG), and `/ColorSpace` is plain `DeviceRGB`/`DeviceGray`/`CalRGB`/`CalGray` — re-encodes it through `sharp` at a quality/max-dimension for the chosen level (`COMPRESS_LEVELS` in `pdf.js`) and writes the new bytes back (`obj.contents = outBuf`) plus updated `/Width`, `/Height`, `/Length`. Anything that doesn't match — CMYK, Indexed, ICCBased, Separation, non-JPEG-encoded images — is **left byte-for-byte untouched**, and a re-encode that comes out larger than the original is discarded, never applied. This was deliberately scoped down from "recompress every embedded image" after testing pdf-lib's low-level stream API directly: reassigning `PDFRawStream.contents` and updating the dict works cleanly for a same-format JPEG→JPEG re-encode, but blindly rewriting a CMYK or indexed-palette image through sharp risks a color-space mismatch that corrupts the image, so that path was left alone rather than shipped un-tested against arbitrary real-world PDFs.

Response includes `originalSize`, `compressedSize`, `savedPercent`, and `imagesRecompressed` so the UI can show a before/after.

---

## Annotate / Markup (`annotate`)

Client renders each page to canvas (`pdfjs-dist`, the same technique used by the field designer/Fill & Sign/Organize) with a transparent overlay canvas on top for drawing marks. A **Select/Move** tool plus five markup tools — **Highlight** (drag a semi-transparent box), **Strikeout** (drag a line through text/an area), **Draw** (freehand pen, adjustable colour/width), **Sticky Note** (click once, type a comment), **Text Box** (drag a box, type a comment directly on the page) — mirror Graphics' Annotate tool's Select/Move convention and 20-step undo/redo (`annPast`/`annFuture`), applied to a PDF page canvas instead of an image canvas. Marks are tracked per page and persist as the user navigates a multi-page PDF; **Apply** posts the complete list to `/api/pdf/annotate` in one request.

Request body:
```json
{
  "dataUrl": "<PDF>",
  "annotations": [
    { "page": 1, "type": "highlight", "x": 72, "y": 700, "width": 200, "height": 14, "color": "#ffeb3b", "opacity": 0.4 },
    { "page": 1, "type": "strikeout", "x": 72, "y": 650, "width": 120, "height": 12, "color": "#ff0000", "strokeWidth": 1.5 },
    { "page": 1, "type": "draw", "points": [{ "x": 100, "y": 400 }, { "x": 110, "y": 410 }], "color": "#2563eb", "strokeWidth": 3 },
    { "page": 2, "type": "note", "x": 500, "y": 700, "text": "Check this figure", "color": "#ffeb3b" },
    { "page": 2, "type": "textbox", "x": 72, "y": 100, "width": 180, "height": 40, "text": "Reviewed 2026-09-12", "fontSize": 11, "color": "#000000", "background": "#fff3b0" }
  ]
}
```
`x`/`y` are PDF points, bottom-left origin, matching every other coordinate-based tool in this file. Highlight/strikeout/textbox are burned in via `page.drawRectangle()`/`page.drawLine()`/`page.drawText()` — the same primitives already used by watermark/page-numbers/addfields/sign; draw is a sequence of `page.drawLine()` segments between consecutive points (round line caps for a smoother look).

**Sticky notes:** `addStickyNoteAnnotation()` creates a real PDF `/Text` annotation dict via pdf-lib's low-level `context.obj()`/`context.register()` API, appended to the page's `/Annots` array — this shows as a native collapsible comment icon in Adobe Reader/Preview/most viewers, not just stamped page content. If that ever throws for a given PDF, the route catches it per-annotation and falls back to `stampNoteFallback()` — a visible icon square plus a word-wrapped comment box baked into the page content stream — so one bad note can't fail the whole request; the response's `notesFallenBack` count reports how many notes used the fallback.

## Compare (`compare-text` + client-side visual diff)

Two tabs, deliberately different execution locations:

- **Visual diff (client-side only):** both PDFs render to canvas at matching scale (`pdfjs-dist`), then a same-size offscreen canvas plus a per-pixel `ImageData` compare highlights changed regions in red over a faded grayscale base — same concept as Graphics' Image Diff route (`server/routes/graphics.js` `/diff`), reimplemented in-browser since no PDF-specific server processing is needed once both pages are already rendered to canvas. A sensitivity slider adjusts the per-channel threshold.
- **Text diff (`POST /compare-text`):** needs server-side text extraction, so this one tab does round-trip to the server. Reuses `pdf-parse`'s `pagerender` callback (the same technique `translateExtract.js`'s `extractFromPdf()` uses for Translate) to pull each page's text, grouping items into lines by y-coordinate. Returns `{ textA: string[], textB: string[] }` (one entry per page); the actual line-by-line diff runs client-side via a small LCS-based `diffLines()` helper (no new dependency — `diff`/`jsdiff` isn't already in `package.json`, and a page-at-a-time text compare doesn't need one).

Both tabs page through whichever PDF has more pages; a page missing from the shorter document just diffs against an empty string/canvas.

## Password Protect / Remove Password (`protect` / `unprotect`)

`pdf-lib` cannot write encrypted PDFs — confirmed against its README/issue tracker, there is no encryption-on-save support in the library. This is the one PDF Tools feature that needs a native binary beyond LibreOffice: **qpdf**, installed in the Dockerfile the same way as `ffmpeg`/`libreoffice`. `server/services/pdfCrypto.js` follows `officeConvert.js`'s exact pattern — write the input to a temp file, `execFile` the binary, read the temp output file back, clean up the temp dir either way, ENOENT-friendly error if qpdf isn't on the server image.

`protectPdf()` runs `qpdf --encrypt <userPassword> <ownerPassword> 256 --print=... --extract=... --modify=... -- in.pdf out.pdf` (AES-256; owner password defaults to the user password if not given separately). `unprotectPdf()` runs `qpdf --decrypt --password=<password> in.pdf out.pdf`; a qpdf failure whose stderr mentions the password is surfaced as a clear "Incorrect password." 400, not a generic 500.

Request bodies:
```json
{ "dataUrl": "<PDF>", "password": "secret", "ownerPassword": "optional-different-password", "permissions": { "printing": true, "copying": false, "modify": true } }
```
```json
{ "dataUrl": "<encrypted PDF>", "password": "secret" }
```
Client is two separate tools (**Password Protect** / **Remove Password**) rather than one toggle-mode tool — matches how Fill Form and Fill & Sign are already separate tools for related-but-distinct operations, rather than every related pair being collapsed into a mode switch.

All three password fields (open password, owner password, remove-password) use a shared `PasswordField` component with a show/hide (eye icon) toggle rather than a plain `type="password"` input. Remove Password's submit button is disabled until both a file and a password are entered; the server also 400s an empty password on `/unprotect` up front rather than letting `qpdf` fail on it. `PdfPagePreview` (shared by every tool that shows a live PDF preview) treats pdfjs's `PasswordException` as an expected "🔒 This PDF is password-protected" state, not a red preview-failed error — this fires every time Password Protect's result modal tries to preview the file it just encrypted, and previously showed a raw "Preview failed / No password given".

---

## Extra tools (added 2026-10-17)

Seven tools added after comparing against the open-source PDFCraft (AGPL-3.0: used as a feature checklist only, no code copied). Server logic is pure pdf-lib in `server/services/pdfTools.js`; the routes in `pdf.js` only validate and parse page ranges. Client components live in `client/src/pages/pdf/PdfExtraTools.jsx` and import the shared sub-components from `PdfPage.jsx` (circular import, safe because they are only used while rendering).

- **Pages to Images** (client-only): pdfjs renders each page at 72/150/300 DPI (pixel count capped), PNG or JPG; one page downloads directly, several go into a zip built with `jszip`.
- **Extract Images** (`/extract-images`): walks `enumerateIndirectObjects()` like Compress (`extractImages` in `server/services/pdfTools.js`). Single-filter `DCTDecode` JPEGs are copied out byte for byte (CMYK JPEGs are converted once to RGB JPEG). Raw pixel pictures (Flate/LZW/ASCII85/RunLength, via pdf-lib's `decodePDFRawStream`, so PNG predictors are undone) are rebuilt as PNG: DeviceGray/RGB/CMYK, ICCBased 1/3/4 components, Indexed palettes, 1/2/4/8/16 bits, `/Decode` inversion, and an `SMask` becomes the PNG's alpha channel (the mask is not listed as its own picture). JPEG 2000 is copied as `.jp2`. CCITT/JBIG2 (`bitonal`), unsupported colour spaces and oversize pictures are counted in `skipped` with `skippedReasons`; stencil masks and pictures under 8 px are ignored. Caps: 500 pictures, 60 megapixels each, 16 megapixels for ones that need a per-pixel conversion. `npm run test:pdf-tools`.
- **OCR** (`/ocr-layer`): the browser renders each page (about 200 DPI), runs `createOcrEngine({ lang: 'eng' })` (same on-device Tesseract as Measurements; English data is served from our own origin because the CSP blocks CDNs), and posts only word boxes. The server draws each word with `opacity: 0` so the page looks identical but is searchable. Pages that already have text are skipped; 30 pages per run; cancel supported. Other languages are not bundled.
- **Remove Blank Pages** (client + existing `/organize`): pages are rendered small and the share of non-white pixels decides what is "blank" (strictness slider; click a page to override).
- **Organize** gained **Reverse order** and tick-to-remove-many (no new route).
- **Crop**: margins are visual, so a rotated page's margins are mapped back onto its stored box. Both CropBox and MediaBox are set so later tools measure the cropped page.
- **Header & Footer**: Helvetica; characters WinAnsi cannot draw become `?` rather than failing the file.
- **N-up**: pages with no content stream cannot be embedded by pdf-lib, so they keep their cell as an empty slot. Source page `/Rotate` is not applied.

Not built (from the PDFCraft comparison): other OCR languages for PDF OCR (English only; Graphics' Extract Text has six). Built since: non-JPEG image extraction, the draggable crop box, "Continue with…" chaining, and the "Tell it what to do" boxes (below).

## Crop box, chaining and "Tell it what to do"

- **Crop Pages** has a draggable crop box on the page-1 preview (`CropPreview` in `client/src/pages/pdf/PdfExtraTools.jsx`): edges, corners or the whole box; pure maths in `dragMargins` (millimetres, minimum box 10 mm, margins rounded to 0.1 mm). The number boxes and the box stay in step.
- **Continue with…** (chaining): the result window (`PdfResultModal`) has a menu listing every tool that starts from a PDF (not Images/Text/Office/Google to PDF). Choosing one calls `continueWith` in `PdfPage.jsx`, which turns the result into a `File` and stores `{ mode, file, nonce }` in `PdfFlowContext`; the first `PdfUpload` of the target tool claims it and runs the tool's normal `onChange`, exactly as if the person had picked the file. Compress and Add Fields show their result in the page first; their View Result button opens the same window. The guide knows about the menu (`RULES` in `pdfTutor.js`).
- **Tell it what to do**: `VoiceCommandBar` (`client/src/pages/pdf/PdfVoice.jsx`) under Split, Rotate, Watermark, Page Numbers, Header & Footer, Crop, Pages per Sheet, Compress, Pages to Images, OCR, Metadata and Images to PDF. The browser turns speech into text (the page wraps everything in `VoiceInputProvider`); `POST /api/pdf/voice-command` (`server/services/pdfVoiceCommand.js`, shared field rules in `server/utils/voiceFields.js`) sends only the person's words and the tool's settings list to the **light-tier model from Settings**, then re-validates the answer against the tool's schema (clamped, typed, page ranges checked), logged as `pdf_voice`. Nothing runs until the person presses the tool's own button. **Password Protect, Remove Password, Fill, Sign and the other tools that touch secrets or need drawing have no box: a password is never sent to a model.** Tools that keep their own state register a receiver with `useVoiceTarget`. `npm run test:pdf-voice`.


---

## Layout and the PDF guide

**Layout** matches Video Tools: a left column (`w-56`, surface background) holding the title with an (i) info button, a search box (filters by name or hover tip, `/` jumps to it) and collapsible groups (Organise, Convert, Edit, Forms, Analyse). Every group and every tool has a hover tip on the right (`GROUP_TIPS`, `TOOL_TIPS` in `PdfPage.jsx`); the main panel is `max-w-5xl` (wider than Video Tools' `max-w-2xl`) because most PDF tools show a preview beside their settings. Not copied from Video Tools: the per-tool "Tell it what to do" voice bar.

**PDF guide:** the round graduation-cap button at the bottom right, same shared `components/tutor/TutorChat.jsx` as Video Tools and Finance. Client wrapper `client/src/pages/pdf/PdfTutorChat.jsx` (wording, starter questions, microphone provider); server `POST /api/pdf-tutor` (`server/routes/pdfTutor.js`, behind sign-in and the AI rate limit; PDF Tools has no feature flag) and `server/services/pdfTutor.js` (`CATALOG` of every tool, `RULES`, `NOT_POSSIBLE`; model = workspace `standard` tier). It cannot see the person's files, does not say whether a signature or stamped form is legally valid, and never offers Annotate/Crop as a way to hide sensitive text (PDF Tools cannot redact). A `missing`/`partly` answer is noted once per gap in the Suggestions inbox (source `pdfTutor`).

**When a PDF tool is added or removed:** add it to `MODES`, a `MODE_GROUPS` group, `TOOL_TIPS`, `TOOL_HELP` AND `CATALOG` in `pdfTutor.js`. `npm run test:pdf-tutor` (no database, no model) fails if any of these drift.

---

## Google Drive integration

`google-to-pdf` and the office-conversion Drive path (`officeToGooglePdf`) reuse the same `gmail_tokens` row and encrypted-token refresh pattern as `gmail.js`/`calendar.js` (`_googleAuthClient()`). Native Google Docs/Sheets/Slides export directly as PDF; binary Office files already in Drive are downloaded then re-uploaded through the same conversion path used for local file uploads.
