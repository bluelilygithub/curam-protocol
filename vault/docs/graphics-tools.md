# Graphics Tools

The Graphics page is an image toolkit mounted in Vault at **`/graphics`**. It bundles forty-three tools behind a grouped, searchable left sidebar; the active tool fills the main area.

**Frontend:** `vault/client/src/pages/GraphicsPage.jsx` is only the shell (sidebar, header, Ask Graphics, Brand Kit, full-size preview, help modal, the guide). Each of the 43 tools is its own file in `client/src/pages/graphics/tools/<Name>Tool.jsx`, registered in `graphics/toolRegistry.js` and loaded the first time it is opened (then kept mounted but hidden, so settings and results survive switching tools). A tool owns its state, handlers and screen. What tools share lives in `graphics/shared.jsx` (pure helpers, `ExportMenu`, `BeforeAfter`, hooks `useUrlImport`, `useSocialPresets`, `useProcessingWhile`) and `graphics/GraphicsContext.js` (`useGraphics()`: compare toggle, Brand Kit, provider status, the full-size preview, `renderSendTo`/`renderResultMedia`, and the `handoff`).
**Adding a tool:** create `tools/<Name>Tool.jsx` (`export default function XTool({ active })`), add it to `toolRegistry.js`, `MODES`, `MODE_GROUPS`, `TOOL_TIPS`, `TOOL_HELP` in `GraphicsPage.jsx`, and `CATALOG` in `server/services/graphicsTutor.js` (`npm run test:graphics-tutor` fails if any is missing). Use `useProcessingWhile(label)` for the global "please wait" overlay and `ctx.renderSendTo(...)` for "Use in…".
**Hand-off between tools:** the shell's `sendImageTo(mode, dataUrl, name, prompt)` stores `{ mode, src, prompt, nonce }` in `handoff`; the target tool applies it once in a `useEffect` (it works even if the tool has not been opened yet). Tools whose result Ask Graphics may need back (Inpaint, Extract Element) call `registerResult(id, getter)`.
**Backend:** `vault/server/routes/graphics.js` (thin index, mounted at `/api/graphics`) requiring per-group route modules under `vault/server/routes/graphics/`:
- `shared.js` — comfy/FAL/Replicate generation core, upscale/background-removal helpers, cross-cutting utilities (`clampInt`, `outputFormatFor`, `GRAVITY_MAP`, `SOCIAL_PRESETS`, `CONVERT_FORMATS`, `dataUrlToBuffer`, etc.), and the shared `/fetch-url` import-by-URL route
- `create.js` — Generate, Animate (+ `/models`, `/status`, `/refine`, `/preflight`, `/gallery`)
- `optimise.js` — Upscale, Convert (+`runConvert`), Compress (+`runCompress`), Batch, Export for Social, Print Ready, Auto-enhance
- `transform.js` — Social presets, Crop/Resize (+`runResize`), Canvas Extend, Perspective, Smart Crop
- `enhance.js` — Pipeline, Effects, Adjust, Color Grading
- `compose.js` — Watermark (+`runWatermark`), Text, Composite, Collage, Favicon, Vectorize, AI Icon Library, Batch Text
- `retouch.js` — Extract, Inpaint, Background, Recolor
- `analyse.js` — Diff, Metadata/Strip-metadata, Blur Detection

`runConvert`/`runResize`/`runCompress`/`runWatermark` are each defined once in their owning module and imported by `optimise.js`'s batch/export-social paths — single-image and batch routes never duplicate logic. Route paths, methods, and request/response shapes are unchanged from the previous single-file layout; this was a pure file-organization split (2026-09-15).
**Local dev:** `npm run dev` from `vault/` (Vite `5173` + Vault server `3001`).

---

## Where work happens

