# Video Tools

The Video Tools page is a video toolkit mounted in Vault at **`/videos`**. It mirrors the Graphics page layout: grouped, searchable left sidebar; the active tool fills the main area.

**Frontend:** `vault/client/src/pages/VideosPage.jsx`  
**Backend:** `vault/server/routes/videos.js` (mounted at `/api/videos`)  
**ffmpeg helpers:** `vault/server/services/videoFfmpeg.js`  
**AI generate:** `vault/server/services/videoGenerateService.js`  
**Library storage:** `vault/server/services/videoLibraryService.js`

---

## Where work happens

| Tier | Tools | Notes |
|---|---|---|
| Hosted / paid | Generate clip | LLM brief expansion (`light` tier) + Replicate (default) or FAL; needs `REPLICATE_API_TOKEN` or `FAL_API_KEY` |
| Server (ffmpeg) | Clip, Convert, Join (+ crossfade), Reframe, Speed, Mute/replace audio, Normalize audio, Video → GIF, Export for Social, Overlay, Extract audio, Annotate (+ optional fade in/out), Slideshow, Caption studio, Thumbnail, File info | CPU-bound; requires `ffmpeg` + `ffprobe` on the server image |
| Library (disk + DB) | Saved media, Caption studio (library source) | `video_library` table + files under `{UPLOAD_DIR}/video-library/{userId}/` |
| Hosted or local | Auto-transcribe | Local dev: `whisper-cli` + model file. Hosted Vault (e.g. Railway): extracts the audio track and sends it to Gemini for a direct SRT transcript (`GEMINI_API_KEY` + a Gemini model in Settings) — paste SRT manually if neither is available |

Upload cap: **`VIDEO_MAX_UPLOAD_MB`** (default **80**). Processed outputs return as binary (`video/mp4`, `image/jpeg`, `audio/mpeg`) — not JSON data URLs.

---

## Sidebar groups

| Group | Tools |
|---|---|
| **Create** | Generate clip |
| **Optimise** | Convert / compress, Extract audio, Mute / replace audio, Normalize audio, Video → GIF, Export for Social |
| **Transform** | Clip / trim, Crop / reframe, Speed |
| **Compose** | Annotate, Overlay / watermark, Join videos, Slideshow, Caption studio |
| **Library** | Saved media |
| **Analyse** | File info, Thumbnail |

Cross-cutting: **ProcessingModal** for operations >2 s; **Use in another tool** loads the result blob back as the source file for chaining; every in-panel control across all 21 tools shows a themed hover popover explaining what it does, via the shared `client/src/components/Tooltip.jsx` component (same one used by Graphics and PDF Tools); every tool's title also carries a click-to-open help icon (`ToolHeader`, `getIcon('help-circle')`) opening a modal with that tool's full title/description/feature list (`TOOL_HELP`) — matching the same two-layer pattern as Graphics and PDF Tools.

---

## Tools

### Create

- **Generate clip** — describe a short clip (style, aspect, 3–10 s). Vault expands the brief with the workspace `light` model, then calls FAL. `POST /api/videos/generate`.

  **Reference image (optional):** upload or paste a URL.
  - **Animate this image** — `VIDEO_GENERATE_I2V_MODEL` (default `fal-ai/minimax/video-01-live/image-to-video`) uses the image as the first frame.
  - **Style suggestion only** — Gemini describes the image; description is woven into the text prompt.

  **YouTube example (optional):** paste a URL and **Load** (`POST /api/videos/youtube-preview`). Uses title, transcript excerpt (when captions exist), and optional Gemini thumbnail analysis. **Use YouTube thumbnail as starting frame** enables image-to-video from the thumbnail.

  Brief is optional when an image or YouTube reference is provided. `GEMINI_API_KEY` required for image/YouTube visual analysis.

### Optimise

