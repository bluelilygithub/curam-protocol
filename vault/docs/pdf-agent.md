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
| `POST /fill` | Set values on existing AcroForm fields |
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
- Font is a Google Font, picked from a grouped `<select>`: **Script**, **Sans Serif**, **Serif** (`GOOGLE_FONT_GROUPS` in `PdfPage.jsx`). Each `<option>` is styled with its own `fontFamily` so the picker shows the face, not just the name.
- Client preloads every picker font via a Google Fonts CSS2 `<link>` (`ensureGoogleFontLoaded()`, deduped) so both the `<select>` and the canvas overlay can render the real face; a `document.fonts` `loadingdone` listener re-draws the overlay as each face finishes downloading (first paint may briefly fall back to system sans-serif).
- **Live sample text:** the canvas overlay draws placeholder text ("Sample text", or a dropdown's first option) inside each text/dropdown field box at 55% opacity, in that field's actual `fontFamily`/`fontSize`/`color` — a preview of what the filled-in value will look like, meant to be overwritten once the field is actually filled. Checkboxes don't get sample text.
- Server-side, `addfields` independently fetches each used family's TTF bytes (`fetchGoogleFontBytes()`, old-UA trick to force a TTF response instead of woff2, since pdf-lib can't parse woff2) and embeds it so the AcroForm field actually renders in that font in any PDF viewer — not just Vault's canvas. In-memory `_fontCache` per server process. Font name mismatches between client display and server embed aren't possible — both read `f.fontFamily` off the same field object.
- Dropdown/text fields call `field.updateAppearances(embeddedFont)` before `applyFieldTypography()` sets size/colour on the Default Appearance string — order matters, `updateAppearances` bakes the font family into the AP stream first.

**Other field options:** border on/off + colour + width, required flag, multiline (text), options list (dropdown).

**Font survives `/fill`:** pdf-lib regenerates a field's appearance stream whenever its value changes (`setText`/`select`), defaulting to Helvetica unless the *current* font is passed to `field.updateAppearances(font)` at that exact call site — the font baked in at `addfields` time doesn't carry forward automatically. `addfields` stashes the chosen family as a non-standard `CuramFont` dict entry on the field (`setCuramFontMarker()`); `/fill` reads it back (`getCuramFontMarker()`), re-embeds the same Google Font, and calls `updateAppearances()` after `setText`/`select` so filled-in text matches the field designer's typeface. Per-request font cache (`fillFontCache`) avoids re-embedding the same family per field. Fields without the marker (plain/legacy PDFs) fall back to pdf-lib's default (Helvetica) as before. `/flatten` is unaffected — it only regenerates fields whose `needsAppearancesUpdate()` is true, and a freshly-designed field's appearance stream is already current.

---

## Google Drive integration

`google-to-pdf` and the office-conversion Drive path (`officeToGooglePdf`) reuse the same `gmail_tokens` row and encrypted-token refresh pattern as `gmail.js`/`calendar.js` (`_googleAuthClient()`). Native Google Docs/Sheets/Slides export directly as PDF; binary Office files already in Drive are downloaded then re-uploaded through the same conversion path used for local file uploads.