Most tools run **locally and free** via [`sharp`](https://sharp.pixelplumbing.com/) on the server, or entirely in the browser on a `<canvas>`. Only a few touch paid/hosted services.

| Tier | Tools | Notes |
|---|---|---|
| Hosted / paid | Generate, Upscale, Background (production), Inpaint | ComfyUI locally, Replicate/FAL hosted; cost + token usage is logged and shown |
| Local (sharp) | Convert, Compress, Batch, Animate, Pipeline, Recolor, Crop/Resize, Canvas Extend, Effects, Adjust, Watermark, Collage, Remove Meta, Image Diff, Background (local), Perspective Correct, Smart Crop, Color Grading, Batch Text, Auto-enhance, Blur Detection, Print Ready, Extract Element, Export for Social | CPU-bound, no network |
| Browser-only | Annotate, Redact, Eraser, Picker, Histogram, Contrast, Palette, Extract Text (OCR), File Info, PDF → Images | Canvas work; nothing uploaded (OCR fetches its language model from a CDN on first use) |

---

## Start screen: "What do you want to do?"

Graphics opens on a list of jobs, not on a tool (`mode` is `'start'`; it is a view, not a tool, so it is not in `MODES`, the registry or the guide `CATALOG`). Each tile (post on social, website-ready pictures, product photos, print, clean up before sharing, fix a photo, create a picture, logo and icons) opens the first tool of that job and switches on a step bar above the tool: the steps in order, the current one marked, one line on what to do there, and a link to the next step (the picture itself travels with the existing **Use in…** on the result). The bar hides when the person opens a tool that is not a step; **All jobs** (bar or the button at the top of the list) goes back to the start. A box at the bottom of the start screen, **"Next time, open on the tool I used last instead of this screen"**, skips it from then on (off by default; `localStorage` keys `vault_graphics_open_on_last` and `vault_graphics_last_tool`; the button at the top of the tool list brings the screen back). A job is data in `client/src/pages/graphics/goals.mjs`: an ordered list of `{ tool, note }`. When saved recipes exist, a goal can point at a recipe in place of a list of tools and the tiles keep working. `GoalStart.jsx` draws the tiles and the bar; `npm run test:graphics-goals` fails if a step names a tool that is not in `MODES` or `toolRegistry.js`. To add a job: add an entry to `GOALS`.

---

## Sidebar

The page uses the same layout as Video Tools and PDF Tools: a narrow left list (title, info buttons, Brand Kit, search, groups) and the active tool in the main panel, with the Ask Graphics box above it. **Hovering any group or tool shows a plain-English tip** (`GROUP_TIPS`, `TOOL_TIPS` in `GraphicsPage.jsx`); the search box also matches the tips. Tools are grouped into seven collapsible, single-open ("accordion") categories. **Create** is open on load; opening another category closes the previous one. A search box filters tools by name across all groups (temporarily revealing matches), headings use the primary accent colour, tools highlight on hover, and the active tool is filled.

| Group | Tools |
|---|---|
| **Create** | Generate, Animate |
| **Optimise** | Upscale, Convert, Compress, Batch, Export for Social, PDF → Images, Print Ready, Auto-enhance |
| **Transform** | Crop / Resize, Canvas Extend, Perspective Correct, Smart Crop |
| **Enhance** | Effects, Adjust, Color Grading, Pipeline |
| **Compose** | Annotate, Text Overlay, Composite, Watermark, Batch Text, Collage, Favicon / Icons, Vectorize (SVG), AI Icon Library |
| **Retouch** | Background, Extract Element, Recolor, Eraser, Redact, Inpaint |
| **Analyse** | Picker, Histogram, Contrast (WCAG), Palette, Extract Text, Alt text & names, Blur Detection, Image Diff, Remove Meta, File Info |

---

## Tools

### Create

- **Generate** — text-to-image with style presets and size options. Local ComfyUI or hosted Replicate; per-image cost/token tracking. `POST /api/graphics/generate` (+ gallery routes). Sizes include landscape/portrait/square aspect presets. The follow-up **Augment** (image-to-image variation) step works on the local ComfyUI and **FAL** providers; on other hosted providers it's hidden with a short note. `POST /api/graphics/augment`.
- **Animate (GIF)** — combine several frames into an animated GIF with a frame-delay slider, loop toggle and ↑/↓ reorder. The first frame sets the size (others are cropped to cover). `POST /api/graphics/animate` (sharp decode → the pure-JS `gifenc` encoder, lazily required so the app boots without it).

### Optimise

- **Upscale** — enlarge artwork/small images. Model picker for faithful (Real-ESRGAN) vs enhanced (Clarity Pro), with fidelity control and cost display. Hosted models are whitelist-validated. `GET /api/graphics/upscale/info`, `POST /api/graphics/upscale`. (The one hosted/paid tool in this otherwise-local group.)
- **Convert** — change format between PNG, JPG, WebP, GIF, AVIF, TIFF or a multi-resolution **ICO** (16–256px, packed by hand), with a quality slider for lossy formats. Accepts **HEIC/HEIF** input where the server's libvips supports it (clear message otherwise). Also offers an **import-by-URL** row. `GET /api/graphics/convert/info`, `POST /api/graphics/convert`.
- **Compress** — batch re-encode at a chosen quality keeping each file's format (PNG is only reduced to a 256-colour palette at quality 85 or below; above that it stays lossless); shows per-file and total savings, and never returns a larger file. `POST /api/graphics/compress`.
- **Batch** — apply one operation across many images (up to 25) at once: **Watermark**, **Resize** (width/height, fit, or a social-size preset), **Convert format** (with quality), **Compress**, **Run a recipe** (a saved Pipeline recipe), or **Strip metadata**. Per-file results with individual downloads plus **Download all**; one bad file doesn't abort the run. Watermark/resize/convert/compress go through `POST /api/graphics/batch` (`{ op, items, params }`, each item's error isolated); strip-metadata still loops `POST /api/graphics/strip-metadata` client-side since there's no server batch path for it yet.
- **PDF → Images** — render each page of a PDF to a PNG entirely in the browser via `pdfjs-dist` (CDN worker), with a resolution selector (1×–4×), click-to-zoom, per-page and "download all". Nothing is uploaded.
- **Auto-enhance** — one-click brightness/contrast/saturation correction driven by histogram analysis (5th/95th percentile per channel). Shows applied multipliers with before/after compare. `POST /api/graphics/auto-enhance`.
- **Print Ready** — prepare any image for professional printing: sets the target DPI (150/300/600) in file metadata, optionally flattens transparency to white, adds a bleed margin (0–25mm), and outputs as TIFF/sRGB, TIFF/CMYK (offset print, mathematical RGB→CMYK conversion), PDF or PNG. `POST /api/graphics/print-ready`.
- **Export for Social** — one image in, a ZIP of every platform-size crop out, with a preview of each crop before you download. Tick any of the same social presets used by Crop/Resize (or "Select all"); each ticked size defaults to the same content-aware cover-crop as `/resize`'s preset path, but can be overridden per size with its own focus strategy (Auto/attention, most-detail, or a cardinal direction) since a 1:1 square and a 9:16 story rarely want the same framing from one source photo. Every crop is rendered as a thumbnail with its own download button before the ZIP is finalised — not happy with one, change its focus and re-export. `POST /api/graphics/export-social` (`{ imageDataUrl, presets: [presetId, ...], options: { [presetId]: { strategy } } }`, returns `items` with per-crop `imageDataUrl` alongside the `zipDataUrl`).

