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
| Server (ffmpeg) | Clip, Convert, Extract audio, Annotate, Caption studio, Thumbnail, File info | CPU-bound; requires `ffmpeg` + `ffprobe` on the server image |
| Library (disk + DB) | Saved media, Caption studio (library source) | `video_library` table + files under `{UPLOAD_DIR}/video-library/{userId}/` |
| Local dev only | Auto-transcribe | `whisper-cli` + model file; hosted Vault → paste SRT instead |

Upload cap: **`VIDEO_MAX_UPLOAD_MB`** (default **80**). Processed outputs return as binary (`video/mp4`, `image/jpeg`, `audio/mpeg`) — not JSON data URLs.

---

## Sidebar groups

| Group | Tools |
|---|---|
| **Create** | Generate clip |
| **Optimise** | Convert / compress, Extract audio |
| **Transform** | Clip / trim |
| **Compose** | Annotate, Caption studio |
| **Library** | Saved media |
| **Analyse** | File info, Thumbnail |

Cross-cutting: **ProcessingModal** for operations >2 s; **Use in another tool** loads the result blob back as the source file for chaining.

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

### Transform

- **Clip / trim** — `startSec` + optional `endSec`. `POST /api/videos/clip`.

### Compose

- **Annotate** — burn a single full-duration text label (top / center / bottom) via ffmpeg `drawtext`. `POST /api/videos/annotate`.
- **Caption studio** — upload a video or pick one from **Saved media**, paste SRT (or auto-transcribe on upload in local dev), and burn styled subtitles. Controls: font family (DejaVu / Liberation), weight, size, colour. Optional **Save captioned result to library**. `POST /api/videos/burn-captions` (upload) or `POST /api/videos/library/:id/captions` (library item).

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
POST /api/videos/generate          JSON { brief?, … } → submits FAL queue job, returns `{ requestId, endpoint, status }` quickly
GET  /api/videos/generate/status   `?requestId=&endpoint=` → poll until `COMPLETED` (client polls every 3s)
POST /api/videos/probe|clip|convert|extract-audio|thumbnail|annotate|transcribe|burn-captions
                                   multipart field `video` (+ tool-specific fields)
GET  /api/videos/library
POST /api/videos/library            multipart `file` + `title`, `tool`, `mediaType`, `transaction` (JSON string)
GET  /api/videos/library/:id/stream authenticated file stream
DELETE /api/videos/library/:id
POST /api/videos/library/:id/captions  `srtText` or `srt` file + style fields + optional `saveToLibrary`
```

**Caption style fields** (burn-captions + library captions): `fontFamily`, `fontSize`, `fontColor`, `fontWeight` (`normal` | `bold`).

**Library** (`video_library` table): per-user rows with `title`, `tool`, `mediaType` (`video` | `image`), `transaction` JSONB, file on disk at `video-library/{userId}/{id}.mp4|.jpg`.

**Status** (`GET /api/videos/status`): `ffmpeg`, `maxUploadMb`, `generate.available` / `generate.model` / `generate.imageToVideoModel`, `transcribe.available` / `transcribe.note`.

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
| `GEMINI_API_KEY` | Reference image / YouTube thumbnail visual analysis |
| `LOCAL_WHISPER_COMMAND` | whisper binary (default `whisper-cli`) |
| `LOCAL_WHISPER_MODEL` | Path to ggml model for local transcribe |

**Railway:** `ffmpeg` is installed in the Vault Dockerfile. Redeploy after merging so clip/convert tools work in production.

---

## Feature flag

`videos` in workspace **Feature Access** (Settings → admin). Default **on** for admins; members follow `featureAccess.videos`.
