# Graphics Tools

The Graphics page is an image toolkit mounted in Vault at **`/graphics`**. It bundles thirty-six tools behind a grouped, searchable left sidebar; the active tool fills the main area.

**Frontend:** `vault/client/src/pages/GraphicsPage.jsx`
**Backend:** `vault/server/routes/graphics.js` (mounted at `/api/graphics`)
**Local dev:** `npm run dev` from `vault/` (Vite `5173` + Vault server `3001`).

---

## Where work happens

Most tools run **locally and free** via [`sharp`](https://sharp.pixelplumbing.com/) on the server, or entirely in the browser on a `<canvas>`. Only a few touch paid/hosted services.

| Tier | Tools | Notes |
|---|---|---|
| Hosted / paid | Generate, Upscale, Background (production), Inpaint | ComfyUI locally, Replicate/FAL hosted; cost + token usage is logged and shown |
| Local (sharp) | Convert, Compress, Batch, Animate, Pipeline, Recolor, Crop/Resize, Canvas Extend, Effects, Adjust, Watermark, Collage, Remove Meta, Image Diff, Background (local), Perspective Correct, Smart Crop, Color Grading, Batch Text, Auto-enhance, Blur Detection | CPU-bound, no network |
| Browser-only | Annotate, Redact, Picker, Histogram, Contrast, Palette, Extract Text (OCR), File Info, PDF → Images | Canvas work; nothing uploaded (OCR fetches its language model from a CDN on first use) |

---

## Sidebar

Tools are grouped into five collapsible, single-open ("accordion") categories. **Create** is open on load; opening another category closes the previous one. A search box filters tools by name across all groups (temporarily revealing matches), headings use the primary accent colour, tools highlight on hover, and the active tool is filled.

| Group | Tools |
|---|---|
| **Create** | Generate, Animate |
| **Optimise** | Upscale, Convert, Compress, Batch, PDF → Images, Auto-enhance |
| **Transform** | Crop / Resize, Canvas Extend, Perspective Correct, Smart Crop |
| **Enhance** | Effects, Adjust, Color Grading, Pipeline |
| **Compose** | Annotate, Watermark, Batch Text, Collage, Favicon / Icons, Vectorize (SVG), AI Icon Library |
| **Privacy** | Background, Recolor, Redact, Inpaint |
| **Analyse** | Picker, Histogram, Contrast (WCAG), Palette, Extract Text, Blur Detection, Image Diff, Remove Meta, File Info |

---

## Tools

### Create

- **Generate** — text-to-image with style presets and size options. Local ComfyUI or hosted Replicate; per-image cost/token tracking. `POST /api/graphics/generate` (+ gallery routes). Sizes include landscape/portrait/square aspect presets. The follow-up **Augment** (image-to-image variation) step works on the local ComfyUI and **FAL** providers; on other hosted providers it's hidden with a short note. `POST /api/graphics/augment`.
- **Animate (GIF)** — combine several frames into an animated GIF with a frame-delay slider, loop toggle and ↑/↓ reorder. The first frame sets the size (others are cropped to cover). `POST /api/graphics/animate` (sharp decode → the pure-JS `gifenc` encoder, lazily required so the app boots without it).

### Optimise

- **Upscale** — enlarge artwork/small images. Model picker for faithful (Real-ESRGAN) vs enhanced (Clarity Pro), with fidelity control and cost display. Hosted models are whitelist-validated. `GET /api/graphics/upscale/info`, `POST /api/graphics/upscale`. (The one hosted/paid tool in this otherwise-local group.)
- **Convert** — change format between PNG, JPG, WebP, GIF, AVIF, TIFF or a multi-resolution **ICO** (16–256px, packed by hand), with a quality slider for lossy formats. Accepts **HEIC/HEIF** input where the server's libvips supports it (clear message otherwise). Also offers an **import-by-URL** row. `GET /api/graphics/convert/info`, `POST /api/graphics/convert`.
- **Compress** — batch re-encode at a chosen quality keeping each file's format; shows per-file and total savings, and never returns a larger file. `POST /api/graphics/compress`.
- **Batch** — apply one operation across many images at once: **Convert format** (with quality), **Resize** (width/height + fit), or **Strip metadata**. Per-file results with individual downloads plus **Download all**. Reuses `POST /api/graphics/convert`, `/resize` and `/strip-metadata` per file (no new route).
- **PDF → Images** — render each page of a PDF to a PNG entirely in the browser via `pdfjs-dist` (CDN worker), with a resolution selector (1×–4×), click-to-zoom, per-page and "download all". Nothing is uploaded.
- **Auto-enhance** — one-click brightness/contrast/saturation correction driven by histogram analysis (5th/95th percentile per channel). Shows applied multipliers with before/after compare. `POST /api/graphics/auto-enhance`.

Every Graphics tool shows a **processing modal** (spinner + tool-specific label) while its operation runs. There is a single `ProcessingModal` instance rendered in `App.jsx` driven by `useProcessingStore`; Graphics (and the AI Icon Library) call `startProcessing`/`stopProcessing` rather than rendering their own overlay.

### Transform

- **Crop / Resize** — numeric resize (fit modes) **or** an interactive cropper: large pane, draggable/resizable selection with visible handles, rule-of-thirds guides, optional locked aspect ratio, and a live pixel-size readout. `POST /api/graphics/resize`.
- **Canvas Extend** — add padding *around* an image with linked or independent top/right/bottom/left amounts and a white, custom-colour, or transparent fill. `POST /api/graphics/extend`.
- **Perspective Correct** — fix keystone / trapezoid distortion with horizontal and vertical shear sliders (−50…+50). Applied via sharp `affine()` with `nohalo` interpolation. Corner fill: transparent PNG, white, black, or a custom colour. `POST /api/graphics/perspective`.
- **Smart Crop** — crop to a target size or aspect ratio with a configurable focus strategy: **Attention** (saliency detection, default), **Entropy** (highest-detail region), or a cardinal direction. Width/height optional when aspect ratio given. `POST /api/graphics/smart-crop`.

### Enhance

- **Effects** — flip/mirror, rotate 90/180/270, free-angle rotate (−180°…180°, transparent or fill corners), border, round corners, drop shadow, and filters: grayscale, sepia, invert, duotone. `POST /api/graphics/effect`.
- **Adjust** — brightness, contrast, saturation, hue shift, levels (black/white point), gamma, sharpness, blur, noise reduction, colour temperature, vignette, with named presets saved to `localStorage`. `POST /api/graphics/adjust`.
- **Color Grading** — ten cinematic looks applied via channel recombination, modulate and linear tone mapping: Warm, Cool, Cinematic, Vintage, Fade, Matte, Vivid, Noir (B&W), Golden hour, Teal & orange. Before/after compare included. `POST /api/graphics/colorgrade`.
- **Pipeline** — chain up to 12 whitelisted edits in one server pass. `POST /api/graphics/pipeline`.

### Compose

- **Annotate** — browser-only mark-up: arrows, boxes, freehand pen, text labels with Google Fonts support. Select/Move tool, undo/redo (20-step), flatten-to-PNG.
- **Watermark** — text (colour, position, opacity) or image watermark (scale, opacity), with optional tiling. `POST /api/graphics/watermark`.
- **Batch Text** — stamp a templated text label (`{filename}`, `{index}`, `{n}`, `{date}`) onto up to 20 images at once. Controls: position, font size, text colour, opacity, optional backing rectangle. Per-image download. `POST /api/graphics/batch-text`.
- **Collage** — arrange 2–9 images into a grid with columns, spacing and background colour. `POST /api/graphics/collage`.
- **Favicon / Icons** — generate a full PNG icon set + `site.webmanifest` + `<head>` snippet from one image. `POST /api/graphics/favicon`.
- **Vectorize (SVG)** — trace a raster to SVG with colour count and detail controls. `POST /api/graphics/vectorize`.
- **AI Icon Library** — generate cohesive custom SVG icons from a subject with reference styles, refine and add more. `POST /api/graphics/icon-references`, `POST /api/graphics/icon-generate`.

### Privacy

- **Background** — AI cut-out (local ONNX or Replicate), then transparent, solid colour, gradient or image background. `POST /api/graphics/background`.
- **Recolor** — change the colour of a specific item via zoomable eyedropper, tolerance, and shading mode. `POST /api/graphics/recolor`.
- **Redact** — drag boxes to blur or pixelate faces, plates or sensitive text. Browser-only, undo/redo.
- **Inpaint / Remove** — paint a mask and describe the fill; FAL mask-based inpainting. `POST /api/graphics/inpaint`.

### Analyse

- **Picker** — click anywhere (with zoom + drag-to-pan) to read a pixel's HEX and RGB, each with a copy button. Browser-only.
- **Histogram** — RGB/luminance tonal distribution drawn on a canvas, with a per-channel toggle (combined RGB, luminance, or a single channel). Browser-only — pixels are read locally and the image is capped to 1000px for the tally.
- **Contrast (WCAG)** — enter a text/background colour pair (picker + hex) and see the WCAG 2.1 contrast ratio with AA/AAA pass/fail for normal and large text, a live preview and a swap button. Browser-only.
- **Palette** — extract 5–12 dominant colours (client-side quantisation) with HEX, RGB and rough share, plus copy buttons. Browser-only.
- **Extract Text (OCR)** — read text from screenshots/scans/receipts via `tesseract.js` (lazy-loaded; language model downloads once on first use). Progress readout, editable result, copy/.txt download; English, French, Spanish, German, Italian, Portuguese.
- **Image Diff** — highlight pixel differences between two images in red over a faded base, with an adjustable sensitivity threshold and a "% differ" stat. `POST /api/graphics/diff`.
- **Remove Meta** — first shows the current metadata (format, dimensions, colour space, camera/lens, GPS) via `POST /api/graphics/metadata` (`exif-reader`), then strips EXIF, GPS, camera info, timestamps and colour profiles, reporting what was removed (EXIF orientation is baked in first). `POST /api/graphics/strip-metadata`.
- **Blur Detection** — Laplacian variance sharpness analysis: classifies images as **Sharp** (variance ≥ 500), **Soft** (100–500) or **Blurry** (< 100) with a numeric score. `POST /api/graphics/blur-detect`.
- **File Info** — choose a file to read its name, MIME type, format, size (human-readable + exact bytes), pixel dimensions, aspect ratio, megapixels and last-modified date, alongside a preview. Browser-only — nothing is uploaded.

---

## Cross-cutting features

These work across the image→image tools (Convert, Upscale, Effects, Adjust, Watermark, Metadata, Recolour, Background, Crop/Resize, Canvas Extend):

- **Original preview** — the chosen source appears in the Result panel (badged "Original") before processing.
- **Compare** — a draggable before/after slider in the result header (dimension-preserving tools only).
- **Use in…** — send a result straight into another tool without re-uploading.
- **Import by URL** — Convert, Crop/Resize, Adjust, Effects and Background each offer a "…or paste an image URL" row backed by `POST /api/graphics/fetch-url` (server-side fetch sidesteps browser CORS).
- **Export…** — client-side re-encode to PNG/JPG/WebP/AVIF with quality, max-side, target-KB, and JPG background controls.
- **Keyboard shortcuts** — `/` focuses the tool search, `Esc` closes the full-screen preview (or clears the search), and `Cmd/Ctrl+Z` / `Cmd/Ctrl+Shift+Z` undo/redo in Annotate and Redact.

---

## Dependencies & env

- **`sharp`** is pinned to `^0.32.6` so a single libvips is shared with the copy bundled inside `@imgly/background-removal-node` (avoids a duplicate-libvips crash).
- **`@imgly/background-removal-node`** powers local background removal; its `onnxruntime-node` native binaries must be present.
- **`tesseract.js`** (client) powers OCR.
- **`archiver`** bundles the favicon icon set into a ZIP server-side.
- **`imagetracerjs`** powers raster→SVG vectorisation (fed sharp-decoded pixels).
- **`dompurify` + `jsdom`** sanitise model-supplied SVG (AI Icon Library) with a real DOM rather than regex; loaded lazily so jsdom's cost is only paid when icons are generated. A regex strip remains as a fallback if the DOM sanitiser can't load.
- **`gifenc`** (pure JS, no native build) encodes the Animate tool's GIFs. It's lazily `require`d inside the `/animate` route, so a missing install returns a friendly 501 rather than breaking boot — run `npm install` to enable it.
- **`exif-reader`** parses EXIF/GPS for the Remove Meta viewer.
- **`pdfjs-dist`** (already used elsewhere) renders PDF pages to canvas for the PDF → Images tool; its worker loads from a CDN.
- **Inpaint** is FAL-only and posts the image + mask to a configurable FAL inpaint endpoint (`GRAPHICS_INPAINT_MODEL`, default `fal-ai/flux-lora/inpainting`); white mask pixels mark the area to repaint.
- **Import by URL** uses Node's global `fetch` with a basic SSRF guard (blocks localhost/private hosts), an image-only content-type check, a 25MB cap and a 15s timeout.
- The Express JSON body limit is raised to `30mb` to accommodate multi-image collage uploads.
- Optional env: `REPLICATE_BG_MODEL`, `REPLICATE_BG_COST_USD` (hosted background removal).

See `CHANGELOG.md` (entries dated 2026-06-26 to 2026-06-28) for the full build history.