Every Graphics tool shows a **processing modal** (spinner + tool-specific label) while its operation runs. There is a single `ProcessingModal` instance rendered in `App.jsx` driven by `useProcessingStore`; Graphics (and the AI Icon Library) call `startProcessing`/`stopProcessing` rather than rendering their own overlay.

### Transform

- **Crop / Resize** — numeric resize (fit modes) **or** an interactive cropper: large pane, draggable/resizable selection with visible handles, rule-of-thirds guides, optional locked aspect ratio, and a live pixel-size readout. A **social size preset** dropdown (Instagram Post/Story/Portrait, Facebook Post/Cover, LinkedIn Post/Banner, X Post, YouTube Thumbnail, Pinterest Pin) fills in width/height and applies the same smart cover-crop. `GET /api/graphics/social-presets`, `POST /api/graphics/resize` (accepts `preset` to override `width`/`height`).
- **Canvas Extend** — add padding *around* an image with linked or independent top/right/bottom/left amounts and a white, custom-colour, or transparent fill. `POST /api/graphics/extend`.
- **Perspective Correct** — fix keystone / trapezoid distortion with horizontal and vertical shear sliders (−50…+50). Applied via sharp `affine()` with `nohalo` interpolation. Corner fill: transparent PNG, white, black, or a custom colour. `POST /api/graphics/perspective`.
- **Smart Crop** — crop to a target size or aspect ratio with a configurable focus strategy: **Attention** (saliency detection, default), **Entropy** (highest-detail region), or a cardinal direction. Width/height optional when aspect ratio given. `POST /api/graphics/smart-crop`.

### Enhance

