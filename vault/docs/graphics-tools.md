# Graphics Tools

The Graphics page is an image toolkit mounted in Vault at **`/graphics`**. It bundles twenty-three tools behind a grouped, searchable left sidebar; the active tool fills the main area.

**Frontend:** `vault/client/src/pages/GraphicsPage.jsx`
**Backend:** `vault/server/routes/graphics.js` (mounted at `/api/graphics`)
**Local dev:** `npm run dev` from `vault/` (Vite `5173` + Vault server `3001`).

---

## Where work happens

Most tools run **locally and free** via [`sharp`](https://sharp.pixelplumbing.com/) on the server, or entirely in the browser on a `<canvas>`. Only a few touch paid/hosted services.

| Tier | Tools | Notes |
|---|---|---|
| Hosted / paid | Generate, Upscale, Background (production) | ComfyUI locally, Replicate in production; cost + token usage is logged and shown |
| Local (sharp) | Convert, Compress, Recolor, Crop/Resize, Canvas Extend, Effects, Adjust, Watermark, Collage, Remove Meta, Image Diff, Background (local) | CPU-bound, no network |
| Browser-only | Redact, Annotate, Palette, Picker, Extract Text (OCR), File Info | Nothing is uploaded; OCR fetches its language model from a CDN on first use |

---

## Sidebar

Tools are grouped into five collapsible, single-open ("accordion") categories. **Create** is open on load; opening another category closes the previous one. A search box filters tools by name across all groups (temporarily revealing matches), headings use the primary accent colour, tools highlight on hover, and the active tool is filled.

| Group | Tools |
|---|---|
| **Create** | Generate |
| **Optimise** | Upscale, Convert, Compress |
| **Clipart & Icons** | Favicon / Icons, Vectorize (SVG), AI Icon Library |
| **Edit** | Crop/Resize, Canvas Extend, Annotate, Effects, Adjust, Watermark, Collage, Background, Recolor, Redact |
| **Analyse** | Picker, Palette, Extract Text, Image Diff, Remove Meta, File Info |

---

## Tools

### Create

- **Generate** — text-to-image with style presets and size options. Local ComfyUI or hosted Replicate; per-image cost/token tracking. `POST /api/graphics/generate` (+ gallery routes). The follow-up **Augment** (image-to-image variation) step requires the local ComfyUI provider; on a hosted provider it's hidden with a short note, since `POST /api/graphics/augment` only supports `local-comfyui`.

### Optimise

- **Upscale** — enlarge artwork/small images. Model picker for faithful (Real-ESRGAN) vs enhanced (Clarity Pro), with fidelity control and cost display. Hosted models are whitelist-validated. `GET /api/graphics/upscale/info`, `POST /api/graphics/upscale`. (The one hosted/paid tool in this otherwise-local group.)
- **Convert** — change format between PNG, JPG, WebP, GIF, AVIF, TIFF, with a quality slider for lossy formats. `GET /api/graphics/convert/info`, `POST /api/graphics/convert`.
- **Compress** — batch re-encode at a chosen quality keeping each file's format; shows per-file and total savings, and never returns a larger file. `POST /api/graphics/compress`.

### Clipart & Icons

- **Favicon / Icons** — turn one image into a ZIP of square PNG icons (16/32/48/64/180/192/256/512 px) plus an `apple-touch-icon`, a `site.webmanifest`, and a paste-ready `<head>` snippet. `POST /api/graphics/favicon` (sharp + archiver).
- **Vectorize (SVG)** — trace a raster image into scalable SVG paths with adjustable colour count (2–64) and detail (smooth/medium/detailed). Best for logos, icons and flat clipart; photos become posterised. Images are capped to 700px before tracing for speed. `POST /api/graphics/vectorize` (sharp-decoded pixels → imagetracerjs).
- **AI Icon Library** — generate a cohesive set of custom SVG icons from a subject. Step 1 fetches a curated grid of real reference icons from Lucide (`lucide-react`) and Font Awesome (CDN), labelled by source and multi-selectable. Step 2 sets count (5–20), colour, stroke weight (super thin/thin/regular/bold), fill style (outlined/filled/duotone), corners and detail. Step 3 shows the generated icons (~80px) with multi-select plus per-icon and bulk `.svg` downloads. You can **remove** unwanted icons (hover → ×) and then **refine & add more**: a feedback box plus an opt-in **Generate additional icons** tickbox (with a count) generates additional icons matching the kept set's style (kept names are passed so duplicates are avoided) and appends them. The generation prompt casts the model as a senior icon designer applying explicit craft principles (non-literal concepts, fewest paths, deliberate negative space, consistent optical weight). `POST /api/graphics/icon-references` and `POST /api/graphics/icon-generate` (accepts `existing` + `feedback`; Anthropic `claude-sonnet-4-6`; generated SVG is sanitised server-side). Model overridable via `GRAPHICS_ICON_MODEL`.

Every Graphics tool shows a **processing modal** (spinner + tool-specific label) while its operation runs. There is a single `ProcessingModal` instance rendered in `App.jsx` driven by `useProcessingStore`; Graphics (and the AI Icon Library) call `startProcessing`/`stopProcessing` rather than rendering their own overlay, so the same mechanism also covers the rest of the app (e.g. wellbeing, shares).

### Edit

- **Crop / Resize** — numeric resize (fit modes) **or** an interactive cropper: large pane, draggable/resizable selection with visible handles, rule-of-thirds guides, optional locked aspect ratio, and a live pixel-size readout. `POST /api/graphics/resize` (accepts an exact pixel `rect` for manual crop, using sharp `extract`).
- **Canvas Extend** — add padding *around* an image (opposite of cropping) with linked or independent top/right/bottom/left amounts and a white, custom-colour, or transparent fill. `POST /api/graphics/extend`.
- **Annotate** — browser-only mark-up: arrows, boxes, freehand pen, and text labels with colour and thickness/size controls. Text is typed in place (click on the image, type, Enter to place; double-click to re-edit). A Select / Move tool selects and drags any item to reposition it, Delete removes the selected item, plus undo, clear, and flatten-to-PNG save.
- **Effects** — flip/mirror, rotate 90/180/270, border, round corners (transparent PNG), drop shadow, and filters: grayscale, sepia, invert, duotone (shadow/highlight colours). `POST /api/graphics/effect`.
- **Adjust** — brightness, contrast, saturation, hue shift, sharpness, colour temperature (warm/cool) and vignette. `POST /api/graphics/adjust` (sharp `modulate`/`linear`/`recomb`/`sharpen` + an SVG radial-gradient vignette).
- **Watermark** — text (colour, position, opacity) or image watermark (scale, opacity), with optional tiling. `POST /api/graphics/watermark`.
- **Collage** — arrange 2–9 images into a grid with columns, spacing and background colour. `POST /api/graphics/collage`.
- **Background** — one-click AI cut-out, leaving the subject transparent, flattened onto a solid colour, blended behind a **two-colour gradient**, or composited over a **chosen background image** (scaled to cover). Blended mode offers from/to colour pickers, a direction (top→bottom, left→right, both diagonals, or radial) and a live preview; the gradient is generated as an SVG sized to the subject and composited under the cut-out. The action button reads "Remove background" for transparent and "Update background" otherwise. Local via the self-contained `@imgly/background-removal-node` ONNX model; production via a Replicate model. `POST /api/graphics/background` (optional `backgroundImageDataUrl` or `gradient` `{from,to,direction}`).
- **Recolor** — change the colour of a specific item via a zoomable eyedropper (loupe, drag-to-pan, averaged sampling), tolerance, and "match colour" vs "preserve shading" modes. `POST /api/graphics/recolor`.
- **Redact** — drag boxes over faces, plates or sensitive text and pixelate or blur them. Browser-only; live updates, undo/clear, PNG export.

### Analyse

- **Picker** — click anywhere (with zoom + drag-to-pan) to read a pixel's HEX and RGB, each with a copy button. Browser-only.
- **Palette** — extract 5–12 dominant colours (client-side quantisation) with HEX, RGB and rough share, plus copy buttons. Browser-only.
- **Extract Text (OCR)** — read text from screenshots/scans/receipts via `tesseract.js` (lazy-loaded; language model downloads once on first use). Progress readout, editable result, copy/.txt download; English, French, Spanish, German, Italian, Portuguese.
- **Image Diff** — highlight pixel differences between two images in red over a faded base, with an adjustable sensitivity threshold and a "% differ" stat. `POST /api/graphics/diff`.
- **Remove Meta** — strip EXIF, GPS, camera info, timestamps and colour profiles, reporting what was removed (EXIF orientation is baked in first). `POST /api/graphics/strip-metadata`.
- **File Info** — choose a file to read its name, MIME type, format, size (human-readable + exact bytes), pixel dimensions, aspect ratio, megapixels and last-modified date, alongside a preview. Browser-only — nothing is uploaded.

---

## Cross-cutting features

These work across the image→image tools (Convert, Upscale, Effects, Adjust, Watermark, Metadata, Recolour, Background, Crop/Resize, Canvas Extend):

- **Original preview** — the chosen source appears in the Result panel (badged "Original") before processing.
- **Compare** — a draggable before/after slider in the result header (dimension-preserving tools only).
- **Use in…** — send a result straight into another tool without re-uploading.
- **Export…** — client-side re-encode to PNG/JPG/WebP/AVIF with quality, max-side, target-KB, and JPG background controls.

---

## Dependencies & env

- **`sharp`** is pinned to `^0.32.6` so a single libvips is shared with the copy bundled inside `@imgly/background-removal-node` (avoids a duplicate-libvips crash).
- **`@imgly/background-removal-node`** powers local background removal; its `onnxruntime-node` native binaries must be present.
- **`tesseract.js`** (client) powers OCR.
- **`archiver`** bundles the favicon icon set into a ZIP server-side.
- **`imagetracerjs`** powers raster→SVG vectorisation (fed sharp-decoded pixels).
- **`dompurify` + `jsdom`** sanitise model-supplied SVG (AI Icon Library) with a real DOM rather than regex; loaded lazily so jsdom's cost is only paid when icons are generated. A regex strip remains as a fallback if the DOM sanitiser can't load.
- The Express JSON body limit is raised to `30mb` to accommodate multi-image collage uploads.
- Optional env: `REPLICATE_BG_MODEL`, `REPLICATE_BG_COST_USD` (hosted background removal).

See `CHANGELOG.md` (entries dated 2026-06-26 to 2026-06-28) for the full build history.
