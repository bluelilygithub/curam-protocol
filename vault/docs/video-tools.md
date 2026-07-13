# Video Tools

The Video Tools page is a video toolkit mounted in Vault at **`/videos`**. It mirrors the Graphics page layout: grouped, searchable left sidebar; the active tool fills the main area.

**Frontend:** `vault/client/src/pages/VideosPage.jsx`  
**Backend:** `vault/server/routes/videos.js` (mounted at `/api/videos`)  
**ffmpeg helpers:** `vault/server/services/videoFfmpeg.js`  
**AI generate:** `vault/server/services/videoGenerateService.js`

---

## Where work happens

| Tier | Tools | Notes |
|---|---|---|
| Hosted / paid | Generate clip | LLM brief expansion (`light` tier) + FAL text-to-video; needs `FAL_API_KEY` |
| Server (ffmpeg) | Clip, Convert, Extract audio, Annotate, Captions (burn), Thumbnail, File info | CPU-bound; requires `ffmpeg` + `ffprobe` on the server image |
| Local dev only | Auto-transcribe | `whisper-cli` + model file; hosted Vault → paste SRT instead |

Upload cap: **`VIDEO_MAX_UPLOAD_MB`** (default **80**). Processed outputs return as binary (`video/mp4`, `image/jpeg`, `audio/mpeg`) — not JSON data URLs.

---

## Sidebar groups

| Group | Tools |
|---|---|
| **Create** | Generate clip |
| **Optimise** | Convert / compress, Extract audio |
| **Transform** | Clip / trim |
| **Compose** | Annotate, Captions |
| **Analyse** | File info, Thumbnail |

Cross-cutting: **ProcessingModal** for operations >2 s; **Use in another tool** loads the result blob back as the source file for chaining.

---

## Tools

### Create

- **Generate clip** — describe a short clip (style, aspect, 3–10 s). Vault expands the brief with the workspace `light` model, then calls FAL (`VIDEO_GENERATE_MODEL`, default `fal-ai/minimax/video-01-live`). `POST /api/videos/generate`. Inline base64 or provider URL in the response.

### Optimise

- **Convert / compress** — re-encode H.264 MP4 with CRF (18–35) and optional max width. `POST /api/videos/convert`.
- **Extract audio** — export MP3 (or WAV via API `format=wav`). `POST /api/videos/extract-audio`.

### Transform

- **Clip / trim** — `startSec` + optional `endSec`. `POST /api/videos/clip`.

### Compose

- **Annotate** — burn a single full-duration text label (top / center / bottom) via ffmpeg `drawtext`. `POST /api/videos/annotate`.
- **Captions** — paste SRT text (or upload `.srt`) and burn subtitles. Local dev: optional **Auto-transcribe** via whisper-cli. `POST /api/videos/transcribe`, `POST /api/videos/burn-captions`.

### Analyse

- **File info** — duration, resolution, codec, audio track, container. `POST /api/videos/probe`.
- **Thumbnail** — export a JPG frame at a given timestamp. `POST /api/videos/thumbnail`.

---

## API

```
GET  /api/videos/status
POST /api/videos/generate          JSON { brief, style, aspect, durationSec }
POST /api/videos/probe|clip|convert|extract-audio|thumbnail|annotate|transcribe|burn-captions
                                   multipart field `video` (+ tool-specific fields)
```

**Status** (`GET /api/videos/status`): `ffmpeg`, `maxUploadMb`, `generate.available` / `generate.model`, `transcribe.available` / `transcribe.note`.

---

## Environment

| Var | Purpose |
|---|---|
| `FAL_API_KEY` | Enable Generate clip |
| `VIDEO_GENERATE_MODEL` | FAL model id (default `fal-ai/minimax/video-01-live`) |
| `VIDEO_MAX_UPLOAD_MB` | Upload size cap (default 80) |
| `LOCAL_WHISPER_COMMAND` | whisper binary (default `whisper-cli`) |
| `LOCAL_WHISPER_MODEL` | Path to ggml model for local transcribe |

**Railway:** `ffmpeg` is installed in the Vault Dockerfile. Redeploy after merging so clip/convert tools work in production.

---

## Feature flag

`videos` in workspace **Feature Access** (Settings → admin). Default **on** for admins; members follow `featureAccess.videos`.