- **Effects** — flip/mirror, rotate 90/180/270, free-angle rotate (−180°…180°, transparent or fill corners), border, round corners, drop shadow, and filters: grayscale, sepia, invert, duotone. `POST /api/graphics/effect`.
- **Adjust** — brightness, contrast, saturation, hue shift, levels (black/white point), gamma, sharpness, blur, noise reduction, colour temperature, vignette, with named presets saved to `localStorage`. `POST /api/graphics/adjust`.
- **Color Grading** — ten cinematic looks applied via channel recombination, modulate and linear tone mapping: Warm, Cool, Cinematic, Vintage, Fade, Matte, Vivid, Noir (B&W), Golden hour, Teal & orange. Before/after compare included. `POST /api/graphics/colorgrade`.
- **Pipeline** — chain up to 12 whitelisted edits in one server pass: the filters and tone edits, resize, border, **Crop to a shape** (1:1, 4:5, 16:9 … keeps the largest area of that shape at full size; subject, detail or middle), **Add text** and **Add my Brand Kit logo** (both through `runWatermark`), then optionally save as WebP / JPG / PNG / AVIF with a quality slider (a see-through picture becomes white in a JPG). `POST /api/graphics/pipeline` (`runPipeline()` in `enhance.js` is the one implementation; the route, Batch and recipes all call it). **Saved recipes:** a named list of these steps plus the output format, kept per person in table `graphics_recipes` (50 each; `GET/POST /api/graphics/recipes`, `DELETE /api/graphics/recipes/:id` into the shared recycle bin as kind `graphics-recipe`, `services/graphicsRecipes.js`, `routes/graphics/recipes.js`, `recycleBin/adapters/graphicsRecipes.js`). A recipe holds settings only, never pictures; the logo step reads the Brand Kit logo at run time, so a new logo shows up in old recipes (a clear message if none is saved). Saving under an existing name replaces that recipe. **AI steps in recipes:** `removebg` (Remove background) and `upscale` (2x or 4x, hosted service only) can be steps (`PAID_OPS` in `services/graphicsPaidSteps.js`, run by `applyPipelineStep`, each logged to the person as `graphics_background` / `graphics_upscale` so it counts towards the daily limit). Priced with the same estimators as the single Background and Upscale tools (`recipePrices()`); `GET /api/graphics/cost-preview?tool=recipe&recipeId=|paid=removebg,upscale:4&runs=&width=&height=` quotes a recipe and says how many pictures one call may carry. **The whole job is checked before it starts:** `guardPaidJob()` / `startPaidJob()` (`middleware/graphicsLimits.js`) refuse a Pipeline run or Batch call whose total would pass the day's limit (429 `GRAPHICS_DAILY_CAP_JOB`, with the cost and what is left), so the limit never stops a batch half way; the paid-job slot (2 at once) is taken the same way. **The job's cost is reserved while it runs** (`reservedUsd` in `graphicsLimits.js`, per person, in memory), because spending only reaches `usage_logs` as each AI call finishes: without it two jobs started together (two tabs) would see the same balance and could together pass the limit. The reservation is given back when the reply ends. Single-tool calls (one Generate, one Background) reserve nothing and are only blocked when the limit is already used up, so one or two of those can still land just past the limit. Note the limit is built from our own cost estimates (`estimated_cost_usd`), not the provider's bill. The Batch screen asks for that quote first, then sends the pictures in calls of 8 (remove background) or 4 (with upscale) to stay inside the gateway's five-minute limit. A Batch call over those sizes is refused with 400. For a recipe the server uses only the picture from each item: the steps, owner and AI settings are the server's, so an item cannot slip in different paid steps or charge someone else. A result that would pass the upscale size limit is refused before any AI call, and a failing service stops the picture with a message (later steps do not run). On a local copy background removal runs on the machine (free); upscale in a recipe needs the live site, and a run that includes it is refused **before any step runs** (Pipeline, Batch and the cost note, `UPSCALE_LIVE_ONLY`), never part way. `npm run test:graphics-paid-recipes`. Run one on a single picture in Pipeline, or on up to 25 in **Batch → Run a recipe** (`POST /api/graphics/batch` `{ op: 'pipeline', params: { recipeId } }`, steps read from the person's own recipe). `npm run test:graphics-recipes`.

### Compose

