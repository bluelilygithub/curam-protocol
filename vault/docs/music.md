# Music

`/music` (nav **Music**, Content Creation, flag `music`, default on): upload a video, pick a mood (or describe the music), get **3 instrumental options cut to the video's exact length**, preview each one mixed against the video, then export the **audio (WAV)** or the **video (MP4) with the music mixed in**, ducked under any speech.

Built from a spec for a standalone local Python/Gradio tool, adapted to live inside Vault (Node route + service, React page, the ffmpeg already used by Video Tools). Nothing is stored in the database — jobs live in memory with their files in a temp directory and expire after `MUSIC_JOB_TTL_MIN` (default 90 min).

## How it works

1. `POST /api/music/jobs` (multipart `video`, `mood`, optional `prompt`, `bpm`) — saves the upload to a job directory, reads its length with ffprobe, starts generating **in the background** and answers `202` immediately. The page polls `GET /api/music/jobs/:id` every 2 s for progress.
2. Three generations run in parallel with different seeds. Each clip is then **fitted** (looped if needed, trimmed to the exact video length, 0.5 s fade in, 2 s fade out ending on the final frame) → `option_N.wav`.
3. `GET .../options/:n/preview?volume=&ducking=` renders a small 480p MP4 with the music mixed in (cached per setting inside the job). `GET .../options/:n/video?...` is the full-quality export (picture stream-copied where possible, re-encoded if the source codec can't go into MP4). `GET .../options/:n/audio` is the fitted WAV.
4. `DELETE /api/music/jobs/:id` removes the files (the page does this on leaving, and when generating again).

Files: `server/routes/music.js`, `server/services/music/` (`musicPrompts.js`, `musicProviders.js`, `musicFit.js`, `musicJobs.js`), shared `server/middleware/ffmpegRoute.js` (also used by Video Tools), client `client/src/pages/MusicPage.jsx`.

## Backend (swappable)

`musicProviders.js` defines the interface — `provider.generate({ prompt, durationS, seed }) → WAV bytes`, `provider.maxClipS`, `provider.describe()`:

- **`replicate`** (default): Meta MusicGen on Replicate (`MUSIC_REPLICATE_MODEL`, default `meta/musicgen`; version `MUSIC_REPLICATE_MODEL_VERSION`, default `stereo-large`), uses `REPLICATE_API_TOKEN`. Billed per generation by Replicate; three per request. Works on Railway (no GPU/torch needed). Single clips are capped at 30 s (`MUSIC_MAX_CLIP_SECONDS`).
- Runs by **version id** via `POST /v1/predictions` (the latest version of the model is looked up once per process; pin one with `MUSIC_REPLICATE_VERSION`). `meta/musicgen` is a community model, so the `/v1/models/{owner}/{name}/predictions` endpoint used for official models (e.g. the video model) answers `404 "The requested resource could not be found."` — that was the first-release bug. An unknown model name gives a clear "check MUSIC_REPLICATE_MODEL" message.
- **`fake`** (`MUSIC_PROVIDER=fake`): synthesised chord pad via ffmpeg — dev/tests only, no network.
- A local-Python MusicGen backend (the original spec) can be added as another provider without touching routes/UI; it would only work on a machine with torch + a GPU, not on Railway.

## Long videos: loop with crossfades, not continuation

A video longer than one clip (30 s) gets the clip **looped with 2 s equal-power (`qsin`) crossfades**, trimmed to length. Chosen over MusicGen "continuation" because: one generation per option regardless of video length (a 3-minute video costs the same as a 20-second one); continuation drifts in key/tempo over many blocks and its output semantics depend on the hosted model; and a crossfaded seam on a 30 s bed isn't audible. Trade-off: the phrase repeats every ~30 s (the card says "loops N× with crossfades"). Not judged by ear on real MusicGen output — only the mechanics are tested.

## Ducking and level

If the video has its own audio, the music is mixed under it with ffmpeg `sidechaincompress` (the speech is the sidechain), then the whole mix goes through `loudnorm` to **-14 LUFS**. Sliders: music volume (0-150 %, default 70) and ducking **off / light / strong**. Measured on a speech-level test signal (peak ≈ -22 dBFS): light dips the music ≈ 3 dB, strong ≈ 9 dB, final mix ≈ -14 LUFS. Thresholds are linear amplitude of the sidechain (`DUCKING` in `musicFit.js`) — retune there. Videos with no audio track skip ducking (the slider is disabled).

## Prompts

`musicPrompts.js`: presets — upbeat vlog, cinematic tension, calm corporate, travel montage, suspense, documentary, lo-fi chill — plus **Custom prompt**, optional extra direction on a preset, optional BPM (40-220). Every prompt gets an "instrumental only, no vocals…" suffix. MusicGen has no negative prompt, so this is a request, not a guarantee.

## Limits and errors

- Max video length `MUSIC_MAX_VIDEO_SEC` (default 300 — long videos mean large WAVs on disk), upload cap `VIDEO_MAX_UPLOAD_MB` (shared with Video Tools).
- 2 running jobs per user, 30 stored jobs total. `aiLimiter` is applied to `POST /jobs` only (the 2 s polling would exhaust it).
- ffmpeg work goes through the shared `videoJobGate` (global concurrency cap, `503` when busy).
- Clear errors: ffmpeg missing (`503` + banner), provider not configured (banner), unreadable/non-video file (`400`), video too long (`400`), one option failing doesn't sink the others (the card shows its error), all failing → job `failed` with the reason. Missing ffmpeg and a missing provider also raise Suggestions-inbox alerts from `/status`.
- No GPU/out-of-memory handling because nothing runs locally with the hosted backend.

## Tests

`npm run test:music` — `music.test.js` (prompts, loop maths, fade/mix filters, clamping, URL allow-list, Replicate request/error handling with a mocked `fetch`) and `music.e2e.test.js` (real route + real ffmpeg + the fake provider: upload with and without an audio track, three options, exact-length WAV, preview/export MP4 length and ≈ -14 LUFS, error paths, delete; **skips itself when ffmpeg isn't installed**).

**Not verified:** a real MusicGen generation (needs a token — only the request shape and error paths are tested), how the output sounds, and the page in a browser.

## Your own track

Besides generating, the page has a **Use my own track** switch (step 2). Send a `track` file (MP3/WAV/M4A…) with the video to `POST /api/music/jobs`: no provider is involved (works even when `REPLICATE_API_TOKEN` is unset, costs nothing), one option is made — the track is looped with the same 2 s crossfades if shorter than the video, or trimmed, with the same fades, then previewed/mixed/exported exactly like a generated option (same volume, ducking, -14 LUFS). `job.source` is `upload` and the progress steps say "Your track…". The page does not check who owns the rights to the track — that is the user's responsibility (the UI says so).

## Saved media and Video Tools

- **Save to Saved media:** each option has a button that calls `POST /api/music/jobs/:id/options/:n/save` (`{ title?, volume?, ducking? }`). It renders (or reuses the cached) full-quality export, checks the per-user library quota (`LIBRARY_QUOTA_BYTES`, shared with Video Tools via `videoLibraryService`), and stores it with `tool: 'music'` and a transaction recording source/mood/prompt/volume/ducking. It then shows in Video Tools → Saved media for captioning, joining, annotating etc.
- **From Video Tools:** the Compose group has **Add music** (opens `/music`, handing over the loaded source video), and every video result has an **Add music** button. The video travels in memory via `client/src/utils/videoHandoff.js` (consumed once; lost on reload) — no re-upload. Both are hidden when the `music` feature is off for the user.

## Possible next steps (not built)

Scene-cut detection (PySceneDetect) to place changes on cuts; energy markers on a timeline; stem export; continuation as an alternative extension strategy; saving a chosen result to the Saved media library; a local MusicGen provider for dev machines.

## Help, like the other Vault apps

- **Tooltips** (`components/Tooltip`) on every control: choose video, the video preview, mood, BPM, the description box, Generate, volume, ducking, Update preview, both export buttons, and the header buttons.
- **How Music Works** modal (`ToolInfoModal`, (i) in the header, opens once automatically — localStorage key `vault_music_info_seen`).
- **Tour** (Shepherd, compass in the header, `client/src/utils/tours/musicTour.js`, key `vault_tour_music_completed`, 6 steps); retake from **Settings → Music Tour** (opens `/music?tour=1`). Steps whose target isn't on screen yet (the options appear only after generating) show centred.

## Progress modal

Generating opens the global **ProcessingModal** (the same blocking overlay as other slow Vault operations) with a live step list driven by the server's real per-option status — `client/src/pages/music/musicProgress.mjs` maps the job to steps: video uploaded → length read → *Composing option N…* → *Cutting option N to your video's length…* → *Option N is ready* (or *failed: reason*) → finishing. The bar fills as steps complete, the detail line shows elapsed time, and the modal closes by itself when the job finishes (success toast) or fails (error toast). **Cancel** stops waiting and deletes the job's files; the provider has usually already been asked to compose, so that spend can't be undone (the toast says so). Test: `node client/src/pages/music/musicProgress.test.mjs` (also in `npm run test:music`).
