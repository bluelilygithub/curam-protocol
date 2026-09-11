# PDF Tools

The PDF Tools page is a PDF toolkit mounted in Vault at **`/pdf`**. Stateless — every tool takes a `dataUrl` (base64 PDF/image) in and returns a `dataUrl` out; nothing is persisted server-side and there is no dedicated DB table.

**Frontend:** `vault/client/src/pages/PdfPage.jsx`
**Backend:** `vault/server/routes/pdf.js` (mounted at `/api/pdf`)
**Office conversion:** `vault/server/services/officeConvert.js` (LibreOffice headless)
**Text → PDF:** `vault/server/services/textToPdf.js`
**PDF manipulation:** `pdf-lib` · **Image handling:** `sharp` · **Google Drive:** `googleapis` (reuses `gmail_tokens` OAuth)

Not currently gated by a feature flag and not listed in `FEATURE_ACCESS_KEYS` — same known-gap pattern as `translate`/`guitar` (see **Feature access** in `vault/CLAUDE.md`).

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

## Google Drive integration

`google-to-pdf` and the office-conversion Drive path (`officeToGooglePdf`) reuse the same `gmail_tokens` row and encrypted-token refresh pattern as `gmail.js`/`calendar.js` (`_googleAuthClient()`). Native Google Docs/Sheets/Slides export directly as PDF; binary Office files already in Drive are downloaded then re-uploaded through the same conversion path used for local file uploads.