- **Annotate** — browser-only mark-up: arrows, boxes, freehand pen, text labels with Google Fonts support. Select/Move tool, undo/redo (20-step), flatten-to-PNG.
- **Text Overlay** — a real headline/caption, not a watermark: word-wrapped text (widths measured from the real Arial / Liberation Sans file by `server/services/graphicsTextMetrics.js`, shared with Watermark and Batch Text; falls back to a flat estimate if no font file is found, with one warning in the server log (`[graphics] no Arial / Liberation Sans font file found`) so it is not invisible; `npm run test:graphics-text`), size, colour, bold/normal, left/center/right align, optional background pill and stroke outline, position via the standard 9-point grid, max-width as a % of the image. `POST /api/graphics/text`.
- **Composite** — stack up to 8 text and/or logo/image layers onto a base image in one pass (first added = bottom, later = on top; add-order only, no drag-to-reposition or reordering in this first version). Each layer gets its own position (9-point grid or an `{x,y}` offset) and opacity. `POST /api/graphics/composite`.
- **Watermark** — text (colour, position, opacity) or image watermark (scale, opacity), with optional tiling. `POST /api/graphics/watermark`.
- **Batch Text** — stamp a templated text label (`{filename}`, `{index}`, `{n}`, `{date}`) onto up to 20 images at once. Controls: position, font size, text colour, opacity, optional backing rectangle. Per-image download. `POST /api/graphics/batch-text`.
- **Collage** — arrange 2–9 images into a grid with columns, spacing and background colour. `POST /api/graphics/collage`.
- **Favicon / Icons** — generate a full PNG icon set + `favicon.ico` (16/32/48) + `site.webmanifest` + `<head>` snippet from one image. `POST /api/graphics/favicon`.
- **Vectorize (SVG)** — trace a raster to SVG with colour count and detail controls. `POST /api/graphics/vectorize`.
- **AI Icon Library** — generate cohesive custom SVG icons from a subject with reference styles, refine and add more. `POST /api/graphics/icon-references`, `POST /api/graphics/icon-generate`.

### Retouch

- **Background** — AI cut-out (local ONNX or Replicate), then transparent, solid colour, gradient or image background. `POST /api/graphics/background`.
- **Extract Element** — paint a mask (green) over the element to keep; the rest is removed to transparency. Erase brush cleans up paint strokes, feather slider (0–30px) softens the mask edge. **Magic wand mode** (alongside Paint) selects connected similar-colour pixels from a click instead, with a tolerance slider — click again to add more, works with the Erase brush too. Server applies the mask deterministically — no AI. `POST /api/graphics/extract`.
- **Recolor** — change the colour of a specific item via zoomable eyedropper, tolerance, and shading mode. `POST /api/graphics/recolor`.
- **Eraser** — paint over parts of an image to erase them to full transparency, entirely in the browser; Restore mode paints original pixels back, undo/redo (20-step, Cmd/Ctrl+Z). **Magic wand mode** selects a connected similar-colour region from a click (tolerance slider) and erases/restores it instead of painting. Browser-only, always exports a PNG with alpha.
- **Redact** — drag boxes to blur or pixelate faces, plates or sensitive text. Browser-only, undo/redo.
- **Inpaint / Remove** — paint a mask and describe the fill; FAL mask-based inpainting. **Magic wand mode** selects a connected similar-colour region from a click (tolerance slider) instead of painting the mask by hand. `POST /api/graphics/inpaint`.

### Analyse