- **Convert / compress** — re-encode H.264 MP4 with CRF (18–35) and optional max width. `POST /api/videos/convert`.
- **Extract audio** — export MP3 (or WAV via API `format=wav`). `POST /api/videos/extract-audio`.
- **Mute / replace audio** — strip soundtrack (`mode=mute`) or replace with uploaded audio (`mode=replace` + `audio` file). `POST /api/videos/audio`.
- **Normalize audio** — one-click loudness consistency fix via ffmpeg's `loudnorm` filter. Preset `quiet` / `normal` / `loud` maps to different I/LRA/TP targets — no raw ffmpeg parameters exposed. One-pass (not the more accurate two-pass measure-then-apply) — good enough for an occasional-user "fix my volume" tool without doubling encode time. `POST /api/videos/normalize`.
- **Video → GIF** — short looping GIF via ffmpeg's standard two-pass palette technique (palette generated from the trimmed/scaled clip, then applied with dithering) for cleaner colour than a naive conversion. Controls: fps (1–30, 10–20 typical), max width, optional start/end trim. `POST /api/videos/togif` → `image/gif`.
- **Export for Social** — one source video → an MP4 per ticked preset: **Reels/TikTok/Shorts** (9:16, trimmed from the start to 60s when longer), **Square** (1:1), **Landscape/YouTube** (16:9, no cap). Each preset reuses Reframe's aspect-crop logic (`mode: 'crop'`) with a shared crop **focus** (center/top/bottom/left/right) across all presets. `POST /api/videos/export-social` (multipart `video` + `presets` JSON array + `focus`) renders every preset server-side and returns JSON — not a raw video — with a small per-item poster-frame JPEG thumbnail (`thumbnailDataUrl`) plus width/height/bytes/`fileName`; the rendered MP4 buffers are held in a short-lived (30 min), per-user, in-memory cache keyed by the returned `exportId`, mirroring the `videoJobCache` pattern used by Generate. Individual files download via `GET /api/videos/export-social/:exportId/file/:presetId` (binary `video/mp4`, the same binary-out contract as every other tool); **Download all (zip)** streams `GET /api/videos/export-social/:exportId/zip` (`archiver`, same zip pattern as Graphics/PDF). Each result row also has its own **Save** button to store that preset in the video library.

### Transform

- **Clip / trim** — `startSec` + optional `endSec`, set numerically or by dragging in/out handles on a visual timeline (`ClipTimeline`) rendered beneath the native `<video>` preview once its `loadedmetadata` fires with a duration; the handles and the numeric fields stay in sync in both directions. `POST /api/videos/clip`.
- **Crop / reframe** — target aspect `9:16` / `16:9` / `1:1` / `4:5`; `mode=crop` (fill) or `pad` (letterbox); crop `focus` center/top/bottom/left/right. `POST /api/videos/reframe`.
- **Speed** — `speed` 0.25–4 (audio tempo follows). `POST /api/videos/speed`.

### Compose

