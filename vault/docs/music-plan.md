# Music: staged plan

Goal: give Music the same look and feel as Video Tools, then extend it. Written 2026-10-19. Nothing here is built yet.

**Principle.** Music creates or chooses sound (generate music, sound effects, voiceover). Video Tools processes files (trim, mix, normalize, convert, export). Music does not copy Video Tools tools; it links to them.

**Rules for every stage.** Each stage ships on its own and leaves the current flow working. Plain-word tooltips on every control. `docs/music.md` updated in the same change. Existing tests (`npm run test:music`) stay green. No new CI or process.

---

## Stage 1: Video Tools shell for Music (built 2026-10-19, not yet checked in a browser)

Re-lay `MusicPage.jsx` as the Video Tools layout: left sidebar (`w-56`, search, collapsible groups, hover tip on every item), one tool shown in the main column (`max-w-2xl`), `ToolHeader` with a help button per tool.

Groups and tools:
- **Make**: Score a video (today's flow, unchanged), Use my own track
- **Voice**: Voiceover (the current panel, moved to its own tool)
- **Finish in Video Tools**: left out of stage 1 on purpose (links that go nowhere are clutter); added in stage 3 with the handoff

Add `TOOL_GROUPS`, `TOOL_TIPS`, `GROUP_TIPS` in one place, plus a test that fails if a tool has no tip (copy the `videoTutor.test.js` pattern). Split the page into `client/src/pages/music/` components (`ScoreVideoTool`, `VoiceoverTool`, `OptionCard`) so later stages add files, not lines to one 800-line page. Keep tour, info modal and `data-tour` hooks working; update `musicTour.js` for the new layout.

Job state must survive switching tools in the sidebar (lift it into the page or a small store), because the voiceover needs the job from Score a video.

**Done when:** the existing flow works end to end in the new shell, test passes, tour still runs.

## Stage 2: One tutor for both apps (built 2026-10-19, not yet tried against the live model)

Extend the Video Tools guide rather than adding a second one. Add Music tools to `CATALOG` in `server/services/videoTutor.js`, and put the same `TutorChat` (draggable, email-this-chat) on the Music page. Register it per `server/config/guides.js` and `docs/guide-chat.md`; `npm run test:guides` must pass.

**Built as:** the registry allows one wrapper per guide, so Music has its own guide id (`music`, `/api/music/tutor`) that calls the same `askTutor` and `CATALOG` as Video Tools. Cross-page Open buttons use `?tool=` on `/videos` and `/music`.

**Done when:** asking the tutor "add music to my video" or "make a voiceover" points at the right Music tool, and asking about trimming points at Video Tools.

## Stage 3: Handoff both ways (audio included) (built 2026-10-19, not yet checked in a browser)

`client/src/utils/videoHandoff.js` carries a video only. Extend it to carry an audio file, consumed once, as it is now.

- Each Music result gets buttons: Normalize, Trim audio, Mix audio, Export for Social. Each opens that Video Tools tool with the file loaded.
- Video Tools' Saved media gets "Open in Music" on audio and video items.
- Music items saved to Saved media keep `tool: 'music'` (already done).

**Built as:** Trim audio, Mix audio (background slot), Normalize and Export for Social accept a handed-over file via `?tool=` and a per-tool in-memory handoff. Music keeps the job across the trip. Video Tools sends videos to Music from Saved media; audio files from Video Tools to Use my own track are not done (Saved media holds only videos and images, and no audio result has a button yet).

**Done when:** a generated track reaches Normalize and Trim audio without re-upload, and back.

## Stage 4: Music-only mode and variations (built 2026-10-19; server logic and routes tested with fakes, UI not checked in a browser, not tried with real MusicGen)

- **Music from text**: no video. Set a length (up to the provider's limits, looped with the existing crossfade fit), choose mood or description. Reuses the generate pipeline; the job takes a duration instead of a video.
- **Regenerate one option** and **Make another** (add one more from the same description). Built as those two; a true "more like this" that conditions on a chosen option's audio was not built (it needs a verified audio-input feature on the music model).
- **Seed lock** so a good result can be reproduced.
- **A/B compare**: play two options from the same timestamp.
- **Cost estimate** shown before Generate.

Server change in `server/services/music/musicJobs.js` and `server/routes/music.js`: optional `durationS` instead of `video`, per-option regenerate route. Add tests alongside `music.test.js`.

**Done when:** a track can be made with no video, and one weak option can be replaced without losing the other two.

## Stage 5: Shared voiceover (built 2026-10-19: shared voices, Mix audio script box, voiceover without a video; script-from-transcript and per-line timing NOT built)

Move text-to-speech into a service both apps use. Mix audio gets "write a script for an AI voice" next to its upload slot.

- Better voices if wanted (decision needed: another provider, cost and key; Australian accent is the gap).
- Script from transcript: reuse the Audio → transcript service to draft the script from the video, edited by the person.
- Script split into lines with per-line timing.

**Built 2026-10-19: Gemini provider (voice Kore chosen by ear), Kokoro kept as fallback; speed-change path and the e2e test were not run locally because there is no ffmpeg on this machine.** Original decision: Australian accent is required. Kokoro has no Australian voice (`voiceProviders.js`), so add a second provider behind the same `speak()` interface and keep Kokoro as the fallback. Candidates, none tested yet: Gemini speech generation (uses the existing `GEMINI_API_KEY`, accent steered by the prompt, so consistency must be checked by ear), Google Cloud Text-to-Speech `en-AU` voices (real en-AU voices, needs the Cloud TTS API enabled and a key), Azure `en-AU` (NatashaNeural, WilliamNeural). A web search found no Replicate-hosted Australian voice. Pick one after listening to a sample of each on a real script.

**Done when:** one script can become a voice in either app, and the Music voiceover works without a video.

## Stage 6: Smarter fit (built 2026-10-19; logic tested with ffmpeg faked, UI not checked in a browser; frame/transcript mood suggestion NOT built, ducking regions NOT drawn)

- **Cut-snapping**: detect scene cuts with ffmpeg scene detection, offer to land musical changes on them.
- **Timeline**: reuse `ClipTimeline.jsx` to show the video, ducking regions and the voiceover bar; drag the voice start.
- **Editable fades and music start offset** (today fixed at 0.5 s and 2 s).
- **AI mood suggestion** from the transcript or a few frames, using the `light` model.

**Done when:** a person can see where the music changes against the video and move the voice by dragging.

## Stage 7: Sound effects

A text-to-SFX layer (whoosh, ambience) placed on the timeline and mixed with the music and voice. Needs a provider choice and cost check first; do last, because it depends on the Stage 6 timeline.

---

## Not building (already in Video Tools)

Loudness presets (Normalize audio), stem export (Isolate voice), fade/trim tools (Trim audio, Mix audio), social cuts (Export for Social), a separate music library (Saved media), a separate tutor.

## Open decisions

1. TTS provider: stay with Kokoro or add one with an Australian accent (Stage 5).
2. SFX provider and whether it is worth the cost (Stage 7).
3. Whether Stage 4 (music-only) should come before Stage 2/3 if you want it sooner; they do not depend on each other.

## Unverified so far

How the guide registry handles a guide on two pages; whether Video Tools' audio tools accept a handed-over file; the provider's maximum clip length for music-only mode; none of this has been checked in a browser.