- **Picker** — click anywhere (with zoom + drag-to-pan) to read a pixel's HEX and RGB, each with a copy button. Browser-only.
- **Histogram** — RGB/luminance tonal distribution drawn on a canvas, with a per-channel toggle (combined RGB, luminance, or a single channel). Browser-only — pixels are read locally and the image is capped to 1000px for the tally.
- **Contrast (WCAG)** — enter a text/background colour pair (picker + hex) and see the WCAG 2.1 contrast ratio with AA/AAA pass/fail for normal and large text, a live preview and a swap button. Browser-only.
- **Palette** — extract 5–12 dominant colours (client-side quantisation) with HEX, RGB and rough share, plus copy buttons. Browser-only.
- **Extract Text (OCR)** — read text from screenshots/scans/receipts on the device via the shared `createOcrEngine` (`planner-core/ocr`). The worker, wasm and **language data are served from Vault's own origin** (the Content Security Policy blocks the tesseract.js CDN). **Languages: English, French, Spanish, German, Italian, Portuguese**, chosen in the tool; the data is `planner-core/ocr-assets/<lang>.traineddata.gz` (tesseract.js `4.0.0_best_int`, MIT, 0.7–3 MB each). The Vault build opts in with `ocrAssets({ langs })` in `client/vite.config.js`; other apps (Garden Planner) stay English-only so their builds do not grow. To add a language: drop its `.traineddata.gz` into `ocr-assets/`, add the id to `OCR_LANGUAGES` (vite.config.js) and `OWN_OCR_LANGS` (ocrEngine.ts), and to the dropdown in `ExtractTextTool.jsx`. Progress readout, editable result, copy/.txt download.
- **Alt text & names** — up to 10 pictures at a time: suggests alt text (one plain sentence, 125 characters or fewer, no "image of", readable words included) and a descriptive hyphenated file name for each, with an optional "where will they be used?" note that is passed to the model as information only. Everything is editable (live character count, "decoration only" gives empty alt text), then **Copy alt**, **Copy file name**, **Copy <img> tag** (HTML-escaped), **Download renamed**, **Download all renamed** or **Copy as list** for a spreadsheet. Nothing is sent until **Suggest** is pressed; the server sends a reduced copy (JPEG, longest side 1024px) to the first of the workspace's light / standard / Gemini models that can look at pictures (`canSeePictures`: Claude or Gemini, never a hard-coded id; a clear 503 if none). `POST /api/graphics/describe` (`routes/graphics/describe.js`, `services/graphicsDescribe.js`) is behind the paid-tool guard, logged as `graphics_describe` on the Usage dashboard and counted in the daily limit; `callModel` gained an optional `images` argument for this (Anthropic and Gemini only). The cost note shows the remaining limit (no price in advance: billed by tokens). The screen names who receives the picture, "Google Gemini" or "Anthropic Claude", before anything is sent (`GET /api/graphics/describe/info`, from the same model choice the real call makes), and disables Suggest with an explanation if no model can look at pictures. `npm run test:graphics-describe`. It is also the last step of the "Get a picture ready for a website" job on the start screen.
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
- **Magic wand selection** — a shared client-side flood-fill helper (`magicWandSelectionCanvas` in `GraphicsPage.jsx`) offered as a "Magic wand" mode alongside hand-painting in Inpaint, Eraser and Extract Element: click a pixel and every 4-connected pixel within a tolerance threshold is selected instead of brushed by hand. Computed on a capped working buffer (long edge ≤1200px) then scaled to the tool's own canvas size; each tool composites the resulting selection onto its own existing mask/display convention, so the mask format each tool posts to the server is unchanged. No new endpoint — entirely browser-side.
- **Recent results** — a button above the tool search opens a window of pictures finished earlier, **kept in this browser only** (IndexedDB database `vault-graphics-history`, `graphics/historyStore.mjs`; nothing is uploaded, so the browser-only tools keep their promise). **Off until the person ticks the box** (`localStorage['vault_graphics_history_on']`). Last 40 pictures, 150 MB in total, any single picture over 12 MB is skipped; the oldest go first; the same picture twice in a row is kept once. Each entry has a thumbnail, the tool, the time and the full picture, with **Open in <tool>**, **Use in…**, **Download** and **Delete** (inline Yes/No), plus **Clear all**. Recording is automatic for every tool that shows **Use in…** (`renderSendTo` in `GraphicsPage.jsx` renders a `HistoryRecorder`): the 18 picture-in/picture-out tools (Adjust, Auto-enhance, Background, Color Grading, Convert, Crop / Resize, Effects, Canvas Extend, Extract Element, Inpaint, Perspective, Pipeline, Recolor, Remove Meta, Smart Crop, Text Overlay, Upscale, Watermark). **Batch** keeps the first 6 results of each run (`BATCH_KEEP`; a batch can make 25, which would push everything else out of the 40) through `recordHistory()` in the Graphics context. Not yet kept: Generate (has its own gallery), Composite, Collage, Compress, Print Ready and other tools that do not show **Use in…**. The window says plainly that the browser can clear this storage on its own (Safari for sites not visited in a while, private windows keep nothing), that it is a convenience and not a backup, and shows a notice when the last result could not be kept. It keeps the picture, not the settings, so "run again with changes" means opening the picture in a tool and editing it again. `npm run test:graphics-history` (limits, fingerprint, time wording); the IndexedDB code itself was checked against fake-indexeddb in a scratch folder, not in a committed test.
- **Brand Kit** — a small persistent-settings panel (button above the tool search box, `briefcase` icon), not a tool of its own. Saves a logo, up to 3 brand colours and a plain-text font family name via the existing `settings` table (`GET/POST /api/settings`, key `graphics_brand_kit`, JSON value `{ logoDataUrl, colors, fontFamily }`). Purely additive: with no kit saved, every tool behaves exactly as before. Once saved, **Text Overlay** and **Watermark** show brand-colour swatch buttons next to their colour pickers, **Composite** shows the same swatches on each text layer plus a one-click "+ Logo from Brand Kit" quick-add layer button. Nothing auto-applies — every affordance is opt-in per click.
- **Tooltips** — every sidebar tool button, and every in-panel option (sliders, dropdowns, checkboxes, position pickers, colour pickers, action buttons — over 300 controls across all 41 tools plus AI Icon Library's own component) shows a themed hover popover explaining what it does, via the shared `client/src/components/Tooltip.jsx` component (`<Tooltip text="…">{control}</Tooltip>`). It clones the wrapped control and attaches hover/focus handlers + a ref directly to it (no extra wrapper DOM node, so it never affects layout/width/flex), and portals a small `position: fixed` card to `<body>` on hover, flipping above/below to stay in the viewport. 200ms fade, theme-aware colours (`var(--color-surface)`/`var(--color-border)`/`var(--color-text)`), `z-index: 30` (above dropdowns' `z-20`, below modals' `z-50`). Hover-only — it simply doesn't appear on touch devices, no dedicated tap variant. No external tooltip library.

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
- **Import by URL** (`/fetch-url`) uses `server/utils/safeFetch.js`: public addresses only (DNS resolved once, every address checked, the connection pinned to it so DNS rebinding cannot swap it; IPv6 and IPv4-mapped forms covered), every redirect hop re-checked (max 5), ports 80/443 only, no `user:pass@` URLs, streamed 25MB cap, 15s timeout, image content-type and bytes that really decode. `npm run test:safe-fetch`.
- **Content restrictions** (Settings, admin) are enforced on the server: `/generate` (the prompt and the refined prompt), `/augment` and `/inpaint` answer 422 `CONTENT_RESTRICTED` with the matches, and the page shows an OK-only notice (there is no "Continue anyway"). Matching is whole-word: a several-word restriction needs its phrase, or all of its words, and `gore` does not match `Singapore`. `/preflight` uses the same matcher.
- The Express JSON body limit is raised to `30mb` to accommodate multi-image collage uploads.
- Optional env: `REPLICATE_BG_MODEL`, `REPLICATE_BG_COST_USD` (hosted background removal).
- **Route/logic split:** Watermark, Resize, Convert and Compress are each implemented once as a plain `run*` function (`runWatermark`/`runResize`/`runConvert`/`runCompress`); their single-image routes are thin wrappers over these, and `POST /api/graphics/batch` calls the same functions per item — no duplicated logic between the single-file and batch paths.

See `CHANGELOG.md` (entries dated 2026-06-26 to 2026-06-28) for the full build history.

---

## Graphics guide

A round button at the bottom right (shared `components/tutor/TutorChat.jsx`, wrapper `client/src/pages/graphics/GraphicsTutorChat.jsx`) opens a mini chat: say what you want to do with an image and it returns the tools to use, in order, each with an "Open" button, or says a tool is missing or the job is beyond Graphics. `POST /api/graphics-tutor` (flag `graphics`, AI rate limit) -> `server/services/graphicsTutor.js`. It sees no images, only the conversation and the current tool. Model output is untrusted (tool ids checked against `CATALOG`). A "missing" or "partly" answer is filed once in the Suggestions inbox. It is separate from **Ask Graphics** (the box above the tools), which plans and runs a few edits.

Adding or removing a tool: update `MODES`, `MODE_GROUPS`, `TOOL_TIPS`, `TOOL_HELP` on the page and `CATALOG` in `graphicsTutor.js` (`npm run test:graphics-tutor` fails on any drift). Update `RULES`/`NOT_POSSIBLE` when behaviour changes.

---

## Tests

`npm run test:graphics` (`server/routes/graphics/graphics.test.js`) calls the real sharp-based routes with small fixtures and guards the bugs found in the 2026-10 review: phone-photo rotation kept by Convert/Compress, see-through PNG to JPG is white, Auto-enhance keeps full size, overlays larger than the image are shrunk instead of failing, crop by shape on rotated photos, and Remove Meta detecting a real GPS tag. No database needed. Rule for new routes: anything that builds a sharp pipeline starting with `.rotate()` must measure the image with `orientedSize()` (shared.js), and any overlay must go through `fitOverlay()`.

---

## Limits and safety nets

- **Per-pixel work runs in a worker thread** (`server/services/graphicsWorker.js`): Recolor, Extract Element, Image Diff, Print Ready's CMYK conversion and Vectorize. At most 2 at a time (`GRAPHICS_MAX_WORKERS`), the rest queue (12 deep, then 503). Before this a 25-megapixel recolor froze the whole server for over a second; the test measures the stall.
- **Image size cap** (`server/middleware/graphicsLimits.js`, `capImagePixels`): any image in a request body (also inside Batch lists and overlays) over 64 megapixels (`GRAPHICS_MAX_MEGAPIXELS`) is refused with 413 before a route decodes it.
- **Paid tools** (Generate, Augment, Upscale, Inpaint, Background, AI Icon Library, Alt text & names): `paidGuard` allows 2 paid jobs at once per person (`GRAPHICS_MAX_PAID_IN_FLIGHT`) and a rolling 24-hour spend cap of $5 per person (`GRAPHICS_DAILY_COST_CAP_USD`, 0 turns it off), read from `usage_logs` rows whose feature starts `graphics_`. Over the cap: 429 `GRAPHICS_DAILY_CAP`. Upscale also refuses outputs over 64 megapixels (`GRAPHICS_MAX_UPSCALE_MP`) before calling the service.
- **Cost shown before a paid tool runs:** a `CostNote` line (`graphics/shared.jsx`) sits above the run button of Generate, Augment, Inpaint, Upscale, Background and AI Icon Library: estimated price, and how much of the daily limit is left ("Estimated cost: ~$0.025. $4.50 of today's $5.00 limit left."). Free local runs say so; icons have no price in advance, so they show only the remaining limit; it turns amber when the job would pass the limit and red when the limit is already used up. It reads `GET /api/graphics/cost-preview?tool=&runs=&width=&height=&scale=` (`routes/graphics/cost.js`, not behind the paid guard so it still answers at the limit), which combines the price of one run with `spentLast24h()` in `buildCostPreview()` (`services/graphicsCostPreview.js`). `runs` multiplies the price, so a batch or recipe gets one total and one limit check before it starts. Wording is in `graphics/costText.mjs`. `npm run test:graphics-cost`.
- **Icon tools** take their model from Settings (light tier for the name list, standard for the icons) and now log their usage as `graphics_icons`, so they show on the Usage dashboard and count towards the cap.
- **Animate** accepts at most 40 frames.
- **Gallery**: 200 images per person, 8MB each. The list sends 320px previews (`thumbDataUrl`, made on save, and made a few at a time for older images); the full image comes from `GET /gallery/:id` when one is opened. Ids must be numbers; metadata must be a small object.

Encoding rules (all in `shared.js`): tool outputs in JPEG/WebP use quality 92 (`outputOptionsFor`, instead of sharp's 80), **Pipeline** keeps every step lossless (PNG) and encodes once at the end, and routes that read an image check it really is an image (`imageDataUrlToBuffer`) so a PDF gets a clean 400. Careful with sharp: passing `quality` or `effort` to `png()` silently turns on the palette.

## Small rules worth knowing

- **Animated pictures:** only Convert and Compress keep an animated GIF/WebP. Every editing tool (Resize, Extend, Effects, Adjust, Color Grading, Pipeline, Watermark, Text, Composite, Batch Text, Perspective, Smart Crop, Recolor, Remove Meta) refuses with 422 `ANIMATED_NOT_SUPPORTED` through `assertStill()` (shared.js) instead of silently returning the first frame. A batch reports it per item. New editing routes should call `assertStill(meta)`.
- **Composite `{x, y}` positions:** a value above 0 and below 1 is a fraction of the picture; 1 and above is pixels.
- **Favicon pack:** the manifest only has a `name` when the request sends one.
- **Ask Graphics errors:** 400 empty or oversize request, 422 "could not understand", 503 no AI model set up, 502 the AI provider failed (its message is not shown).

## Prompt refining

Generate improves the typed description before sending it to the image model (and the **Refine Prompt** button shows the result). On the hosted site this is one small call to the workspace's **light-tier model from Settings** (`refinePromptForImage` in `shared.js`; local development still uses the free local Ollama model). The call is logged as `graphics_refine`, so it shows on the Usage dashboard and counts toward the daily AI spend cap, and `/refine` is behind the same paid-tool guard. It never blocks a generation: with no model, a failed call, a refusal or an over-long answer, the person's own prompt is used unchanged. The refined text is checked against the admin's content restrictions before it goes to the image model. Ticking "skip refine" (`skipRefine`) makes no model call at all.