- **Annotate** — burn a single text label (top / center / bottom) via ffmpeg `drawtext`. Google Fonts (20 curated), text/background colour, weight, size. Optional **fade in** / **fade out** (0–30s each, default 0 = old full-duration-static behaviour unchanged) drive the label's opacity via drawtext's `alpha` expression: `min(1, t/fadeIn)` ramps 0→1 over the fade-in window and `min(1, (duration-t)/fadeOut)` ramps 1→0 over the fade-out window, multiplied together when both are set — no `fade` filter chain needed, and the box/outline fade with the text since `alpha` scales the whole drawtext render. `POST /api/videos/annotate`.
- **Overlay / watermark** — image on video; position grid, scale %, opacity. `POST /api/videos/overlay` (`video` + `image`).
- **Join videos** — concatenate 2–12 clips into one MP4. Each clip is normalized (shared resolution, 30 fps, stereo AAC) then joined. Optional `crossfadeSec` (>0 uses xfade + acrossfade). Optional `maxWidth` (default 1280) and CRF. `POST /api/videos/join` with multipart field `videos` (repeated).
- **Slideshow** — turn 2–20 still images into a promo video with optional background music. Each image is letterboxed to a fixed target resolution per aspect (`9:16`→720×1280, `16:9`→1280×720, `1:1`→1080×1080, `4:5`→864×1080 — reuses Reframe's pad/crop scaling approach) for one shared `secondsPerSlide`. Slides are joined via the same xfade/join pipeline as Join Videos — optional crossfade (fixed 0.6s from the client toggle) or a hard cut. Optional audio track is always played with `-stream_loop -1` then the whole output is cut to the slideshow's total duration with `-t`: this loops short audio to fill the runtime and trims long audio to match, in one ffmpeg pass. `POST /api/videos/slideshow` — multipart `images` (repeated, 2–20) + optional `audio`, plus `secondsPerSlide`, `aspect` (`9:16`/`16:9`/`1:1`/`4:5`), `mode` (`pad` default / `crop`), `crossfadeSec`.
- **Caption studio** — upload a video or pick one from **Saved media**, paste SRT (or auto-transcribe on upload — hosted Vault via Gemini, local dev via whisper-cli), and burn styled subtitles. Same typography controls as Annotate (Google Fonts, weight, size, text + background colour). Optional **Save captioned result to library**. `POST /api/videos/burn-captions` (upload) or `POST /api/videos/library/:id/captions` (library item).
  - **Auto-transcribe**: `POST /api/videos/transcribe` (multipart `video`). Local dev extracts 16kHz mono WAV and runs `whisper-cli` → `{ text, source: 'whisper-local' }` (plain transcript, no timestamps — paste into SRT manually). Hosted (no whisper-cli binary) extracts an MP3 audio track (capped ~18MB) and sends it to Gemini asking for SRT output directly → `{ srt, source: 'gemini' }`, cleaned up by `server/services/srtUtils.js`'s tolerant SRT parser (handles missing blank lines, markdown fences, `.`-vs-`,` timestamp separators, re-numbers cues) before being returned — the client drops it straight into the SRT textarea.

### Library

- **Saved media** — list, preview, and delete videos/images saved from any tool. Each item stores the output file on disk plus JSON **transaction** metadata (tool settings: brief, style, caption style, etc.). **Save to library** on any tool result; thumbnails save as `mediaType: image`. **Add captions** opens Caption studio with that video pre-selected.

### Analyse

- **File info** — duration, resolution, codec, audio track, container. `POST /api/videos/probe`.
- **Thumbnail** — export a JPG frame at a given timestamp. `POST /api/videos/thumbnail`.

---

## API

```
GET  /api/videos/status
POST /api/videos/youtube-preview   JSON { url }
POST /api/videos/generate          JSON { brief?, provider?: 'replicate'|'fal', … } → submits the job, returns `{ requestId, provider, model, … }` quickly (`provider` only honoured when that provider's key is configured; falls back to the server default otherwise)
GET  /api/videos/generate/status   `?requestId=&endpoint=` → poll until `COMPLETED` (client polls every 3s)
POST /api/videos/probe|clip|convert|join|reframe|audio|speed|overlay|extract-audio|thumbnail|annotate|transcribe|burn-captions|normalize|togif
                                   multipart field `video` (+ tool-specific fields; join uses repeated `videos`; overlay uses `image`; audio replace uses `audio`)
POST /api/videos/slideshow        multipart field `images` (repeated, 2-20) + optional `audio`; fields `secondsPerSlide`, `aspect`, `mode`, `crossfadeSec`
POST /api/videos/export-social     multipart field `video` + `presets` (JSON array of `reels`|`square`|`landscape`) + `focus`
                                   → JSON `{ exportId, count, items: [{ presetId, label, aspect, width, height, bytes, fileName, thumbnailDataUrl }] }`
GET  /api/videos/export-social/:exportId/file/:presetId   binary `video/mp4` for one rendered preset
GET  /api/videos/export-social/:exportId/zip               binary `application/zip` of every rendered preset
GET  /api/videos/library
POST /api/videos/library            multipart `file` + `title`, `tool`, `mediaType`, `transaction` (JSON string)
GET  /api/videos/library/:id/stream authenticated file stream
DELETE /api/videos/library/:id
POST /api/videos/library/:id/captions  `srtText` or `srt` file + style fields + optional `saveToLibrary`
```

**Caption style fields** (annotate + burn-captions + library captions): `fontFamily` (Google Font name), `fontSize`, `fontColor`, `fontWeight` (`normal` | `bold`), `backgroundColor`. Server fetches TTF from Google Fonts on demand (`server/services/googleFonts.js`).

**Library** (`video_library` table): per-user rows with `title`, `tool`, `mediaType` (`video` | `image`), `transaction` JSONB, file on disk at `video-library/{userId}/{id}.mp4|.jpg`.

**Status** (`GET /api/videos/status`): `ffmpeg`, `maxUploadMb`, `generate.available` / `generate.model` / `generate.imageToVideoModel`, `transcribe.available` / `transcribe.source` (`'whisper-local'` | `'gemini'` | `null`) / `transcribe.note`.

---

## Environment

| Var | Purpose |
|---|---|
| `REPLICATE_API_TOKEN` | **Preferred** — video generation via Replicate (`minimax/hailuo-2.3`) |
| `VIDEO_GENERATE_PROVIDER` | Force `replicate` or `fal` (default: Replicate when token present) |
| `VIDEO_REPLICATE_MODEL` | Replicate text-to-video model (default `minimax/hailuo-2.3`) |
| `VIDEO_REPLICATE_I2V_MODEL` | Replicate image-to-video model (default `minimax/hailuo-2.3`) |
| `FAL_API_KEY` | Fallback video provider (also used by Graphics FAL) |
| `VIDEO_GENERATE_MODEL` | FAL text-to-video model (default `fal-ai/minimax/video-01-live`) |
| `VIDEO_GENERATE_I2V_MODEL` | FAL image-to-video when animating a seed (default `fal-ai/minimax/video-01-live/image-to-video`) |
| `VIDEO_MAX_UPLOAD_MB` | Upload size cap (default 80) |
| `GEMINI_API_KEY` | Reference image / YouTube thumbnail visual analysis; also powers hosted auto-transcribe (extracted audio → SRT) on deployments without whisper-cli |
| `LOCAL_WHISPER_COMMAND` | whisper binary (default `whisper-cli`) |
| `LOCAL_WHISPER_MODEL` | Path to ggml model for local transcribe |

**Railway:** `ffmpeg` is installed in the Vault Dockerfile. Redeploy after merging so clip/convert tools work in production.

---

## Feature flag

`videos` in workspace **Feature Access** (Settings → admin). Default **on** for admins; members follow `featureAccess.videos`.

---

## Hardening notes (2026-09-23)

- **Annotate position was silently ignored** — the Annotate submit handler appended `position` to the upload twice (once explicitly, once via `appendTextStyleFields`), which multer/express turns into an array instead of a string, so the server-side lookup always fell through to the `bottom-center` default. Fixed by removing the duplicate append; `captionStyleFromBody` also now defensively takes `array[0]` if a duplicate field ever recurs.
- **Caption Studio 500 in production** (`[Parsed_subtitles_0] Unable to open .../captions.srt` from ffmpeg, file demonstrably written and awaited beforehand) — root cause not conclusively pinned from code alone. Added a pre-flight `fs.stat` check in `burnSubtitles()` right before the ffmpeg call so a genuine missing/empty/permission problem now throws a clear, specific error instead of surfacing as ffmpeg's opaque filter-init message — if it recurs, the new error text will say exactly what's wrong.
- Fixed a duplicate `Outline=` key in `buildSubtitleForceStyle()`'s transparent-background branch (harmless to libass — last value wins — but was dead/confusing).
- **SSRF DNS-rebinding gap** in `videoGenerateService.js`'s seed-image fetcher (`checkSsrf`/`fetchBinaryUrl`): DNS was resolved once to validate the IP, then the actual request re-resolved the hostname at connect time, so an attacker could rebind DNS between the check and the connect. Fixed by pinning the connection to the already-validated IP (with `Host`/TLS `servername` kept as the original hostname). Also added IPv4-mapped-IPv6 detection (`::ffff:127.0.0.1`).
- Fixed a real bug in the same fetcher: `res.headers.get('content-type')` — Node's plain `http.IncomingMessage.headers` has no `.get()` method — was throwing on every URL-based seed-image fetch. Changed to `res.headers['content-type']`.
- `escapeDrawtext()` now also escapes `%` (drawtext's `%{...}` expansion syntax), closing a filter-string injection path via user-supplied Annotate text.
- `/join` and `/slideshow` now enforce an aggregate upload size cap (3× the per-file `VIDEO_MAX_UPLOAD_MB` limit) — previously only each individual file was capped, so e.g. 12 near-cap files on `/join` could buffer far more in RAM than intended (multer `memoryStorage`).
- `videos.js` now uses the structured `getLogger()` logger instead of `console.error`, and reports ffmpeg-unavailable via `SuggestionService.captureIf()` on `/status`, per the project's logging/suggestions conventions.
- **Active generate provider now visible, and selectable when both are configured** — the Create tool shows a `Provider: FAL/Replicate · <model>` badge (from `GET /api/videos/status`'s `generate.provider`/`generate.model`/`generate.availableProviders`/`generate.models`). When only one of `REPLICATE_API_TOKEN`/`FAL_API_KEY` is set, it's a read-only label with a nudge to add the other for more photoreal humans. When **both** are configured, it becomes a real dropdown — `POST /api/videos/generate` accepts an optional `provider: 'replicate' | 'fal'` field, resolved in `resolveVideoProvider(preferred)` (only honoured if that provider's key is actually present; the deploy-wide `VIDEO_GENERATE_PROVIDER` env var still overrides everything, per-request or not). A help icon on the badge opens a modal explaining the FAL-vs-Replicate difference (which model each runs, why the look differs, billing is independent per-provider, how to switch).
- **Choose from library, not just upload** — the shared `VideoUpload` picker (used by every single-file tool: Clip, Convert, Reframe, Speed, Mute/replace audio, Normalize, Video → GIF, Extract audio, Annotate, Overlay, Thumbnail, File info) now also offers a "choose from library" dropdown alongside "Choose video". Picking one fetches the saved file (`GET /api/videos/library/:id/stream`) and drops it into the same `sourceFile` used for a real upload — no new server endpoint. Caption Studio keeps its own dedicated library dropdown (it already reads the library asset server-side via `POST /api/videos/library/:id/captions`, so it isn't given this second, redundant picker).
- **Generate now reports estimated cost** — completed generation carries a `usage` object: `promptModel`/`promptInputTokens`/`promptOutputTokens`/`promptTokens` (the `light`-tier brief-expansion call, real token counts) plus `videoCostUsd` (flat per-clip estimate, since Replicate/FAL bill video generation per-clip/per-second, not per-token — see `calculateVideoCost()` in `costCalculator.js`'s `VIDEO_PRICING` table, update as provider rates change) and `totalEstimatedCostUsd` (sum). Surfaced in the Create tool's result panel and success toast. Threaded through `expandVideoPrompt` → `buildGenerationPayload` → `startVideoGeneration`/poll meta → `finalizeVideoResult`; the async job cache (`rememberVideoJob`) carries `promptUsage` across the `/generate` → `/generate/status` poll boundary. Not yet written to `usage_logs` (no `userId` in the finalize path) — chat/light-tier calls elsewhere in this flow (image description, YouTube thumbnail analysis) already log via `logUsage`, this only adds a value shown to the user, not an admin-dashboard line item.
