# Music

`/music` (nav **Music**, Content Creation, flag `music`, default on): upload a video, pick a mood (or describe the music), get **3 instrumental options cut to the video's exact length**, preview each one mixed against the video, then export the **audio (WAV)** or the **video (MP4) with the music mixed in**, ducked under any speech.

Built from a spec for a standalone local Python/Gradio tool, adapted to live inside Vault (Node route + service, React page, the ffmpeg already used by Video Tools). Nothing is stored in the database — jobs live in memory with their files in a temp directory and expire after `MUSIC_JOB_TTL_MIN` (default 90 min).

## How it works

1. `POST /api/music/jobs` (multipart `video`, `mood`, optional `prompt`, `bpm`) — saves the upload to a job directory, reads its length with ffprobe, starts generating **in the background** and answers `202` immediately. The page polls `GET /api/music/jobs/:id` every 2 s for progress.
2. Three generations run in parallel with different seeds. Each clip is then **fitted** (looped if needed, trimmed to the exact video length, 0.5 s fade in, 2 s fade out ending on the final frame) → `option_N.wav`.
3. `GET .../options/:n/preview?volume=&ducking=` renders a small 480p MP4 with the music mixed in (cached per setting inside the job). `GET .../options/:n/video?...` is the full-quality export (picture stream-copied where possible, re-encoded if the source codec can't go into MP4). `GET .../options/:n/audio` is the fitted WAV.
4. `DELETE /api/music/jobs/:id` removes the files (the page does this on leaving, and when generating again).

Files: `server/routes/music.js`, `server/services/music/` (`musicPrompts.js`, `musicProviders.js`, `musicFit.js`, `musicJobs.js`), shared `server/middleware/ffmpegRoute.js` (also used by Video Tools), client `client/src/pages/MusicPage.jsx` (page + job state) with its pieces in `client/src/pages/music/`.

## Page layout

Laid out like Video Tools: a tool list on the left (`MusicSidebar.jsx`: search, collapsible groups, hover tip on every item), one tool at a time on the right with a title and a (?) help button (`ToolHeader.jsx`). The list is `TOOL_GROUPS` in `music/musicTools.mjs` with `TOOL_TIPS`, `GROUP_TIPS` and `TOOL_HELP` beside it; `node client/src/pages/music/musicTools.test.mjs` (in `npm run test:music`) fails if a tool has no tip or help, or one is left over. Tools: **Make** → Score a video, Use my own track; **Voice** → Voiceover (needs finished music). The page owns the video, job and voiceover settings, and the Score/Own-track body stays mounted (hidden) while another tool is open, so previews and the job survive switching tools. Per-option card is `OptionCard.jsx`, voiceover is `VoiceoverPanel.jsx`.

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

## Music without a video, and more options

- **Music from a description** (sidebar tool `text`): `POST /api/music/jobs` with `durationS` (5 s up to `MUSIC_MAX_VIDEO_SEC`, default 300) and no `video` makes a job with `mode: 'music-only'` (`hasVideo: false`). The options are audio only: the card plays the WAV, and offers Export audio, Make a new version and Finish in Video Tools (Trim audio, Mix audio only). There is no video preview/export/save (those routes answer `409`). A voiceover works: `GET .../audio` then returns the music with the voice mixed in (`mixVoiceIntoMusic` in `musicFit.js`, same voice mix as the video export, with a silent stand-in for the video's sound), and `?musicOnly=1` always gives the music alone.
- **Make a new version / Make another option:** `POST /api/music/jobs/:id/options/:n/regenerate` (new random seed, or `{ seed }`) remakes one option and leaves the others alone; `POST /api/music/jobs/:id/options` adds one more (up to 6, `MAX_OPTIONS`). Generated music only, not while the job is running. Each remake bumps the option's `rev`, which is part of the preview cache name so an old render is never reused.
- **Seed:** each card shows the seed it was made from. `seed` on `POST /jobs` (1 to 2^30) is the first option's seed, so the same description, tempo and seed brings that music back as option 1. (Whether Replicate's MusicGen is exactly repeatable for a seed is not verified.)
- **Compare:** with two or more ready options, "Play option N" starts that option at the point the last-played one had reached (client only).
- **Cost line:** shown only when the owner sets `MUSIC_COST_PER_RUN_USD` (what one generation costs on the provider); it is never guessed.
- Code: `musicJobs.js` (`runOption`, `regenerateOption`, `addOption`, `normalizeSeed`, `normalizeMusicLength`). Tests: `music.test.js` (job logic with a fake provider and fit step) and `music.routes.test.js` (the routes with ffmpeg, provider and fit faked, so they run without ffmpeg); `music.e2e.test.js` has not been extended and needs ffmpeg.

## Timeline, fades, cuts and mood suggestion

- **Timeline and fine-tuning** (a panel in the options section once the music is done; `music/MusicTimeline.jsx`, maths in `music/timelineMath.mjs`): shows the video's length with the **picture cuts** as thin lines, the **music** bar (its fade-in and fade-out ramps, and where it starts) and the **voiceover** bar. Drag the voice, or the left edge of the music bar, to move them; arrow keys nudge (Shift = 1 s). With **Snap to cuts** on, a dragged bar jumps onto a cut within half a second; **Snap to nearest cut** moves the voice (and a non-zero music start) onto the closest cut within 3 s.
- **Fades and start:** sliders for fade in (0 to 10 s), fade out (0 to 15 s) and where the music starts (silence before it). **Apply to all options** (`POST /api/music/jobs/:id/fit`, `normalizeFitSettings`) fits every ready option again from its original clip (`raw_<n>.wav`, or the uploaded track) with `buildFitFilter`'s `adelay`/`apad` for the start. Nothing is generated, so it is free; `rev` bumps so old previews are not reused, and `job.fit` is kept for later new versions. Defaults are still 0.5 s in, 2 s out.
- **Picture cuts:** `GET /api/music/jobs/:id/cuts` runs ffmpeg scene detection once per job (`detectSceneCuts`: `select='gt(scene,0.3)',showinfo`, parsed by `parseSceneCuts`, edges and near-duplicates dropped, at most 60) and keeps the result. It is a guide for placing the voice and music, not frame-exact; threshold 0.3 has not been tuned on real footage. Music without a video has no cuts.
- **Need help choosing?** (step 2, a boxed helper above the mood list): say what the video is about, or the sound you want, and **Fill in the mood for me** (`POST /api/music/suggest-mood`, `music/moodSuggest.js`, workspace `light` model) either picks one of the ready-made moods and a tempo, or, when none fits (an instrument or a place is named, such as a cello in a cathedral), returns `mood: 'custom'` with a written description that fills **Describe the music**. The helper box itself never makes music, and a note appears if it was filled in but not used. The model only reads the typed words (its call is text only). Descriptions are cleaned in code (`cleanCustomPrompt`): any comma phrase with no / not / without / avoid / non- is dropped, because naming an unwanted sound pulls MusicGen towards it, and the model is told the same. The reply is checked against the real mood list; `maxTokens` is generous because reasoning models spend tokens thinking.
- **Negation tip:** under the description, `music/promptTips.mjs` warns when it says what is not wanted ("no electronic sounds") and suggests describing what is wanted instead. Why it exists: a user's "no electronic souds" description produced three electronic pieces; the presets also lean electronic (lo-fi, vlog, corporate), so instrument or place requests should use Custom prompt.
- Tests: `timelineMath.test.mjs`, the fit/cut/mood cases in `music.test.js`, and the `/fit` and `/cuts` cases in `music.routes.test.js` (ffmpeg faked). Real scene detection and the `adelay` fit have not been run (no ffmpeg on the dev machine).

## Moving between Music and Video Tools

- **Music -> Video Tools:** each finished option has a "Finish in Video Tools" row: **Normalize audio** and **Export for Social** take the video with the music mixed in (MP4, using the volume/ducking/voiceover set on the card); **Trim audio** and **Mix audio** (background slot) take the music alone (WAV). The file is fetched, left for that tool (`client/src/utils/toolHandoff.mjs`: per tool, in memory, taken once), and the page goes to `/videos?tool=<id>`, where `VideosPage.jsx` loads it. Hidden when the `videos` feature is off for the person.
- **Coming back:** sending a result marks the job to be kept (`music/jobMemory.mjs`), so the Music page does not delete its files on leaving, and picks the job up again on return (options and previews work; the chosen video file is not remembered, so choose it again to generate again). A reload forgets it; the server still deletes files after about 90 minutes.
- **Video Tools -> Music:** Saved media has an **Add music** button on video items (alongside the existing Add music on tool results and the Add music tool), using the older `utils/videoHandoff.js`. Audio files from Video Tools are not sent to Music yet; use Use my own track.
- Tests: `node client/src/utils/toolHandoff.test.mjs`, `node client/src/pages/music/jobMemory.test.mjs` (both in `npm run test:music`).

## Voiceover

Once a job is `done`, a **Voiceover** panel appears above the options. One voiceover per job, mixed into every option's preview, export and save:

- **Write a script** — `POST /api/music/jobs/:id/voiceover` `{ text, voice?, speed? }` (JSON). Text ≤ 1500 chars, speed 0.7–1.3, voice from `status.voice.voices` (the active provider's own list). Backend, in `server/services/music/voiceProviders.js`:
  - **`gemini`** (default when `GEMINI_API_KEY` is set): Gemini speech, steered to an **Australian accent** by the prompt. Voices **Kore** (female, chosen after a listening test on 2026-10-19) and **Charon** (male; heard in the same test, accent not separately confirmed). Model `GEMINI_TTS_MODEL` (default `gemini-2.5-flash-preview-tts`, a preview name that may change). Gemini has no speed setting, so speed is applied afterwards with ffmpeg `atempo` (pitch kept). Because the accent comes from the prompt, it can drift on long scripts; check by ear. Billed per use by Google.
  - **`replicate`**: Kokoro-82M (`VOICE_REPLICATE_MODEL`, `VOICE_REPLICATE_VERSION`), American/British English only; used when there is no Gemini key.
  - **`fake`**: tests; follows `MUSIC_PROVIDER=fake`.
  - `VOICE_PROVIDER` (`gemini` | `replicate` | `fake`) forces one. Try voices with `node scripts/voiceSamplesAu.js`.
  - The providers live in `server/services/voiceProviders.js`, shared with **Video Tools → Mix audio** (`GET /api/videos/voices`, `POST /api/videos/speak`, `services/voiceover.js` `speakToWav`): its Voice slot has "…or write a script for an AI voice", which makes the recording and drops it in the slot. `music/voiceProviders.js` just re-exports the shared file.
- **Upload a recording** — same route with a multipart `voice` file (≤ 40 MB, MP3/WAV/M4A…). Works without Replicate.
- The voice is converted to 44.1 kHz stereo WAV. `DELETE` removes it; `GET .../voiceover/audio` returns it alone for listening.
- **Mix** (`buildVoiceMixFilter` in `musicFit.js`): the voice is delayed to `voiceStart` (s), padded/cut to the video length, scaled by `voiceVolume` (0–2), and becomes the ducking key — the music dips under it and under the video's own sound, and the video's own sound dips lightly under the voice. Ducking "Off" mixes everything flat. Still levelled to -14 LUFS. Renders are cached by voice revision, level and start.
- A voice that runs past the end of the video is cut off (the UI warns). Saved media items record the voiceover in their transaction.

## Possible next steps (not built)

Scene-cut detection (PySceneDetect) to place changes on cuts; energy markers on a timeline; stem export; continuation as an alternative extension strategy; saving a chosen result to the Saved media library; a local MusicGen provider for dev machines.

## Help, like the other Vault apps

- **Music tutor** (round button bottom right, `music/MusicTutorChat.jsx`, `POST /api/music/tutor`): the same tutor as Video Tools'. It knows the Music tools and the Video Tools ones, says which page each is on, and its Open buttons switch tool or page. Missing-tool answers land in the Suggestions inbox (`musicTutor`). See `docs/guide-chat.md`.

- **Tooltips** (`components/Tooltip`) on every control: choose video, the video preview, mood, BPM, the description box, Generate, volume, ducking, Update preview, both export buttons, and the header buttons.
- **How Music Works** modal (`ToolInfoModal`, (i) in the header, opens once automatically — localStorage key `vault_music_info_seen`).
- **Tour** (Shepherd, compass in the header, `client/src/utils/tours/musicTour.js`, key `vault_tour_music_completed`, 7 steps, the second one points at the tool list); retake from **Settings → Music Tour** (opens `/music?tour=1`). Steps whose target isn't on screen yet (the options appear only after generating) show centred.

## Progress modal

Generating opens the global **ProcessingModal** (the same blocking overlay as other slow Vault operations) with a live step list driven by the server's real per-option status — `client/src/pages/music/musicProgress.mjs` maps the job to steps: video uploaded → length read → *Composing option N…* → *Cutting option N to your video's length…* → *Option N is ready* (or *failed: reason*) → finishing. The bar fills as steps complete, the detail line shows elapsed time, and the modal closes by itself when the job finishes (success toast) or fails (error toast). **Cancel** stops waiting and deletes the job's files; the provider has usually already been asked to compose, so that spend can't be undone (the toast says so). Test: `node client/src/pages/music/musicProgress.test.mjs` (also in `npm run test:music`).
