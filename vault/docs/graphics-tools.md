# Graphics Tools

The Graphics page is an image toolkit mounted in Vault at **`/graphics`**. It bundles nineteen tools behind a grouped, searchable left sidebar; the active tool fills the main area.

**Frontend:** `vault/client/src/pages/GraphicsPage.jsx`
**Backend:** `vault/server/routes/graphics.js` (mounted at `/api/graphics`)
**Local dev:** `npm run dev` from `vault/` (Vite `5173` + Vault server `3001`).

---

## Where work happens

Most tools run **locally and free** via [`sharp`](https://sharp.pixelplumbing.com/) on the server, or entirely in the browser on a `<canvas>`. Only a few touch paid/hosted services.

| Tier | Tools | Notes |
|---|---|---|
| Hosted / paid | Generate, Upscale, Background (production) | ComfyUI locally, Replicate in production; cost + token usage is logged and shown |
| Local (sharp) | Convert, Compress, Recolor, Crop/Resize, Canvas Extend, Effects, Adjust, Watermark, Collage, Metadata, Image Diff, Background (local) | CPU-bound, no network |
| Browser-only | Redact, Annotate, Palette, Picker, Extract Text (OCR) | Nothing is uploaded; OCR fetches its language model from a CDN on first use |

---

## Sidebar

Tools are grouped into five collapsible, single-open ("accordion") categories. **Create** is open on load; opening another category closes the previous one. A search box filters tools by name across all groups (temporarily revealing matches), headings use the primary accent colour, tools highlight on hover, and the active tool is filled.

| Group | Tools |
|---|---|
| **Create** | Generate |
| **Optimise** | Upscale, Convert, Compress |
| **Edit** | Crop/Resize, Canvas Extend, Annotate, Effects, Adjust, Watermark, Collage |
| **Analyse** | Picker, Palette, Extract Text, Image Diff |
| **Privacy** | Background, Recolor, Redact, Metadata |

---

## Tools

### Create

- **Generate** — text-to-image with style presets and size options. Local ComfyUI or hosted Replicate; per-image cost/token tracking. `POST /api/graphics/generate` (+ gallery routes).

### Optimise

- **Upscale** — enlarge artwork/small images. Model picker for faithful (Real-ESRGAN) vs enhanced (Clarity Pro), with fidelity control and cost display. Hosted models are whitelist-validated. `GET /api/graphics/upscale/info`, `POST /api/graphics/upscale`. (The one hosted/paid tool in this otherwise-local group.)
- **Convert** — change format between PNG, JPG, WebP, GIF, AVIF, TIFF, with a quality slider for lossy formats. `GET /api/graphics/convert/info`, `POST /api/graphics/convert`.
- **Compress** — batch re-encode at a chosen quality keeping each file's format; shows per-file and total savings, and never returns a larger file. `POST /api/graphics/compress`.

### Edit

- **Crop / Resize** — numeric resize (fit modes) **or** an interactive cropper: large pane, draggable/resizable selection with visible handles, rule-of-thirds guides, optional locked aspect ratio, and a live pixel-size readout. `POST /api/graphics/resize` (accepts an exact pixel `rect` for manual crop, using sharp `extract`).
- **Canvas Extend** — add padding *around* an image (opposite of cropping) with linked or independent top/right/bottom/left amounts and a white, custom-colour, or transparent fill. `POST /api/graphics/extend`.
- **Annotate** — browser-only mark-up: arrows, boxes, freehand pen, and text labels with colour and thickness/size controls; undo, clear, and flatten-to-PNG export.
- **Effects** — flip/mirror, rotate 90/180/270, border, round corners (transparent PNG), drop shadow, and filters: grayscale, sepia, invert, duotone (shadow/highlight colours). `POST /api/graphics/effect`.
- **Adjust** — brightness, contrast, saturation, hue shift, sharpness, colour temperature (warm/cool) and vignette. `POST /api/graphics/adjust` (sharp `modulate`/`linear`/`recomb`/`sharpen` + an SVG radial-gradient vignette).
- **Watermark** — text (colour, position, opacity) or image watermark (scale, opacity), with optional tiling. `POST /api/graphics/watermark`.
- **Collage** — arrange 2–9 images into a grid with columns, spacing and background colour. `POST /api/graphics/collage`.

### Analyse

- **Picker** — click anywhere (with zoom + drag-to-pan) to read a pixel's HEX and RGB, each with a copy button. Browser-only.
- **Palette** — extract 5–12 dominant colours (client-side quantisation) with HEX, RGB and rough share, plus copy buttons. Browser-only.
- **Extract Text (OCR)** — read text from screenshots/scans/receipts via `tesseract.js` (lazy-loaded; language model downloads once on first use). Progress readout, editable result, copy/.txt download; English, French, Spanish, German, Italian, Portuguese.
- **Image Diff** — highlight pixel differences between two images in red over a faded base, with an adjustable sensitivity threshold and a "% differ" stat. `POST /api/graphics/diff`.

### Privacy

- **Background** — one-click AI cut-out, leaving the subject transparent or flattened onto a solid colour. Local via the self-contained `@imgly/background-removal-node` ONNX model; production via a Replicate model. `POST /api/graphics/background`.
- **Recolor** — change the colour of a specific item via a zoomable eyedropper (loupe, drag-to-pan, averaged sampling), tolerance, and "match colour" vs "preserve shading" modes. `POST /api/graphics/recolor`.
- **Redact** — drag boxes over faces, plates or sensitive text and pixelate or blur them. Browser-only; live updates, undo/clear, PNG export.
- **Metadata** — strip EXIF, GPS, camera info, timestamps and colour profiles, reporting what was removed (EXIF orientation is baked in first). `POST /api/graphics/strip-metadata`.

---

## Dependencies & env

- **`sharp`** is pinned to `^0.32.6` so a single libvips is shared with the copy bundled inside `@imgly/background-removal-node` (avoids a duplicate-libvips crash).
- **`@imgly/background-removal-node`** powers local background removal; its `onnxruntime-node` native binaries must be present.
- **`tesseract.js`** (client) powers OCR.
- The Express JSON body limit is raised to `30mb` to accommodate multi-image collage uploads.
- Optional env: `REPLICATE_BG_MODEL`, `REPLICATE_BG_COST_USD` (hosted background removal).

See `CHANGELOG.md` (entries dated 2026-06-26 to 2026-06-27) for the full build history.
