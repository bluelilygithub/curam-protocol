import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { setVideoHandoff } from '../utils/videoHandoff';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import Tooltip from '../components/Tooltip';
import { DEFAULT_FEATURE_ACCESS } from '../utils/featureAccess';
import ToolInfoModal, { useToolInfoModal } from '../components/ToolInfoModal';
import SlideshowPlanner from './videos/SlideshowPlanner';
import JoinPlanner from './videos/JoinPlanner';
import { describePlan } from './videos/JoinEffectsEditor';
import LastFramePicker from './videos/LastFramePicker';
import TakesGrid from './videos/TakesGrid';
import { VoiceInput, VoiceInputProvider } from '../components/voiceInput/VoiceInput';
import { VideoVoiceContext, VoiceCommandBar } from './videos/VoiceCommandBar';
import { applyEditedText, srtLines } from './videos/transcriptSrt.mjs';
import ScriptTimer from './videos/ScriptTimer';
import ClipTimeline from './videos/ClipTimeline';
import TutorChat from './videos/TutorChat';
import { parseClock, formatClock } from './videos/clock.mjs';

const VIDEO_GOOGLE_FONTS = [
  'Roboto',
  'Inter',
  'Open Sans',
  'Lato',
  'Montserrat',
  'Poppins',
  'Nunito',
  'Raleway',
  'Oswald',
  'Bebas Neue',
  'Anton',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'PT Serif',
  'Pacifico',
  'Dancing Script',
  'Caveat',
  'Roboto Mono',
  'Space Mono',
];

const SOCIAL_EXPORT_PRESETS = [
  { id: 'reels', label: 'Reels / TikTok / Shorts', desc: '9:16 · trimmed to 60s if longer' },
  { id: 'square', label: 'Square', desc: '1:1' },
  { id: 'landscape', label: 'Landscape / YouTube', desc: '16:9' },
];

const FONT_WEIGHTS = [
  { id: 'normal', label: 'Regular' },
  { id: 'bold', label: 'Bold' },
];

const TEXT_POSITIONS = [
  { id: 'top-left', label: 'Top left', row: 0, col: 0 },
  { id: 'top-center', label: 'Top centre', row: 0, col: 1 },
  { id: 'top-right', label: 'Top right', row: 0, col: 2 },
  { id: 'center-left', label: 'Centre left', row: 1, col: 0 },
  { id: 'center', label: 'Centre', row: 1, col: 1 },
  { id: 'center-right', label: 'Centre right', row: 1, col: 2 },
  { id: 'bottom-left', label: 'Bottom left', row: 2, col: 0 },
  { id: 'bottom-center', label: 'Bottom centre', row: 2, col: 1 },
  { id: 'bottom-right', label: 'Bottom right', row: 2, col: 2 },
];

function PositionGrid({ value, onChange, label = 'Position' }) {
  const grid = useMemo(() => {
    const cells = Array.from({ length: 9 }, () => null);
    TEXT_POSITIONS.forEach((p) => {
      cells[p.row * 3 + p.col] = p;
    });
    return cells;
  }, []);

  return (
    <div className="space-y-1">
      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div
        className="inline-grid gap-1 p-1 rounded-xl border"
        style={{ gridTemplateColumns: 'repeat(3, 2rem)', borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
      >
        {grid.map((pos) => (
          <Tooltip key={pos.id} text={`Place it in the ${pos.label.toLowerCase()} of the frame.`}>
            <button
              type="button"
              title={pos.label}
              aria-label={pos.label}
              onClick={() => onChange(pos.id)}
              className="w-8 h-8 rounded-lg border transition-opacity hover:opacity-70 flex items-center justify-center"
              style={{
                borderColor: value === pos.id ? 'var(--color-primary)' : 'var(--color-border)',
                background: value === pos.id ? 'var(--color-surface)' : 'transparent',
              }}
            >
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: value === pos.id ? 'var(--color-primary)' : 'var(--color-muted)' }}
              />
            </button>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}

const TOOL_HELP = {
  generate: {
    title: 'Generate clip',
    what: 'Describe a short clip in plain language and generate an AI video (3–10 s) via Replicate or FAL.',
    features: [
      'Brief is expanded into a full video prompt by the workspace light model',
      'Optional reference image — animate it directly, or use it as style inspiration only',
      'Optional YouTube example — pulls title, transcript excerpt, and thumbnail for grounding',
      'Choose aspect ratio and target duration',
    ],
  },
  clip: {
    title: 'Clip / trim',
    what: 'Cut a video down to a specific start and end point.',
    features: [
      'A timeline of pictures from your video: click or drag along it to move through the video, and drag the two markers to choose the part to keep. The video shows the exact picture at each marker',
      'Set start here / Set end here take the moment you are watching; Play selection previews just the part you chose',
      'Or type the start and end in seconds. Numbers and timeline stay in sync both ways',
      'Optional end point — leave blank to trim only the start',
      'Source file is never modified',
    ],
  },
  convert: {
    title: 'Convert / compress',
    what: 'Re-encode a video as an H.264 MP4 with adjustable quality and size.',
    features: [
      'CRF slider (18–35) trades quality against file size',
      'Optional max width — shrinks larger videos while preserving aspect ratio',
      'Good for reducing upload size or fixing incompatible codecs',
    ],
  },
  'extract-audio': {
    title: 'Extract audio',
    what: 'Pull the soundtrack out of a video and download it as an audio file.',
    features: [
      'Exports MP3 by default',
      'WAV export available via the API',
      'Useful for reusing a voiceover or music track elsewhere',
    ],
  },
  'extend-ending': {
    title: 'Extend ending',
    what: 'Stop a video ending dead on its last picture: hold the last frame for a few seconds while the music plays on and fades out, with an optional closing message over it.',
    features: [
      'Choose how many seconds to hold the last frame',
      'Choose your music file and it plays through the held frame, then fades out over the time you set (it repeats smoothly if it is shorter)',
      'Without a music file the video\'s own sound is kept, but it ends with the video: it can only be faded out at its end, and the held frame is silent',
      'Optional call to action: the message appears over the held frame while the music fades',
      'One finished video; your originals are not changed',
    ],
  },
  'mix-audio': {
    title: 'Mix audio',
    what: 'Combine a voice recording and a piece of background music into one audio file.',
    features: [
      'Choose the voice (foreground) and the music (background) as two audio files',
      'Set how loud the music is next to the voice',
      'The music dips while the voice speaks, and comes back up in the gaps (light, strong or off)',
      'Short music repeats smoothly; long music is trimmed; it fades in and out',
      'Optional lead-in before the voice and tail after it; saves as MP3 or WAV',
    ],
  },
  'isolate-voice': {
    title: 'Isolate voice',
    what: 'Take the spoken words out of a recording that has background music, and get a voice-only audio file.',
    features: [
      'Best quality (AI): separates the voice from the music, and gives you the music-only file too. Billed per run on the server\'s Replicate account',
      'Quick filter (free): cleans up the speech range and reduces steady noise. It lowers background music but cannot remove it',
      'Works best on speech over instrumental music; singing or lyrics tend to leak into the voice',
      'Send the result straight to Audio to transcript or Trim audio',
    ],
  },
  'trim-audio': {
    title: 'Trim audio',
    what: 'Cut an MP3 (or other audio file) down to the part you want, or cut an unwanted part out of it.',
    features: [
      'Keep this part: the result is just the section between your start and end (an extract)',
      'Cut this part out: removes the section and joins the rest back together',
      'Type the times (1:30, 90 or 1m30), or play the audio and press Set start / Set end at the right moment',
      'Optional fade in and fade out so the cut does not sound abrupt',
      'Same file type with no re-compression by default, so there is no quality loss',
    ],
  },
  'transcribe-audio': {
    title: 'Audio → transcript',
    what: 'Turn a recording (MP3, M4A, WAV and similar) into written text you can edit, copy or download.',
    features: [
      'Choose plain text, or text with timestamps (SRT subtitle file)',
      'The result appears in a box you can correct before copying or saving',
      'Already wrote the words? "I have a script, not captions" times your script to the recording, so you need no timestamps',
      'With timestamps: send the captions to Caption studio, or make a video from the audio with the words along the bottom (choose shape, screen colour, font, size, text colour and text background)',
      'Choose an audio file or a video file; with a video, put the captions straight onto it',
      'Long recordings are shrunk automatically; up to about 75 minutes at once',
      'Speech only: music and background noise may be skipped or misheard',
    ],
  },
  audio: {
    title: 'Mute / replace audio',
    what: 'Strip a video\'s existing soundtrack, or swap it out for a new uploaded track.',
    features: [
      'Mute mode removes all audio entirely',
      'Replace mode overlays an uploaded audio file in place of the original',
      'Video length and picture are untouched',
    ],
  },
  normalize: {
    title: 'Normalize audio',
    what: 'One-click loudness fix so a video\'s volume sits at a consistent level.',
    features: [
      'Presets: quiet / normal / loud — no raw ffmpeg parameters to configure',
      'Uses ffmpeg\'s loudnorm filter, single-pass for speed',
      'Good for a quick "fix my volume" pass on an occasional clip',
    ],
  },
  togif: {
    title: 'Video → GIF',
    what: 'Convert a short section of video into a looping GIF.',
    features: [
      'Two-pass palette generation for cleaner colour than a naive conversion',
      'Adjustable frame rate (1–30 fps, 10–20 typical) and max width',
      'Optional start/end trim to select just the section you want',
    ],
  },
  'export-social': {
    title: 'Export for Social',
    what: 'Turn one source video into ready-to-post files for multiple social formats in one pass.',
    features: [
      'Presets: Reels/TikTok/Shorts (9:16, trimmed to 60s), Square (1:1), Landscape/YouTube (16:9)',
      'Shared crop focus (center/top/bottom/left/right) applied consistently across presets',
      'Each result includes a poster-frame thumbnail and can be saved to the library individually',
      'Download files one at a time or all together as a zip',
    ],
  },
  reframe: {
    title: 'Crop / reframe',
    what: 'Change a video\'s aspect ratio by cropping or letterboxing it to a new target shape.',
    features: [
      'Target aspect: 9:16, 16:9, 1:1, or 4:5',
      'Crop mode fills the frame; pad mode letterboxes without cropping',
      'Crop focus (center/top/bottom/left/right) controls what stays in frame',
    ],
  },
  speed: {
    title: 'Speed',
    what: 'Speed up or slow down a video, with audio pitch/tempo following automatically.',
    features: [
      'Range 0.25× (slow motion) to 4× (fast forward)',
      'Audio tempo adjusts to match, so sound stays in sync',
    ],
  },
  annotate: {
    title: 'Annotate',
    what: 'Burn a single styled text label onto a video.',
    features: [
      'Position: top, center, or bottom',
      'Choose from 20 curated Google Fonts, plus text/background colour and weight',
      'Optional fade in/out to ease the label on and off screen',
    ],
  },
  'end-card': {
    title: 'Call to action',
    what: 'End a video with a closing screen that tells viewers what to do next.',
    features: [
      'Headline, supporting line, a button-style label and a web address',
      'Choose the background, text and button colours and how long it stays up',
      'Fades in after your video; original sound is kept and the card is silent',
      'Matches the size and frame rate of your video, so it works for Reels, square or landscape',
    ],
  },
  overlay: {
    title: 'Overlay / watermark',
    what: 'Place a logo or image on top of a video for the full duration.',
    features: [
      'Position grid for precise placement',
      'Adjustable scale and opacity',
      'Good for branding, logos, or watermarking exported clips',
    ],
  },
  join: {
    title: 'Join videos',
    what: 'Concatenate multiple clips into a single video.',
    features: [
      'Supports 2–12 clips, joined in the order shown',
      'Each clip is normalized to a shared resolution, frame rate, and audio format first',
      'Optional crossfade transition between clips, or a hard cut',
      'Adjustable max output width and quality',
    ],
  },
  slideshow: {
    title: 'Slideshow',
    what: 'Turn a set of still images into a promo video, with optional background music.',
    features: [
      'Supports 2–20 images, each shown for a set number of seconds',
      'Letterboxed to your chosen aspect ratio (9:16, 16:9, 1:1, 4:5)',
      'Optional crossfade between slides, or a hard cut',
      'Optional audio track loops to fill or trims to match the total runtime',
    ],
  },
  'caption-studio': {
    title: 'Caption studio',
    what: 'Burn styled subtitles onto a video, sourced from pasted SRT or auto-transcription.',
    features: [
      'Upload a video or pick one from Saved media',
      'Auto-transcribe on upload (Gemini on hosted Vault, whisper-cli locally), or paste your own SRT',
      'Wrote your own script with no timestamps? Paste it in the captions box (or use "I have a script, not captions"); when you burn, Vault listens to the video and times each line to the speech',
      'Same typography controls as Annotate — font, weight, size, text and background colour',
      'Optionally save the captioned result straight to the library',
    ],
  },
  'saved-library': {
    title: 'Saved media',
    what: 'Browse, preview, and manage videos and images you\'ve saved from other tools.',
    features: [
      'Each item stores the output file plus the settings used to create it',
      'Preview or delete any saved item',
      'Jump straight into Caption studio with a saved video pre-selected',
    ],
  },
  info: {
    title: 'File info',
    what: 'Inspect a video\'s technical details without processing it.',
    features: [
      'Duration, resolution, and container format',
      'Video and audio codec details',
      'Useful for confirming a file before running it through another tool',
    ],
  },
  thumbnail: {
    title: 'Thumbnail',
    what: 'Export a single still frame from a video as a JPG image.',
    features: [
      'Pick the exact timestamp to capture',
      'Download the resulting JPG, or save it to the library',
    ],
  },
};

const TOOL_GROUPS = [
  {
    id: 'create',
    label: 'Create',
    tools: [
      { id: 'generate', label: 'Generate clip', desc: 'Brief + optional image seed, reference video or YouTube example' },
    ],
  },
  {
    id: 'optimise',
    label: 'Optimise',
    tools: [
      { id: 'convert', label: 'Convert / compress', desc: 'Re-encode MP4, optional resize' },
      { id: 'extract-audio', label: 'Extract audio', desc: 'Export MP3 or WAV' },
      { id: 'isolate-voice', label: 'Isolate voice', desc: 'Pull the speech out from under background music' },
      { id: 'transcribe-audio', label: 'Audio → transcript', desc: 'MP3 or other audio in, editable text out' },
      { id: 'audio', label: 'Mute / replace audio', desc: 'Strip soundtrack or swap in a new track' },
      { id: 'normalize', label: 'Normalize audio', desc: 'One-click loudness consistency fix' },
      { id: 'togif', label: 'Video → GIF', desc: 'Short looping GIF with an optimized palette' },
      { id: 'export-social', label: 'Export for Social', desc: 'One video → Reels/Square/Landscape presets' },
    ],
  },
  {
    id: 'transform',
    label: 'Transform',
    tools: [
      { id: 'clip', label: 'Clip / trim', desc: 'Set in and out points' },
      { id: 'trim-audio', label: 'Trim audio', desc: 'Keep a part of an MP3, or cut a part out' },
      { id: 'reframe', label: 'Crop / reframe', desc: '9:16, 16:9, 1:1, 4:5 — crop or letterbox' },
      { id: 'speed', label: 'Speed', desc: 'Slow-mo or speed up (0.25×–4×)' },
    ],
  },
  {
    id: 'compose',
    label: 'Compose',
    tools: [
      { id: 'annotate', label: 'Annotate', desc: 'Burn in a text label' },
      { id: 'end-card', label: 'Call to action', desc: 'End the video with a closing message and button' },
      { id: 'overlay', label: 'Overlay / watermark', desc: 'Logo or image on top of video' },
      { id: 'join', label: 'Join videos', desc: 'Concatenate clips — hard cut or crossfade' },
      { id: 'slideshow', label: 'Slideshow', desc: 'Images + background music → promo video' },
      { id: 'caption-studio', label: 'Caption studio', desc: 'Upload or library video + styled SRT captions' },
      { id: 'extend-ending', label: 'Extend ending', desc: 'Hold the last frame; music fades out over it' },
      { id: 'mix-audio', label: 'Mix audio', desc: 'Voice + background music → one audio file' },
      { id: 'add-music', label: 'Add music', desc: 'Opens Music — generate or use your own track', link: '/music' },
    ],
  },
  {
    id: 'library',
    label: 'Library',
    tools: [
      { id: 'saved-library', label: 'Saved media', desc: 'Your saved videos, images, and tool runs' },
    ],
  },
  {
    id: 'analyse',
    label: 'Analyse',
    tools: [
      { id: 'info', label: 'File info', desc: 'Duration, resolution, codec' },
      { id: 'thumbnail', label: 'Thumbnail', desc: 'Export a JPG frame' },
    ],
  },
];

const CTA_DEFAULTS = {
  headline: '', subline: '', buttonText: '', url: '', durationSec: 4,
  bgColor: '#111111', textColor: '#FFFFFF', buttonColor: '#CC785C', placement: 'after',
};

const ctaHasContent = (c) => Boolean(c.headline.trim() || c.subline.trim() || c.buttonText.trim() || c.url.trim());

function endCardFormData(file, c) {
  const fd = new FormData();
  fd.append('video', file);
  Object.entries(c).forEach(([k, v]) => fd.append(k, String(v)));
  return fd;
}

function appendEndCardFields(fd, c) {
  fd.append('endCard', 'true');
  fd.append('endCardSpec', JSON.stringify(c));
}

function EndCardFields({ cta, setCta, lockTiming = false }) {
  const set = (key) => (value) => setCta((prev) => ({ ...prev, [key]: value }));
  // When the message sits over the picture (not a separate closing screen), the picture is tinted behind it. That tint's
  // colour, strength and fade-in time are the person's to set.
  const overPicture = lockTiming || (cta.placement || 'after') !== 'after';
  return (
    <div className="space-y-3">
      <Tooltip text="The main message, e.g. 'Book your free consult'.">
        <VoiceInput value={cta.headline} onChange={set('headline')} placeholder="Headline" label="Headline" />
      </Tooltip>
      <Tooltip text="Optional smaller line under the headline.">
        <VoiceInput value={cta.subline} onChange={set('subline')} placeholder="Supporting line (optional)" label="Supporting line" />
      </Tooltip>
      <div className="grid gap-3 sm:grid-cols-2">
        <Tooltip text="Text shown on the button-style label, e.g. 'Call now' or 'Learn more'. The video itself is not clickable.">
          <VoiceInput value={cta.buttonText} onChange={set('buttonText')} placeholder="Button text (optional)" label="Button text" />
        </Tooltip>
        <Tooltip text="Web address, phone number or handle shown at the bottom.">
          <VoiceInput value={cta.url} onChange={set('url')} placeholder="Web address or phone (optional)" label="Web address or phone" />
        </Tooltip>
      </div>
      {!lockTiming && (
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Where it appears</span>
        <Tooltip text="Separate closing screen after the video, over a frozen last frame (video gets longer), or over the final seconds of the video (same length). When over the picture you can set how dark the tint is and how slowly it fades in.">
          <select value={cta.placement || 'after'} onChange={(e) => set('placement')(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            <option value="after">Closing screen after the video</option>
            <option value="last-frame">Over a frozen last frame</option>
            <option value="over-end">Over the end of the video</option>
          </select>
        </Tooltip>
      </label>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[[overPicture ? 'Tint colour' : 'Background', 'bgColor', overPicture ? 'The colour laid over the picture behind your message. A dark colour makes white text easy to read; a colour from your brand gives a tinted look. Set "Darken the picture" to 0 for no tint at all.' : 'Closing screen colour.'], ['Text', 'textColor', 'Colour of the headline and lines.'], ['Button', 'buttonColor', 'Colour behind the button text.']].map(([lbl, key, tip]) => (
          <label key={key} className="block space-y-1">
            <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{lbl}</span>
            <Tooltip text={tip}>
              <input type="color" value={cta[key]} onChange={(e) => set(key)(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }} />
            </Tooltip>
          </label>
        ))}
        {overPicture && (
          <>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Darken the picture (%)</span>
              <Tooltip text="How strongly the tint colour covers the picture behind your message. 0 = no tint, so the picture keeps all its colour. 60 is the usual. 100 = the picture is hidden behind the colour.">
                <input type="number" min={0} max={100} step={5} value={cta.dimPct ?? 60} onChange={(e) => set('dimPct')(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Fade-in time (seconds)</span>
              <Tooltip text="How slowly the tint and your message come in. 0 = instant. 0.5 is quick; 3 or more is a slow, gentle change that can last as long as the held time. It starts when the message starts.">
                <input type="number" min={0} max={15} step={0.5} value={cta.fadeSec ?? 0.5} onChange={(e) => set('fadeSec')(e.target.value === '' ? '' : Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </Tooltip>
            </label>
          </>
        )}
        {!lockTiming && (
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Seconds on screen</span>
          <Tooltip text="How long the closing screen stays up (1–15 seconds).">
            <input type="number" min={1} max={15} step={0.5} value={cta.durationSec} onChange={(e) => set('durationSec')(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
          </Tooltip>
        </label>
        )}
      </div>
    </div>
  );
}

function EndCardToggle({ enabled, setEnabled, cta, setCta, tip, lockTiming = false, label = 'End with a call to action' }) {
  return (
    <div className="rounded-xl border p-3 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <label className="flex items-center gap-2 text-xs font-medium" style={{ color: 'var(--color-text)' }}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
        <Tooltip text={tip}>
          <span>{label}</span>
        </Tooltip>
      </label>
      {enabled && <EndCardFields cta={cta} setCta={setCta} lockTiming={lockTiming} />}
      {enabled && !ctaHasContent(cta) && (
        <p className="text-[10px]" style={{ color: '#b45309' }}>Add a headline, button text or web address first.</p>
      )}
    </div>
  );
}

function TextStyleFields({
  fontFamily, setFontFamily, fontSize, setFontSize, fontColor, setFontColor,
  fontWeight, setFontWeight, backgroundColor, setBackgroundColor,
  backgroundTransparent, setBackgroundTransparent,
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="block space-y-1 sm:col-span-2">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Font (Google Fonts)</span>
        <Tooltip text="The typeface burned into the video — fetched from Google Fonts on the server.">
          <select value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            {VIDEO_GOOGLE_FONTS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </Tooltip>
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Weight</span>
        <Tooltip text="Regular or bold stroke weight for the text.">
          <select value={fontWeight} onChange={(e) => setFontWeight(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            {FONT_WEIGHTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
        </Tooltip>
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Size (px)</span>
        <Tooltip text="How large the text renders in the final video, in pixels.">
          <input type="number" min={12} max={72} value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
        </Tooltip>
      </label>
      <label className="block space-y-1">
        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Text colour</span>
        <Tooltip text="Colour of the text itself.">
          <input type="color" value={fontColor} onChange={(e) => setFontColor(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} />
        </Tooltip>
      </label>
      <Tooltip text="Drop the solid background box and keep only the text (with its outline) over the video.">
        <label className="flex items-center gap-2 text-xs cursor-pointer sm:col-span-2" style={{ color: 'var(--color-muted)' }}>
          <input
            type="checkbox"
            checked={backgroundTransparent}
            onChange={(e) => setBackgroundTransparent(e.target.checked)}
          />
          Transparent background (text outline only)
        </label>
      </Tooltip>
      {!backgroundTransparent && (
        <label className="block space-y-1 sm:col-span-2">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Background colour</span>
          <Tooltip text="Colour of the solid box drawn behind the text for readability.">
            <input type="color" value={backgroundColor} onChange={(e) => setBackgroundColor(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} />
          </Tooltip>
        </label>
      )}
    </div>
  );
}

function CaptionStyleFields(props) {
  return <TextStyleFields {...props} />;
}

function formatDuration(sec) {
  if (!Number.isFinite(sec)) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function ImageReferenceUpload({ file, previewUrl, onFile, onClear }) {
  const inputRef = useRef(null);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Pick a still image to seed the generated clip — animate it directly, or let the model describe its style.">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {file ? 'Change image' : 'Upload image'}
          </button>
        </Tooltip>
        {file && (
          <>
            <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>
              {file.name} · {formatBytes(file.size)}
            </span>
            <Tooltip text="Remove the reference image.">
              <button
                type="button"
                onClick={onClear}
                className="text-xs transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-muted)' }}
              >
                Remove
              </button>
            </Tooltip>
          </>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
      {previewUrl && (
        <img src={previewUrl} alt="Reference" className="max-h-32 rounded-lg border object-contain" style={{ borderColor: 'var(--color-border)' }} />
      )}
    </div>
  );
}

function VideoUpload({ file, onFile, label = 'Video file', libraryItems = [], onPickLibrary }) {
  const inputRef = useRef(null);
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Choose the video file this tool will process.">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {file ? 'Change file' : 'Choose video'}
          </button>
        </Tooltip>
        {onPickLibrary && libraryItems.length > 0 && (
          <Tooltip text="Use a video already saved in your library instead of uploading a new file.">
            <select
              value=""
              onChange={(e) => {
                const item = libraryItems.find((i) => String(i.id) === e.target.value);
                if (item) onPickLibrary(item);
                e.target.value = '';
              }}
              className="px-2 py-2 rounded-xl border text-xs"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            >
              <option value="">Or choose from library…</option>
              {libraryItems.map((item) => (
                <option key={item.id} value={item.id}>{item.title || `Video #${item.id}`}</option>
              ))}
            </select>
          </Tooltip>
        )}
        {file && (
          <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>
            {file.name} · {formatBytes(file.size)}
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] || null)}
      />
    </label>
  );
}

function MultiVideoUpload({ files, onFiles, label = 'Video files (order = join order)' }) {
  const inputRef = useRef(null);
  const move = (index, dir) => {
    const next = [...files];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onFiles(next);
  };
  const removeAt = (index) => onFiles(files.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Add video clips — they'll be joined in the order shown below.">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {files.length ? 'Add more videos' : 'Choose videos'}
          </button>
        </Tooltip>
        {files.length > 0 && (
          <Tooltip text="Remove every clip and start over.">
            <button
              type="button"
              onClick={() => onFiles([])}
              className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Clear all
            </button>
          </Tooltip>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          if (!picked.length) return;
          onFiles([...files, ...picked].slice(0, 12));
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-5 text-center font-medium" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
              <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{f.name}</span>
              <span className="shrink-0" style={{ color: 'var(--color-muted)' }}>{formatBytes(f.size)}</span>
              <Tooltip text="Move this clip earlier in the join order."><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move up">↑</button></Tooltip>
              <Tooltip text="Move this clip later in the join order."><button type="button" onClick={() => move(i, 1)} disabled={i === files.length - 1} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move down">↓</button></Tooltip>
              <Tooltip text="Remove this clip from the join."><button type="button" onClick={() => removeAt(i)} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: '#ef4444' }} aria-label="Remove">×</button></Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function MultiImageUpload({ files, onFiles, label = 'Images (order = slide order, 2–20)' }) {
  const inputRef = useRef(null);
  const move = (index, dir) => {
    const next = [...files];
    const j = index + dir;
    if (j < 0 || j >= next.length) return;
    [next[index], next[j]] = [next[j], next[index]];
    onFiles(next);
  };
  const removeAt = (index) => onFiles(files.filter((_, i) => i !== index));

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <Tooltip text="Add product photos or other still images — at least two, up to twenty.">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            {files.length ? 'Add more images' : 'Choose images'}
          </button>
        </Tooltip>
        {files.length > 0 && (
          <Tooltip text="Remove every image and start over.">
            <button
              type="button"
              onClick={() => onFiles([])}
              className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Clear all
            </button>
          </Tooltip>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const picked = Array.from(e.target.files || []);
          if (!picked.length) return;
          onFiles([...files, ...picked].slice(0, 20));
          e.target.value = '';
        }}
      />
      {files.length > 0 && (
        <ul className="space-y-1.5 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${f.size}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="shrink-0 w-5 text-center font-medium" style={{ color: 'var(--color-muted)' }}>{i + 1}</span>
              <span className="flex-1 truncate" style={{ color: 'var(--color-text)' }}>{f.name}</span>
              <span className="shrink-0" style={{ color: 'var(--color-muted)' }}>{formatBytes(f.size)}</span>
              <Tooltip text="Move this image earlier in the slideshow."><button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move up">↑</button></Tooltip>
              <Tooltip text="Move this image later in the slideshow."><button type="button" onClick={() => move(i, 1)} disabled={i === files.length - 1} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 disabled:opacity-30" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} aria-label="Move down">↓</button></Tooltip>
              <Tooltip text="Remove this image from the slideshow."><button type="button" onClick={() => removeAt(i)} className="px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: '#ef4444' }} aria-label="Remove">×</button></Tooltip>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultVideo({
  blobUrl, downloadName, onUse, onSave, onMusic, saveLabel = 'Save to library',
  saveTitle, onSaveTitleChange,
}) {
  if (!blobUrl) return null;
  return (
    <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
      <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
      <video
        src={blobUrl}
        controls
        playsInline
        preload="metadata"
        className="w-full max-h-64 rounded-lg bg-black"
      />
      {onSave && onSaveTitleChange && (
        <label className="block space-y-1">
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Library title (optional)</span>
          <Tooltip text="Name shown for this file in Saved media — leave blank to use the tool name and date.">
            <input
              value={saveTitle || ''}
              onChange={(e) => onSaveTitleChange(e.target.value)}
              placeholder="Defaults to tool name and date"
              className="w-full px-3 py-2 rounded-xl border text-xs"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
          </Tooltip>
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Tooltip text="Save this result to your device.">
          <a
            href={blobUrl}
            download={downloadName}
            className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80"
            style={{ background: 'var(--color-primary)' }}
          >
            Download
          </a>
        </Tooltip>
        {onSave && (
          <Tooltip text="Store this result in your Saved media library for later.">
            <button
              type="button"
              onClick={onSave}
              className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
            >
              {saveLabel}
            </button>
          </Tooltip>
        )}
        {onMusic && (
          <Tooltip text="Open Music with this video: generate background music or fit your own track, then save it back to Saved media.">
            <button
              type="button"
              onClick={onMusic}
              className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Add music
            </button>
          </Tooltip>
        )}
        {onUse && (
          <Tooltip text="Carry this result over as the source file for another tool, without re-uploading.">
            <button
              type="button"
              onClick={onUse}
              className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
            >
              Use in another tool
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

function ToolHeader({ id, label, onHelp, getIcon }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5">
        <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{label}</h2>
        <button
          type="button"
          onClick={() => onHelp(id)}
          className="hover:opacity-60 transition-opacity flex-shrink-0"
          style={{ color: 'var(--color-muted)' }}
        >
          {getIcon('help-circle', { size: 13 })}
        </button>
      </div>
      <VoiceCommandBar toolId={id} />
    </div>
  );
}

export default function VideosPage() {
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = user?.isAdmin;
  const videoInfo = useToolInfoModal('vault_video_tools_info_seen');
  const addToast = useToastStore((s) => s.addToast);
  const { startProcessing, stopProcessing } = useProcessingStore();

  const [featureAccess, setFeatureAccess] = useState({ ...DEFAULT_FEATURE_ACCESS });
  const canUse = isAdmin || featureAccess.videos !== false;

  const [status, setStatus] = useState(null);
  const [openGroup, setOpenGroup] = useState('create');
  const [tool, setTool] = useState('generate');
  const [search, setSearch] = useState('');
  const [helpTool, setHelpTool] = useState(null);
  const [providerInfoOpen, setProviderInfoOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState('');

  const [sourceFile, setSourceFile] = useState(null);
  const [resultBlob, setResultBlob] = useState(null);
  const resultBlobRef = useRef(null);
  const thumbBlobRef = useRef(null);
  const [resultForTool, setResultForTool] = useState(null);
  const [resultName, setResultName] = useState('output.mp4');
  const [probe, setProbe] = useState(null);

  // Generate
  const [brief, setBrief] = useState('');
  const [style, setStyle] = useState('product b-roll');
  const [aspect, setAspect] = useState('16:9');
  const [durationSec, setDurationSec] = useState(5);
  const [generateResult, setGenerateResult] = useState(null);
  // Batch runs: several takes of the same clip, billed per take
  const [batchCount, setBatchCount] = useState(1);
  const [batchTakes, setBatchTakes] = useState([]);
  const [batchChosen, setBatchChosen] = useState(null);
  // Model choice (Hailuo stays the default). End frame / seed / camera-fixed only exist on Seedance.
  const [videoModel, setVideoModel] = useState('hailuo');
  const [promptOptimizer, setPromptOptimizer] = useState(true);
  const [endImageFile, setEndImageFile] = useState(null);
  const [seedValue, setSeedValue] = useState('');
  const [cameraFixed, setCameraFixed] = useState(false);

  // Reference image
  const [seedImageFile, setSeedImageFile] = useState(null);
  const [seedImageUrl, setSeedImageUrl] = useState('');
  const [seedImageMode, setSeedImageMode] = useState('animate');

  // YouTube example
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [youtubePreview, setYoutubePreview] = useState(null);
  const [useYoutubeThumbnailAsSeed, setUseYoutubeThumbnailAsSeed] = useState(false);
  const [youtubeLoading, setYoutubeLoading] = useState(false);

  // Uploaded reference video (non-YouTube)
  const [refVideoFile, setRefVideoFile] = useState(null);
  const [refVideoInfo, setRefVideoInfo] = useState(null); // { notes, firstFrameDataUrl, duration, width, height }
  const [refVideoLoading, setRefVideoLoading] = useState(false);
  // Optional starting frame: grabbed in the browser from the chosen file at a time the user picks
  // (so no re-upload, instant preview, and they can avoid a fade-to-black final frame).
  const [refSeedOn, setRefSeedOn] = useState(false);
  const [refSeedTime, setRefSeedTime] = useState(0);
  const [refSeedFrame, setRefSeedFrame] = useState('');
  const [refVideoObjUrl, setRefVideoObjUrl] = useState('');
  const refVideoElRef = useRef(null);
  const [refVideoElapsed, setRefVideoElapsed] = useState(0);

  useEffect(() => {
    if (!refVideoFile) { setRefVideoObjUrl(''); return undefined; }
    const url = URL.createObjectURL(refVideoFile);
    setRefVideoObjUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [refVideoFile]);

  useEffect(() => {
    if (!refSeedOn || !refVideoObjUrl) { setRefSeedFrame(''); return undefined; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const v = refVideoElRef.current;
      if (!v) return;
      try {
        if (v.readyState < 1) {
          await new Promise((resolve, reject) => {
            v.addEventListener('loadedmetadata', resolve, { once: true });
            v.addEventListener('error', () => reject(new Error('unsupported')), { once: true });
          });
        }
        await new Promise((resolve) => {
          v.addEventListener('seeked', resolve, { once: true });
          v.currentTime = Math.max(0, refSeedTime);
        });
        if (cancelled) return;
        const scale = Math.min(1, 768 / (v.videoWidth || 768));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(v.videoWidth * scale);
        canvas.height = Math.round(v.videoHeight * scale);
        canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
        setRefSeedFrame(canvas.toDataURL('image/jpeg', 0.9));
      } catch {
        if (cancelled) return;
        addToast("Your browser couldn't read a frame from this video — try an MP4 (H.264) file", 'error');
        setRefSeedOn(false);
      }
    }, 150);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [refSeedOn, refSeedTime, refVideoObjUrl, addToast]);

  useEffect(() => {
    if (!refVideoLoading) { setRefVideoElapsed(0); return undefined; }
    const started = Date.now();
    const timer = setInterval(() => setRefVideoElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [refVideoLoading]);

  // Clip
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState('');
  const [clipKeepOriginal, setClipKeepOriginal] = useState(false);
  const [clipDuration, setClipDuration] = useState(0);
  const clipVideoRef = useRef(null);
  const [clipUrl, setClipUrl] = useState('');
  const [clipUrlLoading, setClipUrlLoading] = useState(false);
  // Auto-detect: a URL in the field means "fetch and clip this"; empty means "clip the
  // uploaded file below". No mode toggle — the input itself decides which path runs.
  const isClipUrlMode = /^https?:\/\//i.test(clipUrl.trim());

  // Convert
  const [crf, setCrf] = useState(23);
  const [maxWidth, setMaxWidth] = useState('');

  // Join
  const [joinFiles, setJoinFiles] = useState([]);
  const [joinMaxWidth, setJoinMaxWidth] = useState('');
  const [joinCrf, setJoinCrf] = useState(18);
  const [joinCrossfade, setJoinCrossfade] = useState('0');
  // AI plan from "Describe how to join them"; its order indices refer to joinFiles, so any change to
  // the clip list (add/remove/reorder) invalidates it.
  const [joinPlan, setJoinPlan] = useState(null);
  useEffect(() => { setJoinPlan(null); }, [joinFiles]);

  // Normalize
  const [normalizePreset, setNormalizePreset] = useState('normal');

  // Video → GIF
  const [gifFps, setGifFps] = useState(12);
  const [gifWidth, setGifWidth] = useState(480);
  const [gifStartSec, setGifStartSec] = useState(0);
  const [gifEndSec, setGifEndSec] = useState('');
  const [gifBlobUrl, setGifBlobUrl] = useState(null);
  const gifBlobRef = useRef(null);

  // Slideshow
  const [slideImages, setSlideImages] = useState([]);
  const [slideAudioFile, setSlideAudioFile] = useState(null);
  const [slideSecondsPerSlide, setSlideSecondsPerSlide] = useState(3);
  const [slideAspect, setSlideAspect] = useState('9:16');
  const [slideCrossfade, setSlideCrossfade] = useState(false);
  // AI plan from "Describe the video"; slide indices refer to slideImages order, so any change
  // to the image list (add/remove/reorder) invalidates it.
  const [slidePlan, setSlidePlan] = useState(null);
  useEffect(() => { setSlidePlan(null); }, [slideImages]);

  // Reframe
  const [reframeAspect, setReframeAspect] = useState('9:16');
  const [reframeMode, setReframeMode] = useState('crop');
  const [reframeFocus, setReframeFocus] = useState('center');

  // Audio mute/replace
  const [audioMode, setAudioMode] = useState('mute');
  const [audioFile, setAudioFile] = useState(null);

  // Speed
  const [speedFactor, setSpeedFactor] = useState('1.5');

  // Overlay
  const [overlayImageFile, setOverlayImageFile] = useState(null);
  const [overlayPosition, setOverlayPosition] = useState('bottom-right');
  const [overlayScale, setOverlayScale] = useState('20');
  const [overlayOpacity, setOverlayOpacity] = useState('0.85');

  // Annotate
  const [overlayText, setOverlayText] = useState('');
  const [textPosition, setTextPosition] = useState('bottom-center');
  const [fadeInSec, setFadeInSec] = useState(0);
  const [fadeOutSec, setFadeOutSec] = useState(0);

  // Call to action end card
  const [cta, setCta] = useState(CTA_DEFAULTS);
  const [ctaOnGenerate, setCtaOnGenerate] = useState(false);
  const [ctaOnJoin, setCtaOnJoin] = useState(false);
  const [ctaOnSlideshow, setCtaOnSlideshow] = useState(false);
  const [ctaOnAnnotate, setCtaOnAnnotate] = useState(false);
  const [ctaOnOverlay, setCtaOnOverlay] = useState(false);
  const [ctaOnExtend, setCtaOnExtend] = useState(true);

  // Extend ending
  const [exAudio, setExAudio] = useState(null);
  const [exHold, setExHold] = useState(4);
  const [exFade, setExFade] = useState(''); // empty = the same as the hold (the music fades over exactly the held time)
  const exAudioInputRef = useRef(null);
  const exAudioUrl = useMemo(() => (exAudio ? URL.createObjectURL(exAudio) : ''), [exAudio]);
  useEffect(() => () => { if (exAudioUrl) URL.revokeObjectURL(exAudioUrl); }, [exAudioUrl]);

  // Export for Social
  const [exportPresets, setExportPresets] = useState(['reels', 'square', 'landscape']);
  const [exportFocus, setExportFocus] = useState('center');
  const [exportItems, setExportItems] = useState([]);
  const [exportId, setExportId] = useState(null);

  // Mix audio
  const [mxVoice, setMxVoice] = useState(null);
  const [mxMusic, setMxMusic] = useState(null);
  const [mxMusicPct, setMxMusicPct] = useState(30);
  const [mxDucking, setMxDucking] = useState('light');
  const [mxLead, setMxLead] = useState(0);
  const [mxTail, setMxTail] = useState(3);
  const [mxFormat, setMxFormat] = useState('mp3');
  const mxVoiceInputRef = useRef(null);
  const mxMusicInputRef = useRef(null);
  const mxVoiceUrl = useMemo(() => (mxVoice ? URL.createObjectURL(mxVoice) : ''), [mxVoice]);
  const mxMusicUrl = useMemo(() => (mxMusic ? URL.createObjectURL(mxMusic) : ''), [mxMusic]);
  useEffect(() => () => { if (mxVoiceUrl) URL.revokeObjectURL(mxVoiceUrl); }, [mxVoiceUrl]);
  useEffect(() => () => { if (mxMusicUrl) URL.revokeObjectURL(mxMusicUrl); }, [mxMusicUrl]);

  // Isolate voice
  const [ivFile, setIvFile] = useState(null);
  const [ivMode, setIvMode] = useState('ai');
  const [ivResult, setIvResult] = useState(null); // { id, voice: {fileName, bytes}, music: {...}|null, mode }
  const [ivVoiceUrl, setIvVoiceUrl] = useState('');
  const [ivMusicUrl, setIvMusicUrl] = useState('');
  const ivInputRef = useRef(null);
  const ivFileUrl = useMemo(() => (ivFile ? URL.createObjectURL(ivFile) : ''), [ivFile]);
  useEffect(() => () => { if (ivFileUrl) URL.revokeObjectURL(ivFileUrl); }, [ivFileUrl]);
  useEffect(() => () => { if (ivVoiceUrl) URL.revokeObjectURL(ivVoiceUrl); }, [ivVoiceUrl]);
  useEffect(() => () => { if (ivMusicUrl) URL.revokeObjectURL(ivMusicUrl); }, [ivMusicUrl]);

  // Trim audio
  const [taFile, setTaFile] = useState(null);
  const [taStart, setTaStart] = useState('0:00');
  const [taEnd, setTaEnd] = useState('');
  const [taMode, setTaMode] = useState('keep');
  const [taFadeIn, setTaFadeIn] = useState(0);
  const [taFadeOut, setTaFadeOut] = useState(0);
  const [taFormat, setTaFormat] = useState('original');
  const [taDuration, setTaDuration] = useState(0);
  const taAudioRef = useRef(null);
  const taInputRef = useRef(null);
  const taUrl = useMemo(() => (taFile ? URL.createObjectURL(taFile) : ''), [taFile]);
  useEffect(() => () => { if (taUrl) URL.revokeObjectURL(taUrl); }, [taUrl]);

  // Audio -> transcript
  const [trAudioFile, setTrAudioFile] = useState(null);
  const [trFormat, setTrFormat] = useState('text');
  const [trText, setTrText] = useState('');
  const [trSrt, setTrSrt] = useState('');
  const [trNote, setTrNote] = useState('');
  const trInputRef = useRef(null);
  const [avAspect, setAvAspect] = useState('16:9');
  const [avCanvasColor, setAvCanvasColor] = useState('#111111');
  const trIsVideo = Boolean(trAudioFile && (/^video\//.test(trAudioFile.type) || /\.(mp4|mov|mkv|m4v|avi)$/i.test(trAudioFile.name)));
  const trAudioUrl = useMemo(() => (trAudioFile ? URL.createObjectURL(trAudioFile) : ''), [trAudioFile]);
  useEffect(() => () => { if (trAudioUrl) URL.revokeObjectURL(trAudioUrl); }, [trAudioUrl]);

  // Captions
  const [srtText, setSrtText] = useState('');
  const [transcript, setTranscript] = useState('');

  // Thumbnail
  const [thumbTime, setThumbTime] = useState(1);
  const [thumbUrl, setThumbUrl] = useState(null);

  // Library
  const [libraryItems, setLibraryItems] = useState([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [lastTransaction, setLastTransaction] = useState(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [renameId, setRenameId] = useState(null);
  const [renameValue, setRenameValue] = useState('');

  // Caption studio
  const [captionLibraryId, setCaptionLibraryId] = useState('');
  const [textFontFamily, setTextFontFamily] = useState('Roboto');
  const [textFontSize, setTextFontSize] = useState(28);
  const [textFontColor, setTextFontColor] = useState('#FFFFFF');
  const [textFontWeight, setTextFontWeight] = useState('normal');
  const [textBackgroundColor, setTextBackgroundColor] = useState('#000000');
  const [textBackgroundTransparent, setTextBackgroundTransparent] = useState(false);
  const [captionSaveToLibrary, setCaptionSaveToLibrary] = useState(true);

  const previewUrl = useMemo(() => {
    if (sourceFile) return URL.createObjectURL(sourceFile);
    return null;
  }, [sourceFile]);

  const seedImagePreview = useMemo(() => {
    if (seedImageFile) return URL.createObjectURL(seedImageFile);
    if (seedImageUrl.trim()) return seedImageUrl.trim();
    return youtubePreview?.thumbnailUrl || null;
  }, [seedImageFile, seedImageUrl, youtubePreview?.thumbnailUrl]);

  const endImagePreview = useMemo(() => (endImageFile ? URL.createObjectURL(endImageFile) : null), [endImageFile]);
  useEffect(() => () => { if (endImagePreview) URL.revokeObjectURL(endImagePreview); }, [endImagePreview]);

  useEffect(() => () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (resultBlob) URL.revokeObjectURL(resultBlob);
    if (thumbUrl) URL.revokeObjectURL(thumbUrl);
    if (gifBlobUrl) URL.revokeObjectURL(gifBlobUrl);
    if (seedImageFile && seedImagePreview?.startsWith('blob:')) URL.revokeObjectURL(seedImagePreview);
  }, [previewUrl, resultBlob, thumbUrl, gifBlobUrl, seedImageFile, seedImagePreview]);

  useEffect(() => {
    api.get('/api/settings/feature-access')
      .then((r) => r.json())
      .then((d) => { if (d?.flags) setFeatureAccess({ ...DEFAULT_FEATURE_ACCESS, ...d.flags }); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!canUse) return;
    api.get('/api/videos/status')
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
  }, [canUse]);

  const musicOk = Boolean(user?.isAdmin) || featureAccess.music !== false;

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const visible = TOOL_GROUPS.map((g) => ({ ...g, tools: g.tools.filter((t) => t.id !== 'add-music' || musicOk) }));
    if (!q) return visible;
    return visible.map((g) => ({
      ...g,
      tools: g.tools.filter((t) => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)),
    })).filter((g) => g.tools.length > 0);
  }, [search, musicOk]);

  const clearComposeResult = useCallback(() => {
    setResultBlob((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    resultBlobRef.current = null;
    setResultForTool(null);
  }, []);

  useEffect(() => {
    if (tool === 'annotate' || tool === 'extend-ending' || tool === 'end-card' || tool === 'caption-studio' || tool === 'join' || tool === 'overlay' || tool === 'slideshow') clearComposeResult();
  }, [tool, clearComposeResult]);

  useEffect(() => {
    setExportItems([]);
    setExportId(null);
  }, [sourceFile]);

  useEffect(() => {
    if (!sourceFile || tool !== 'clip') return;
    setStartSec(0);
    setEndSec('');
    setClipDuration(0);
  }, [sourceFile, tool]);

  const handleClipVideoMeta = useCallback((e) => {
    const d = e.currentTarget.duration;
    if (Number.isFinite(d) && d > 0) {
      setClipDuration(d);
      setEndSec((prev) => (prev === '' ? String(Math.round(d * 10) / 10) : prev));
    }
  }, []);

  const handleClipEndChange = useCallback((val) => {
    setEndSec(String(Math.round(val * 10) / 10));
  }, []);

  const setResultFromBlob = useCallback((blob, name, forTool = null) => {
    resultBlobRef.current = blob;
    setResultBlob((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return blob ? URL.createObjectURL(blob) : null;
    });
    if (name) setResultName(name);
    setResultForTool(forTool);
  }, []);

  const textStyleFields = useCallback(() => ({
    fontFamily: textFontFamily,
    fontSize: textFontSize,
    fontColor: textFontColor,
    fontWeight: textFontWeight,
    backgroundColor: textBackgroundColor,
    backgroundTransparent: textBackgroundTransparent,
    position: textPosition,
  }), [textFontFamily, textFontSize, textFontColor, textFontWeight, textBackgroundColor, textBackgroundTransparent, textPosition]);

  const appendTextStyleFields = useCallback((fd) => {
    Object.entries(textStyleFields()).forEach(([k, v]) => fd.append(k, String(v)));
  }, [textStyleFields]);

  const loadLibrary = useCallback(async () => {
    setLibraryLoading(true);
    try {
      const res = await api.get('/api/videos/library');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load library');
      setLibraryItems(Array.isArray(data) ? data : []);
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setLibraryLoading(false);
    }
  }, [addToast]);

  // Loaded once (not per-tool) — VideoUpload's "or choose from library" picker
  // needs the list on every single-file tool, not just Saved media/Caption studio.
  useEffect(() => {
    if (!canUse) return;
    loadLibrary();
  }, [canUse, loadLibrary]);

  const saveToLibrary = useCallback(async ({
    title,
    transaction,
    mediaType = 'video',
    blob: blobOverride = null,
    blobUrl = null,
    fileName = resultName,
    toolId = tool,
  } = {}) => {
    let blob = blobOverride;
    if (!blob && mediaType === 'image') blob = thumbBlobRef.current;
    if (!blob) blob = resultBlobRef.current;
    // Fallback for edge cases only — fetch(blob:) needs connect-src blob: in CSP
    if (!blob && (blobUrl || resultBlob)) {
      const res = await fetch(blobUrl || resultBlob);
      blob = await res.blob();
    }
    if (!blob) {
      addToast('Nothing to save yet', 'error');
      return;
    }
    startProcessing('Saving to library…', 'Storing file and tool settings.');
    try {
      const fd = new FormData();
      fd.append('file', blob, fileName);
      fd.append('title', title || saveTitle || `${toolId} · ${new Date().toLocaleDateString()}`);
      fd.append('tool', toolId);
      fd.append('mediaType', mediaType);
      fd.append('transaction', JSON.stringify(transaction || lastTransaction || {}));
      const saveRes = await api.postForm('/api/videos/library', fd);
      const item = await saveRes.json();
      if (!saveRes.ok) throw new Error(item.error || 'Save failed');
      addToast('Saved to library', 'success');
      await loadLibrary();
      return item;
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  }, [resultName, tool, saveTitle, lastTransaction, startProcessing, stopProcessing, loadLibrary, addToast, resultBlob]);

  const renameLibraryItem = useCallback(async (id, title) => {
    const name = String(title || '').trim();
    if (!name) {
      addToast('Name cannot be empty', 'error');
      return false;
    }
    try {
      const res = await api.patch(`/api/videos/library/${id}`, { title: name });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Rename failed');
      setLibraryItems((prev) => prev.map((i) => (i.id === id ? { ...i, title: data.title } : i)));
      addToast('Renamed', 'success');
      return true;
    } catch (err) {
      addToast(err.message, 'error');
      return false;
    }
  }, [addToast]);

  const deleteLibraryItem = useCallback(async (id) => {
    try {
      const res = await api.delete(`/api/videos/library/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Delete failed');
      setLibraryItems((prev) => prev.filter((i) => i.id !== id));
      setDeleteConfirmId(null);
      addToast('Deleted from library', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [addToast]);

  // Pull a saved library video down as a real File so it drops straight into
  // the same sourceFile path every tool already uploads against — no server
  // changes needed, no per-tool "or use a library id" branch to maintain.
  const useLibraryItemAsSource = useCallback(async (item) => {
    if (!item) return;
    startProcessing('Loading from library…', '');
    try {
      const res = await api.get(item.streamUrl);
      if (!res.ok) throw new Error('Could not load saved video');
      const blob = await res.blob();
      const file = new File([blob], `${item.title || 'video'}.mp4`, { type: blob.type || 'video/mp4' });
      setSourceFile(file);
      addToast('Loaded from library', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  }, [startProcessing, stopProcessing, addToast]);

  const previewLibraryItem = useCallback(async (item) => {
    startProcessing('Loading preview…', '');
    try {
      const res = await api.get(item.streamUrl);
      if (!res.ok) throw new Error('Could not load saved file');
      const blob = await res.blob();
      if (item.mediaType === 'image') {
        if (thumbUrl) URL.revokeObjectURL(thumbUrl);
        thumbBlobRef.current = blob;
        setThumbUrl(URL.createObjectURL(blob));
      } else {
        setResultFromBlob(blob, `${item.title || 'video'}.mp4`, 'saved-library');
      }
      setLastTransaction(item.transaction || { savedId: item.id, tool: item.tool });
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  }, [startProcessing, stopProcessing, setResultFromBlob, thumbUrl, addToast]);

  // Text with no times in it (no "-->" time lines) cannot be shown on a video. Rather than stopping, time it to the speech
  // first (same as the "I have a script" panel) and carry on. Returns the timed SRT; the caller shows the note.
  const timeScriptNow = async ({ file = null, libraryId = '', script }) => {
    const fd = new FormData();
    if (file) fd.append('media', file);
    else fd.append('libraryId', String(libraryId));
    fd.append('script', script);
    const res = await api.postForm('/api/videos/time-script', fd);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Could not time the text');
    addToast(
      data.method === 'speech' || data.method === 'markers'
        ? `Captions timed (${data.method === 'speech' ? 'to the speech' : 'from your times'}).`
        : `${data.note}`,
      data.method === 'even' ? 'info' : 'success',
    );
    return data.srt;
  };

  // Only real subtitle time lines count. A script with [00:00 - 00:12] markers still goes through timing (it uses those times).
  const hasCaptionTimes = (text) => /-->/.test(String(text || ''));

  const handleCaptionStudio = async () => {
    if (!srtText.trim()) {
      addToast('Paste your captions or script first', 'error');
      return;
    }
    if (!captionLibraryId && !sourceFile) {
      addToast('Choose a library video or upload a file', 'error');
      return;
    }
    const styleFields = textStyleFields();
    startProcessing('Burning captions…', 'Applying styled subtitles with ffmpeg.');
    try {
      // No timestamps in the box? Time the text to the video's speech first, show the result, then burn it.
      let burnSrt = srtText;
      if (!hasCaptionTimes(srtText)) {
        startProcessing('Timing your captions…', 'Listening to the video so each line appears when it is spoken.');
        burnSrt = await timeScriptNow({ file: captionLibraryId ? null : sourceFile, libraryId: captionLibraryId, script: srtText });
        setSrtText(burnSrt);
        startProcessing('Burning captions…', 'Applying styled subtitles with ffmpeg.');
      }
      if (captionLibraryId) {
        const fd = new FormData();
        fd.append('srtText', burnSrt);
        fd.append('saveToLibrary', String(captionSaveToLibrary));
        Object.entries(styleFields).forEach(([k, v]) => fd.append(k, String(v)));
        const res = await api.postForm(`/api/videos/library/${captionLibraryId}/captions`, fd);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Caption burn failed');
        }
        const blob = await res.blob();
        setResultFromBlob(blob, 'captioned.mp4', 'caption-studio');
        if (captionSaveToLibrary) await loadLibrary();
      } else {
        const fd = new FormData();
        fd.append('video', sourceFile);
        fd.append('srtText', burnSrt);
        appendTextStyleFields(fd);
        const res = await api.postForm('/api/videos/burn-captions', fd);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Caption burn failed');
        }
        const blob = await res.blob();
        setResultFromBlob(blob, 'captioned.mp4', 'caption-studio');
        if (captionSaveToLibrary) {
          await saveToLibrary({
            title: saveTitle || 'Captioned video',
            blob,
            fileName: 'captioned.mp4',
            toolId: 'caption-studio',
            transaction: { tool: 'caption-studio', captionStyle: styleFields },
          });
        }
      }
      setLastTransaction({ tool: 'caption-studio', captionStyle: styleFields });
      addToast('Captions applied', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const runFormVideo = useCallback(async (endpoint, formData, { label, resultFilename, isJson, forTool }) => {
    startProcessing(label, 'Processing on the server with ffmpeg.');
    try {
      const res = await api.postForm(`/api/videos/${endpoint}`, formData);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }
      if (isJson) {
        const data = await res.json();
        return data;
      }
      const blob = await res.blob();
      setResultFromBlob(blob, resultFilename, forTool ?? tool);
      setLastTransaction({ tool: forTool ?? endpoint });
      addToast('Done', 'success');
      return blob;
    } catch (err) {
      addToast(err.message, 'error');
      throw err;
    } finally {
      stopProcessing();
    }
  }, [startProcessing, stopProcessing, setResultFromBlob, addToast, tool]);

  const runClipFromUrl = useCallback(async () => {
    if (!clipUrl.trim()) { addToast('Enter a direct video file URL', 'error'); return; }
    setClipUrlLoading(true);
    startProcessing('Downloading and clipping…', 'Fetching the video file and cutting it to your in/out range.');
    try {
      const res = await api.post('/api/videos/clip-from-url', {
        url: clipUrl.trim(),
        startSec,
        endSec: endSec !== '' ? endSec : undefined,
        keepOriginal: clipKeepOriginal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }
      const blob = await res.blob();
      setResultFromBlob(blob, 'clip.mp4', 'clip');
      setLastTransaction({ tool: 'clip-from-url' });
      addToast('Clip ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      setClipUrlLoading(false);
      stopProcessing();
    }
  }, [clipUrl, startSec, endSec, clipKeepOriginal, startProcessing, stopProcessing, setResultFromBlob, addToast]);

  const requireFile = () => {
    if (!sourceFile) {
      addToast('Choose a video file first', 'error');
      return false;
    }
    return true;
  };

  const handleToGif = useCallback(async () => {
    if (!requireFile()) return;
    const fd = new FormData();
    fd.append('video', sourceFile);
    fd.append('fps', String(gifFps));
    fd.append('width', String(gifWidth));
    fd.append('startSec', String(gifStartSec || 0));
    if (gifEndSec !== '') fd.append('endSec', String(gifEndSec));
    startProcessing('Creating GIF…', 'Building an optimized colour palette, then encoding with it — two ffmpeg passes.');
    try {
      const res = await api.postForm('/api/videos/togif', fd);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'GIF export failed');
      }
      const blob = await res.blob();
      gifBlobRef.current = blob;
      setGifBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return URL.createObjectURL(blob);
      });
      setLastTransaction({ tool: 'togif', fps: gifFps, width: gifWidth, startSec: gifStartSec, endSec: gifEndSec });
      addToast('GIF ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceFile, gifFps, gifWidth, gifStartSec, gifEndSec, startProcessing, stopProcessing, addToast]);

  const handleSaveGif = useCallback(async () => {
    if (!gifBlobRef.current) {
      addToast('Nothing to save yet', 'error');
      return;
    }
    await saveToLibrary({
      title: saveTitle || 'Video GIF',
      mediaType: 'image',
      blob: gifBlobRef.current,
      fileName: 'output.gif',
      toolId: 'togif',
      transaction: { tool: 'togif', fps: gifFps, width: gifWidth, startSec: gifStartSec, endSec: gifEndSec },
    });
  }, [saveTitle, saveToLibrary, gifFps, gifWidth, gifStartSec, gifEndSec, addToast]);

  const handleSlideshow = useCallback(() => {
    if (slideImages.length < 2) {
      addToast('Add at least two images', 'error');
      return;
    }
    const fd = new FormData();
    slideImages.forEach((f) => fd.append('images', f));
    if (slideAudioFile) fd.append('audio', slideAudioFile);
    if (slidePlan) {
      fd.append('plan', JSON.stringify(slidePlan));
    } else {
      fd.append('secondsPerSlide', String(slideSecondsPerSlide));
      fd.append('aspect', slideAspect);
      if (slideCrossfade) fd.append('crossfadeSec', '0.6');
    }
    if (ctaOnSlideshow) {
      if (!ctaHasContent(cta)) { addToast('Add a headline, button text or web address for the call to action', 'error'); return; }
      appendEndCardFields(fd, cta);
    }
    runFormVideo('slideshow', fd, {
      label: ctaOnSlideshow ? 'Building slideshow with call to action…' : 'Building slideshow…',
      resultFilename: 'slideshow.mp4',
      forTool: 'slideshow',
    }).catch(() => {});
  }, [slideImages, slideAudioFile, slidePlan, slideSecondsPerSlide, slideAspect, slideCrossfade, ctaOnSlideshow, cta, runFormVideo, addToast]);

  const handleExportSocial = useCallback(async () => {
    if (!sourceFile) {
      addToast('Choose a video file first', 'error');
      return;
    }
    if (!exportPresets.length) {
      addToast('Select at least one preset', 'error');
      return;
    }
    const fd = new FormData();
    fd.append('video', sourceFile);
    fd.append('presets', JSON.stringify(exportPresets));
    fd.append('focus', exportFocus);
    startProcessing('Exporting for social…', 'Rendering each selected preset with ffmpeg (reframe + trim where needed).');
    try {
      const res = await api.postForm('/api/videos/export-social', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Export failed');
      setExportItems(data.items || []);
      setExportId(data.exportId);
      setLastTransaction({ tool: 'export-social', presets: exportPresets, focus: exportFocus });
      addToast(`Exported ${data.count} preset${data.count === 1 ? '' : 's'}`, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  }, [sourceFile, exportPresets, exportFocus, startProcessing, stopProcessing, addToast]);

  const downloadBlobUrl = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const downloadExportFile = useCallback(async (item) => {
    if (!exportId) return;
    try {
      const res = await api.get(`/api/videos/export-social/${exportId}/file/${item.presetId}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      downloadBlobUrl(blob, item.fileName);
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [exportId, addToast]);

  const downloadExportZip = useCallback(async () => {
    if (!exportId) return;
    startProcessing('Preparing zip…', '');
    try {
      const res = await api.get(`/api/videos/export-social/${exportId}/zip`);
      if (!res.ok) throw new Error('Zip download failed');
      const blob = await res.blob();
      downloadBlobUrl(blob, 'export-social.zip');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  }, [exportId, startProcessing, stopProcessing, addToast]);

  const saveExportItemToLibrary = useCallback(async (item) => {
    if (!exportId) return;
    try {
      const res = await api.get(`/api/videos/export-social/${exportId}/file/${item.presetId}`);
      if (!res.ok) throw new Error('Could not fetch file to save');
      const blob = await res.blob();
      await saveToLibrary({
        title: saveTitle || `Export social · ${item.label}`,
        blob,
        fileName: item.fileName,
        toolId: 'export-social',
        transaction: { tool: 'export-social', presetId: item.presetId, aspect: item.aspect, focus: exportFocus },
      });
    } catch (err) {
      addToast(err.message, 'error');
    }
  }, [exportId, saveToLibrary, saveTitle, exportFocus, addToast]);

  const useResultAsSource = useCallback(async () => {
    const blob = resultBlobRef.current;
    if (!blob) {
      addToast('Nothing to load as source', 'error');
      return;
    }
    try {
      const file = new File([blob], resultName, { type: blob.type || 'video/mp4' });
      setSourceFile(file);
      addToast('Result loaded as source', 'success');
    } catch {
      addToast('Could not load result as source', 'error');
    }
  }, [resultName, addToast]);

  const handleTranscribeAudio = async () => {
    if (!trAudioFile) { addToast('Choose an audio or video file first', 'error'); return; }
    startProcessing('Transcribing…', 'Listening to the recording and writing it out. Long files can take a minute or two.');
    try {
      const fd = new FormData();
      fd.append('audio', trAudioFile);
      fd.append('format', trFormat);
      const res = await api.postForm('/api/videos/transcribe-audio', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Transcription failed');
      setTrText(data.text || '');
      setTrSrt(data.srt || '');
      setTrNote(data.timestamps === false && trFormat === 'srt' ? 'Timestamps are not available on this server, so this is plain text.' : '');
      addToast('Transcript ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  // The SRT with the corrections made in the text box carried in (timings kept). applied=false = line count changed.
  const transcriptSrtWithEdits = () => applyEditedText(trSrt, trText);

  const useTranscriptAsCaptions = () => {
    // With no timestamps yet, the plain text goes across as it is; Caption studio times it to the video when you burn.
    const { srt, applied } = trSrt ? transcriptSrtWithEdits() : { srt: trText, applied: true };
    setSrtText(srt);
    setCaptionLibraryId('');
    setTool('caption-studio');
    setOpenGroup('compose');
    addToast(
      applied
        ? (trSrt ? 'Transcript loaded as captions. Choose your video, then burn them in.' : 'Text loaded. Choose your video, then burn: Vault will time the text to the speech for you.')
        : 'Loaded as captions, but your edits were not included because lines were added or removed. Edit the captions box here instead.',
      applied ? 'success' : 'info',
    );
  };

  const downloadTranscript = (kind) => {
    const body = kind === 'srt' ? transcriptSrtWithEdits().srt : trText;
    if (!body) return;
    const base = (trAudioFile?.name || 'transcript').replace(/\.[^.]+$/, '');
    const url = URL.createObjectURL(new Blob([body], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}.${kind === 'srt' ? 'srt' : 'txt'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleMixAudio = async () => {
    if (!mxVoice) { addToast('Choose the voice recording first', 'error'); return; }
    if (!mxMusic) { addToast('Choose the music first', 'error'); return; }
    startProcessing('Mixing…', 'Fitting the music to the voice and mixing them. Long recordings take a little while.');
    try {
      const fd = new FormData();
      fd.append('voice', mxVoice);
      fd.append('music', mxMusic);
      fd.append('musicVolume', String((Number(mxMusicPct) || 30) / 100));
      fd.append('ducking', mxDucking);
      fd.append('leadInSec', String(Number(mxLead) || 0));
      fd.append('tailSec', String(Number(mxTail) || 0));
      fd.append('format', mxFormat);
      const res = await api.postForm('/api/videos/mix-audio', fd);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Mixing failed');
      }
      const blob = await res.blob();
      const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      setResultFromBlob(blob, named ? named[1] : `mixed.${mxFormat}`, 'mix-audio');
      addToast('Mixed', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  // Hand the mixed audio to another audio tool as its input file.
  const sendMixedTo = (toolId) => {
    const blob = resultBlobRef.current;
    if (!blob) return;
    const file = new File([blob], resultName, { type: blob.type });
    if (toolId === 'transcribe-audio') {
      setTrAudioFile(file); setTrText(''); setTrSrt(''); setTrNote('');
      setTool('transcribe-audio'); setOpenGroup('optimise');
    } else {
      setTaFile(file); setTaDuration(0); setTaStart('0:00'); setTaEnd('');
      setTool('trim-audio'); setOpenGroup('transform');
    }
  };

  const handleIsolateVoice = async () => {
    if (!ivFile) { addToast('Choose an audio file first', 'error'); return; }
    const mode = status?.isolateVoice?.ai ? ivMode : 'quick'; // the AI option only exists when the server has the key
    startProcessing(
      mode === 'ai' ? 'Separating the voice from the music…' : 'Cleaning up the voice…',
      mode === 'ai' ? 'This can take a minute or two for a long recording. Please keep this page open.' : 'This takes a few seconds.',
    );
    try {
      const fd = new FormData();
      fd.append('audio', ivFile);
      fd.append('mode', mode);
      const res = await api.postForm('/api/videos/isolate-voice', fd);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not isolate the voice');
      const fetchBlobUrl = async (stem) => {
        const r = await api.get(`/api/videos/isolate-voice/${data.id}/${stem}`);
        if (!r.ok) throw new Error('Could not load the result');
        return URL.createObjectURL(await r.blob());
      };
      const voiceUrl = await fetchBlobUrl('voice');
      const musicUrl = data.music ? await fetchBlobUrl('music').catch(() => '') : '';
      setIvVoiceUrl(voiceUrl);
      setIvMusicUrl(musicUrl);
      setIvResult(data);
      addToast('Voice ready', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  // Hand the cleaned voice to another audio tool as its input file.
  const sendVoiceTo = async (toolId) => {
    if (!ivVoiceUrl || !ivResult) return;
    const blob = await (await fetch(ivVoiceUrl)).blob();
    const file = new File([blob], ivResult.voice.fileName, { type: blob.type });
    if (toolId === 'transcribe-audio') {
      setTrAudioFile(file); setTrText(''); setTrSrt(''); setTrNote('');
      setTool('transcribe-audio'); setOpenGroup('optimise');
    } else {
      setTaFile(file); setTaDuration(0); setTaStart('0:00'); setTaEnd('');
      setTool('trim-audio'); setOpenGroup('transform');
    }
  };

  const handleTrimAudio = async () => {
    if (!taFile) { addToast('Choose an audio file first', 'error'); return; }
    const start = parseClock(taStart || '0');
    const end = taEnd.trim() === '' ? null : parseClock(taEnd);
    if (start === null) { addToast('The start time is not a time. Try 1:30 or 90.', 'error'); return; }
    if (taEnd.trim() !== '' && end === null) { addToast('The end time is not a time. Try 2:45 or 165.', 'error'); return; }
    startProcessing('Trimming…', 'Cutting the audio.');
    try {
      const fd = new FormData();
      fd.append('audio', taFile);
      fd.append('startSec', String(start));
      if (end !== null) fd.append('endSec', String(end));
      fd.append('mode', taMode);
      fd.append('fadeInSec', String(taFadeIn || 0));
      fd.append('fadeOutSec', String(taFadeOut || 0));
      fd.append('format', taFormat);
      const res = await api.postForm('/api/videos/trim-audio', fd);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Trimming failed');
      }
      const blob = await res.blob();
      // The server names the file and may change its type (fades need MP3); take the name it chose.
      const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '');
      setResultFromBlob(blob, named ? named[1] : 'trimmed-audio.mp3', 'trim-audio');
      addToast('Audio trimmed', 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const useTrimmedForTranscript = () => {
    const blob = resultBlobRef.current;
    if (!blob) return;
    setTrAudioFile(new File([blob], resultName, { type: blob.type }));
    setTrText(''); setTrSrt(''); setTrNote('');
    setTool('transcribe-audio');
    setOpenGroup('optimise');
  };

  const makeTranscriptVideo = async () => {
    if (!trSrt && !trText.trim()) { addToast('Transcribe or paste your script first', 'error'); return; }
    if (!trAudioFile) { addToast('Choose the audio or video file first', 'error'); return; }
    let srt;
    if (trSrt) {
      srt = transcriptSrtWithEdits().srt;
    } else {
      // Plain text with no times: listen to the recording and time it, then carry on.
      startProcessing('Timing your captions…', 'Listening to the recording so each line appears when it is spoken.');
      try {
        srt = await timeScriptNow({ file: trAudioFile, script: trText });
        setTrSrt(srt);
      } catch (err) {
        addToast(err.message, 'error');
        return;
      } finally {
        stopProcessing();
      }
    }
    const fd = new FormData();
    // A video gets the captions burned onto it; audio gets a plain coloured screen made for it.
    fd.append(trIsVideo ? 'video' : 'audio', trAudioFile);
    fd.append('srtText', srt);
    if (!trIsVideo) {
      fd.append('aspect', avAspect);
      fd.append('canvasColor', avCanvasColor);
    }
    fd.append('fontFamily', textFontFamily);
    fd.append('fontSize', String(textFontSize));
    fd.append('fontColor', textFontColor);
    fd.append('fontWeight', textFontWeight);
    fd.append('backgroundColor', textBackgroundColor);
    fd.append('backgroundTransparent', String(textBackgroundTransparent));
    fd.append('position', 'bottom-center');
    await runFormVideo(trIsVideo ? 'burn-captions' : 'audio-to-video', fd, { label: trIsVideo ? 'Adding the captions…' : 'Making the video…', resultFilename: trIsVideo ? 'captioned.mp4' : 'transcript-video.mp4', forTool: 'transcribe-audio' })
      .catch(() => {});
  };

  const copyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(trText);
      addToast('Copied', 'success');
    } catch {
      addToast('Could not copy. Select the text and copy it by hand.', 'error');
    }
  };

  const handleProbe = async () => {
    if (!requireFile()) return;
    const fd = new FormData();
    fd.append('video', sourceFile);
    startProcessing('Reading file info…', '');
    try {
      const res = await api.postForm('/api/videos/probe', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Probe failed');
      setProbe(data);
      if (data.duration) setEndSec(String(Math.floor(data.duration)));
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  const fetchRemoteVideoBlob = useCallback(async (videoUrl) => {
    const res = await api.post('/api/videos/playback', { url: videoUrl });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Could not load video for playback');
    }
    return res.blob();
  }, []);

  // Append the closing screen to a generated clip. Never throws: the clip has already been
  // paid for, so on failure the caller keeps the plain clip and the user is told why.
  const withEndCard = useCallback(async (blob) => {
    if (!ctaOnGenerate || !ctaHasContent(cta)) return blob;
    try {
      const file = new File([blob], 'clip.mp4', { type: blob.type || 'video/mp4' });
      const res = await api.postForm('/api/videos/end-card', endCardFormData(file, cta));
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Request failed');
      }
      return await res.blob();
    } catch (err) {
      addToast(`Call to action not added: ${err.message}. Showing the clip without it.`, 'error');
      return blob;
    }
  }, [ctaOnGenerate, cta, addToast]);

  const hydrateRemoteVideo = useCallback(async (videoUrl) => {
    let blob = await fetchRemoteVideoBlob(videoUrl);
    if (ctaOnGenerate) startProcessing('Adding call to action…', 'Appending your closing screen.');
    blob = await withEndCard(blob);
    setResultFromBlob(blob, 'generated.mp4', 'generate');
  }, [fetchRemoteVideoBlob, setResultFromBlob, withEndCard, ctaOnGenerate, startProcessing]);

  const handleLoadYoutube = async () => {
    if (!youtubeUrl.trim()) {
      addToast('Paste a YouTube URL', 'error');
      return;
    }
    setYoutubeLoading(true);
    try {
      const res = await api.post('/api/videos/youtube-preview', { url: youtubeUrl.trim() });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load video');
      setYoutubePreview(data);
      addToast('YouTube example loaded', 'success');
    } catch (err) {
      addToast(err.message, 'error');
      setYoutubePreview(null);
    } finally {
      setYoutubeLoading(false);
    }
  };

  const handleRefVideoFile = async (file) => {
    setRefVideoInfo(null);
    setRefSeedOn(false);
    setRefSeedTime(0);
    setRefSeedFrame('');
    setRefVideoFile(file || null);
    if (!file) return;
    setRefVideoLoading(true);
    try {
      const fd = new FormData();
      fd.append('video', file);
      const res = await api.postForm('/api/videos/reference-video', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not analyse video');
      setRefVideoInfo(data);
      addToast('Reference video analysed', 'success');
    } catch (err) {
      addToast(err.message, 'error');
      setRefVideoFile(null);
    } finally {
      setRefVideoLoading(false);
    }
  };

  const generateProvider = (selectedProvider && status?.generate?.availableProviders?.[selectedProvider])
    ? selectedProvider
    : status?.generate?.provider;
  const replicateActive = generateProvider === 'replicate';
  const generateModels = (status?.generate?.videoModels || []).filter((m) => m.available);
  const modelCaps = (replicateActive ? generateModels.find((m) => m.id === videoModel)?.capabilities : null) || {};

  const clearBatchTakes = () => {
    setBatchTakes((prev) => { prev.forEach((t) => t.url && URL.revokeObjectURL(t.url)); return []; });
    setBatchChosen(null);
  };

  const chooseTake = (i, takes = batchTakes) => {
    const take = takes[i];
    if (!take?.blob) return;
    setBatchChosen(i);
    setResultFromBlob(take.blob, `generated-take-${i + 1}.mp4`, 'generate');
    if (take.meta) setGenerateResult(take.meta);
  };

  // Poll every take, then download the ones that finished and offer them side by side.
  const runBatch = async (started) => {
    const items = started.items;
    const total = items.length;
    if (started.errors?.length) {
      addToast(`${started.errors.length} of ${started.requested} takes could not start: ${started.errors[0]}`, 'error');
    }
    setGenerateResult(items[0]);
    const done = new Array(total).fill(null);
    const failed = {};
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const pending = items.map((_, i) => i).filter((i) => !done[i] && failed[i] == null);
      if (!pending.length) break;
      await Promise.all(pending.map(async (i) => {
        try {
          const r = await api.get(`/api/videos/generate/status?requestId=${encodeURIComponent(items[i].requestId)}`);
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || 'Status check failed');
          if (d.status === 'COMPLETED') done[i] = d;
        } catch (e) {
          failed[i] = e.message;
        }
      }));
      const ready = done.filter(Boolean).length;
      startProcessing(`Generating ${total} takes…`, `${ready} of ${total} ready — each take can take 1–3 minutes.`);
    }
    if (!done.some(Boolean)) throw new Error('None of the takes finished — try again in a moment');

    startProcessing('Preparing playback…', ctaOnGenerate ? 'Downloading your takes and adding the call to action.' : 'Downloading your takes for in-browser preview.');
    const takes = await Promise.all(items.map(async (it, i) => {
      const label = `Take ${i + 1}`;
      const d = done[i];
      if (!d) return { requestId: it.requestId, label, error: failed[i] || 'Did not finish in time' };
      try {
        let blob;
        if (d.inline?.base64) {
          const bin = Uint8Array.from(atob(d.inline.base64), (c) => c.charCodeAt(0));
          blob = new Blob([bin], { type: d.inline.contentType || 'video/mp4' });
        } else {
          blob = await fetchRemoteVideoBlob(d.videoUrl);
        }
        blob = await withEndCard(blob);
        return { requestId: it.requestId, label, blob, url: URL.createObjectURL(blob), meta: d };
      } catch (e) {
        return { requestId: it.requestId, label, error: e.message };
      }
    }));

    setBatchTakes((prev) => { prev.forEach((t) => t.url && URL.revokeObjectURL(t.url)); return takes; });
    const first = takes.findIndex((t) => t.blob);
    if (first < 0) throw new Error('The takes finished but could not be loaded for playback');
    chooseTake(first, takes);
    const okTakes = takes.filter((t) => t.meta);
    const priced = okTakes.every((t) => t.meta.usage?.videoCostKnown !== false);
    const videoCost = priced ? okTakes.reduce((sum, t) => sum + (t.meta.usage?.videoCostUsd || 0), 0) : 0;
    const promptCost = okTakes[0]?.meta.usage?.promptCostUsd || 0;
    setLastTransaction({
      tool: 'generate',
      brief,
      style,
      aspect,
      durationSec,
      seedImageMode,
      youtubeUrl: youtubeUrl.trim() || undefined,
      video_prompt: okTakes[0].meta.video_prompt,
      mode: okTakes[0].meta.mode,
      provider: okTakes[0].meta.provider || started.items[0].provider,
      takes: total,
    });
    addToast(`${okTakes.length} of ${total} takes ready — pick the best${videoCost ? ` (~$${(videoCost + promptCost).toFixed(2)} estimated)` : ''}`, 'success');
  };

  const handleGenerate = async () => {
    const hasBrief = Boolean(brief.trim());
    const hasImage = Boolean(seedImageFile || seedImageUrl.trim());
    const hasYoutube = Boolean(youtubeUrl.trim());
    const hasRefVideo = Boolean(refVideoInfo?.notes);
    if (!hasBrief && !hasImage && !hasYoutube && !hasRefVideo) {
      addToast('Add a brief, reference image, reference video, or YouTube example', 'error');
      return;
    }

    startProcessing(batchCount > 1 ? `Preparing ${batchCount} takes…` : 'Preparing clip…', 'Analysing references and submitting to the video model.');
    clearBatchTakes();
    try {
      let seedImageDataUrl = '';
      if (seedImageFile) {
        seedImageDataUrl = await readFileAsDataUrl(seedImageFile);
      } else if (seedImageUrl.trim()) {
        seedImageDataUrl = seedImageUrl.trim();
      } else if (refSeedOn && refSeedFrame) {
        seedImageDataUrl = refSeedFrame;
      }

      const res = await api.post('/api/videos/generate', {
        brief,
        style,
        aspect,
        durationSec,
        seedImageDataUrl: seedImageDataUrl || undefined,
        seedImageMode: seedImageDataUrl && !seedImageFile && !seedImageUrl.trim() ? 'animate' : seedImageMode,
        youtubeUrl: youtubeUrl.trim() || undefined,
        useYoutubeThumbnailAsSeed,
        videoReferenceNotes: refVideoInfo?.notes || undefined,
        takes: batchCount > 1 ? batchCount : undefined,
        // Only send what the chosen model can do; the server rejects the rest.
        model: replicateActive ? videoModel : undefined,
        endImageDataUrl: modelCaps.endFrame && endImageFile ? await readFileAsDataUrl(endImageFile) : undefined,
        seed: modelCaps.seed && seedValue.trim() !== '' ? seedValue.trim() : undefined,
        cameraFixed: modelCaps.cameraFixed && cameraFixed ? true : undefined,
        promptOptimizer: modelCaps.promptOptimizer && !promptOptimizer ? false : undefined,
        provider: selectedProvider || undefined,
      });
      const started = await res.json();
      if (!res.ok) throw new Error(started.error || 'Generate failed');

      if (started.batch) {
        await runBatch(started);
        return;
      }

      setGenerateResult(started);

      const params = new URLSearchParams({ requestId: started.requestId });

      let completed = null;
      for (let attempt = 0; attempt < 120; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const statusRes = await api.get(`/api/videos/generate/status?${params.toString()}`);
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Status check failed');

        const providerLabel = started.provider === 'replicate' ? 'Replicate' : 'FAL';
        const detail = statusData.status === 'IN_QUEUE'
          ? (statusData.queuePosition != null ? `Queued — position ${statusData.queuePosition + 1}` : `Queued on ${providerLabel}…`)
          : statusData.status === 'IN_PROGRESS'
            ? `Rendering video on ${providerLabel} (this can take 1–3 minutes)…`
            : `Waiting for ${providerLabel}…`;
        startProcessing('Generating clip…', detail);

        if (statusData.status === 'COMPLETED') {
          completed = statusData;
          break;
        }
      }

      if (!completed) throw new Error('Video generation timed out — try again in a moment');

      setGenerateResult(completed);
      if (completed.inline?.base64) {
        const bin = Uint8Array.from(atob(completed.inline.base64), (c) => c.charCodeAt(0));
        let inlineBlob = new Blob([bin], { type: completed.inline.contentType || 'video/mp4' });
        if (ctaOnGenerate) startProcessing('Adding call to action…', 'Appending your closing screen.');
        inlineBlob = await withEndCard(inlineBlob);
        setResultFromBlob(inlineBlob, 'generated.mp4', 'generate');
      } else if (completed.videoUrl) {
        startProcessing('Preparing playback…', 'Downloading your clip for in-browser preview.');
        await hydrateRemoteVideo(completed.videoUrl);
      }
      setLastTransaction({
        tool: 'generate',
        brief,
        style,
        aspect,
        durationSec,
        seedImageMode,
        youtubeUrl: youtubeUrl.trim() || undefined,
        video_prompt: completed.video_prompt,
        mode: completed.mode,
        provider: completed.provider || started.provider,
      });
      const usage = completed.usage;
      const usageSuffix = usage
        ? ` — ${usage.promptTokens.toLocaleString()} tokens${usage.videoCostKnown === false ? '' : `, ~$${usage.totalEstimatedCostUsd.toFixed(3)}`}`
        : '';
      addToast((completed.mode === 'image-to-video' ? 'Clip generated from image' : 'Clip generated') + usageSuffix, 'success');
    } catch (err) {
      addToast(err.message, 'error');
    } finally {
      stopProcessing();
    }
  };

  const libraryVideoItems = useMemo(
    () => libraryItems.filter((i) => i.mediaType === 'video'),
    [libraryItems],
  );

  const navigate = useNavigate();

  // Hand a video to Music (no re-upload) and open it. Music saves finished videos to Saved media.
  const openMusicWith = useCallback((file) => {
    setVideoHandoff(file || null);
    navigate('/music');
  }, [navigate]);

  // The tutor's "Open <tool>" buttons: open the tool's group and the tool, exactly as clicking it in the sidebar would.
  const openToolById = useCallback((id) => {
    const group = TOOL_GROUPS.find((g) => g.tools.some((t) => t.id === id));
    const entry = group?.tools.find((t) => t.id === id);
    if (!entry) return;
    if (entry.link) { openMusicWith(sourceFile); return; }
    setOpenGroup(group.id);
    setTool(id);
  }, [openMusicWith, sourceFile]);

  const handleAddMusicFromResult = useCallback(() => {
    const blob = resultBlobRef.current;
    if (!blob) { addToast('Nothing to add music to yet', 'error'); return; }
    openMusicWith(new File([blob], resultName || 'video.mp4', { type: blob.type || 'video/mp4' }));
  }, [resultName, addToast, openMusicWith]);

  const handleSaveResult = useCallback(() => {
    saveToLibrary({ title: saveTitle });
  }, [saveToLibrary, saveTitle]);

  const handleSaveThumbnail = useCallback(async () => {
    if (!thumbBlobRef.current) return;
    await saveToLibrary({
      title: saveTitle || 'Thumbnail',
      mediaType: 'image',
      blob: thumbBlobRef.current,
      fileName: 'thumbnail.jpg',
      toolId: 'thumbnail',
      transaction: { tool: 'thumbnail', thumbTime },
    });
  }, [saveTitle, saveToLibrary, thumbTime]);

  const openCaptionStudioFor = useCallback((item) => {
    setCaptionLibraryId(String(item.id));
    setSourceFile(null);
    setSrtText('');
    setTool('caption-studio');
    setOpenGroup('compose');
  }, []);

  if (!canUse) return <Navigate to="/" replace />;

  // Spoken directions: the server turns the words into validated field values; this maps them onto each tool's state.
  const applyVoiceValues = (toolId, v) => {
    const textStyle = {
      textFontSize: setTextFontSize, textFontColor: setTextFontColor, textFontWeight: setTextFontWeight,
      textBackgroundColor: (x) => { setTextBackgroundColor(x); setTextBackgroundTransparent(false); },
      textBackgroundTransparent: setTextBackgroundTransparent,
    };
    const setters = {
      generate: { brief: setBrief, style: setStyle, aspect: setAspect, durationSec: setDurationSec, batchCount: setBatchCount },
      clip: { startSec: setStartSec, endSec: (x) => setEndSec(String(x)) },
      convert: { crf: setCrf, maxWidth: (x) => setMaxWidth(String(x)) },
      audio: { audioMode: setAudioMode },
      normalize: { normalizePreset: setNormalizePreset },
      togif: { gifFps: setGifFps, gifWidth: setGifWidth, gifStartSec: setGifStartSec, gifEndSec: (x) => setGifEndSec(String(x)) },
      'export-social': { exportPresets: setExportPresets, exportFocus: setExportFocus },
      reframe: { reframeAspect: setReframeAspect, reframeMode: setReframeMode, reframeFocus: setReframeFocus },
      speed: { speedFactor: (x) => setSpeedFactor(String(x)) },
      annotate: { overlayText: setOverlayText, textPosition: setTextPosition, fadeInSec: setFadeInSec, fadeOutSec: setFadeOutSec, ...textStyle },
      'end-card': Object.fromEntries(['headline', 'subline', 'buttonText', 'url', 'durationSec'].map((k) => [k, (x) => setCta((c) => ({ ...c, [k]: x }))])),
      overlay: { overlayPosition: setOverlayPosition, overlayScale: (x) => setOverlayScale(String(x)), overlayOpacity: (x) => setOverlayOpacity(String(x)) },
      join: { joinMaxWidth: (x) => setJoinMaxWidth(String(x)), joinCrf: setJoinCrf, joinCrossfade: (x) => setJoinCrossfade(String(x)) },
      slideshow: { slideSecondsPerSlide: setSlideSecondsPerSlide, slideAspect: setSlideAspect, slideCrossfade: setSlideCrossfade },
      'caption-studio': textStyle,
      thumbnail: { thumbTime: setThumbTime },
      'extend-ending': { holdSec: setExHold, fadeOutSec: (x) => setExFade(String(x)) },
      'mix-audio': { musicVolume: setMxMusicPct, ducking: setMxDucking, leadInSec: setMxLead, tailSec: setMxTail, format: setMxFormat },
      'trim-audio': {
        startSec: (x) => setTaStart(formatClock(x)),
        endSec: (x) => setTaEnd(formatClock(x)),
        mode: setTaMode,
        fadeInSec: setTaFadeIn,
        fadeOutSec: setTaFadeOut,
        format: setTaFormat,
      },
    }[toolId] || {};
    for (const [k, val] of Object.entries(v)) setters[k]?.(val);
  };

  const voiceValue = {
    run: async (toolId, transcript) => {
      const res = await api.post('/api/videos/voice-command', {
        tool: toolId,
        transcript,
        context: { durationSec: clipDuration || probe?.duration || 0 },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Could not understand that');
      applyVoiceValues(toolId, data.values || {});
      return data;
    },
  };

  const ffmpegOk = status?.ffmpeg;
  const generateOk = status?.generate?.available;
  const resultSaveProps = {
    onMusic: musicOk ? handleAddMusicFromResult : undefined,
    onSave: handleSaveResult,
    saveTitle,
    onSaveTitleChange: setSaveTitle,
  };

  return (
    <VoiceInputProvider lang="en-AU">
    <VideoVoiceContext.Provider value={voiceValue}>
    <div className="flex flex-col sm:flex-row min-h-[calc(100dvh-3rem)]">
      <aside
        className="w-full sm:w-56 shrink-0 border-b sm:border-b-0 sm:border-r overflow-y-auto p-4 space-y-3"
        style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>
            {getIcon('film', { size: 16 })}
          </div>
          <h1 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Video Tools</h1>
          <button
            onClick={videoInfo.open}
            title="How Video Tools works"
            style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'opacity 0.2s' }}
            onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}
          >
            {getIcon('info', { size: 13 })}
          </button>
        </div>
        {videoInfo.show && (
          <ToolInfoModal title="How Video Tools Works" onClose={videoInfo.close}>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              A real production suite built on ffmpeg — six groups in the sidebar covering everything from a blank brief to a captioned, platform-ready export:
            </p>
            <div className="rounded-lg p-3 text-sm space-y-2" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <p style={{ color: 'var(--color-text)' }}><strong>Create</strong> generates a new clip from a text brief via Replicate's <code>minimax/hailuo-2.3</code> (FAL as fallback) — brief expansion runs first, so a rough idea becomes a properly-formed prompt before the model ever sees it. An optional seed image can animate directly or steer the generated style.</p>
              <p style={{ color: 'var(--color-text)' }}><strong>Optimise</strong> — Convert/compress (adjustable CRF/width), Extract audio (MP3/WAV), Mute/replace audio, Normalize audio (one-click loudness fix), Video→GIF (optimized palette), Export for Social (one video → Reels/Square/Landscape presets in one pass).</p>
              <p style={{ color: 'var(--color-text)' }}><strong>Transform</strong> — Clip/trim (upload a file, or paste a direct licensed-video URL), Crop/reframe (9:16, 16:9, 1:1, 4:5 — crop or letterbox), Speed (0.25×–4×, audio pitch handled correctly).</p>
              <p style={{ color: 'var(--color-text)' }}><strong>Compose</strong> — Annotate (burned-in text), Overlay/watermark, Join videos (hard cut or crossfade — each clip auto-normalized to a shared resolution/frame rate/audio format first, so a join never breaks on mismatched sources), Slideshow (images + music → promo video), and <strong>Caption studio</strong>: real styled subtitles with font, weight, size, and color all yours to set, from an uploaded SRT or (in dev) a local whisper-cli transcription.</p>
              <p style={{ color: 'var(--color-text)' }}><strong>Library</strong> saves full results with their settings intact, so anything you keep can be re-run or re-captioned later, not just re-downloaded. <strong>Analyse</strong> covers File info (duration/resolution/codec) and Thumbnail export.</p>
            </div>
            <p className="text-sm" style={{ color: 'var(--color-text)' }}>
              No YouTube/Vimeo/TikTok downloading anywhere in this tool, by design — the Clip tool's URL option only accepts a direct video file link, not a platform page.
            </p>
          </ToolInfoModal>
        )}

        <Tooltip text="Filter the tool list below by name or description.">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tools…"
            className="w-full px-2.5 py-1.5 rounded-lg border text-xs outline-none"
            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          />
        </Tooltip>

        {filteredGroups.map((group) => (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => setOpenGroup(openGroup === group.id ? null : group.id)}
              className="text-xs font-semibold w-full text-left py-1 transition-opacity hover:opacity-70"
              style={{ color: 'var(--color-primary)' }}
            >
              {openGroup === group.id ? '▼' : '▶'} {group.label}
            </button>
            {(openGroup === group.id || search.trim()) && (
              <ul className="pl-2 border-l ml-1 space-y-0.5 mt-1" style={{ borderColor: 'var(--color-border)' }}>
                {group.tools.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => (t.link ? openMusicWith(sourceFile) : setTool(t.id))}
                      className="w-full text-left px-2 py-1.5 rounded-lg text-xs transition-opacity hover:opacity-70"
                      style={{
                        background: tool === t.id ? 'var(--color-bg)' : 'transparent',
                        color: tool === t.id ? 'var(--color-text)' : 'var(--color-muted)',
                      }}
                    >
                      {t.label}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </aside>

      <main className="flex-1 overflow-y-auto p-6 space-y-4 max-w-2xl">
        {status && !ffmpegOk && (
          <div className="rounded-xl border p-3 text-xs" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
            ffmpeg is not available on this server — clip, convert and annotate tools will not work until ffmpeg is installed.
          </div>
        )}

        {tool === 'generate' && (
          <section className="space-y-4">
            <div>
              <ToolHeader id="generate" label="Generate clip" onHelp={setHelpTool} getIcon={getIcon} />
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Describe a short clip. Optionally upload a reference image (animate it or use as style inspiration) or paste a YouTube example.
              </p>
            </div>
            {!generateOk && (
              <p className="text-xs rounded-xl border p-3" style={{ borderColor: '#f59e0b', color: 'var(--color-muted)' }}>
                Add <strong>REPLICATE_API_TOKEN</strong> or <strong>FAL_API_KEY</strong> in Railway. Replicate is preferred when both are set ({status?.generate?.provider || 'replicate'} · {status?.generate?.model || 'minimax/hailuo-2.3'}).
              </p>
            )}
            {generateOk && (() => {
              const avail = status?.generate?.availableProviders || {};
              const bothAvailable = avail.replicate && avail.fal;
              const activeProvider = bothAvailable
                ? (selectedProvider || status?.generate?.provider)
                : status?.generate?.provider;
              const activeModel = status?.generate?.models?.[activeProvider] || status?.generate?.model;
              return (
                <p className="text-xs rounded-xl border px-3 py-2 flex flex-wrap items-center gap-1.5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                  Provider:
                  {bothAvailable ? (
                    <Tooltip text="Both REPLICATE_API_TOKEN and FAL_API_KEY are configured — choose which one runs this generation.">
                      <select
                        value={activeProvider}
                        onChange={(e) => setSelectedProvider(e.target.value)}
                        className="px-2 py-1 rounded-lg border text-xs font-medium"
                        style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                      >
                        <option value="replicate">Replicate</option>
                        <option value="fal">FAL</option>
                      </select>
                    </Tooltip>
                  ) : (
                    <strong style={{ color: 'var(--color-text)' }}>{activeProvider === 'replicate' ? 'Replicate' : 'FAL'}</strong>
                  )}
                  <span>·</span>
                  <span className="font-mono">{activeModel}</span>
                  {activeProvider === 'fal' && (
                    <span style={{ color: '#f59e0b' }}>
                      {bothAvailable ? '— tends toward a stylized/CGI look for humans' : '— add REPLICATE_API_TOKEN for more photoreal humans'}
                    </span>
                  )}
                  <Tooltip text="What's the difference between these providers?">
                    <button
                      type="button"
                      onClick={() => setProviderInfoOpen(true)}
                      className="hover:opacity-60 transition-opacity flex-shrink-0"
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {getIcon('help-circle', { size: 13 })}
                    </button>
                  </Tooltip>
                </p>
              );
            })()}
            <label className="block space-y-1">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What should happen on screen?</span>
              <Tooltip text="Describe the shot in plain language — the workspace's light model expands this into a full video prompt.">
                <VoiceInput
                  type="textarea"
                  append
                  value={brief}
                  onChange={setBrief}
                  rows={4}
                  placeholder="A calm product shot of wireless earbuds rotating on a marble surface… (optional if you provide an image or YouTube example)"
                  label="What should happen on screen"
                  className="resize-y"
                />
              </Tooltip>
            </label>

            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Reference image (optional)</p>
              <ImageReferenceUpload
                file={seedImageFile}
                previewUrl={seedImageFile ? seedImagePreview : (seedImageUrl.trim() ? seedImagePreview : null)}
                onFile={(f) => { setSeedImageFile(f); if (f) setSeedImageUrl(''); }}
                onClear={() => { setSeedImageFile(null); setSeedImageUrl(''); }}
              />
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Or paste image URL</span>
                <Tooltip text="A public image URL to use instead of uploading a file.">
                  <input
                    type="url"
                    value={seedImageUrl}
                    onChange={(e) => { setSeedImageUrl(e.target.value); if (e.target.value) setSeedImageFile(null); }}
                    placeholder="https://…"
                    className="w-full px-3 py-2 rounded-xl border text-xs"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </Tooltip>
              </label>
              {(seedImageFile || seedImageUrl.trim()) && (
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'animate', label: 'Animate this image', tip: 'Use the image as the first frame and generate motion from it (image-to-video).' },
                    { id: 'suggest', label: 'Style suggestion only', tip: "Describe the image's style with AI and weave that into the text prompt, without using it as a starting frame." },
                  ].map((opt) => (
                    <Tooltip key={opt.id} text={opt.tip}>
                      <button
                        type="button"
                        onClick={() => setSeedImageMode(opt.id)}
                        className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                        style={{
                          borderColor: seedImageMode === opt.id ? 'var(--color-primary)' : 'var(--color-border)',
                          color: seedImageMode === opt.id ? 'var(--color-primary)' : 'var(--color-muted)',
                          background: seedImageMode === opt.id ? 'var(--color-surface)' : 'transparent',
                        }}
                      >
                        {opt.label}
                      </button>
                    </Tooltip>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Reference video (optional)</p>
              <Tooltip text="Upload your own video. A few frames are analysed so the new clip can match its look, camera feel and pacing. The file is not stored or copied.">
                <input
                  type="file"
                  accept="video/*"
                  disabled={refVideoLoading}
                  onChange={(e) => { handleRefVideoFile(e.target.files?.[0]); e.target.value = ''; }}
                  className="block w-full text-xs"
                  style={{ color: 'var(--color-muted)' }}
                />
              </Tooltip>
              {refVideoLoading && (
                <div className="space-y-1" role="status" aria-live="polite">
                  <style>{'@keyframes refvideo-slide{0%{transform:translateX(-100%)}100%{transform:translateX(250%)}}'}</style>
                  <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                    <div className="h-full w-2/5 rounded-full" style={{ background: 'var(--color-primary)', animation: 'refvideo-slide 1.2s ease-in-out infinite' }} />
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                    Uploading and analysing video… {refVideoElapsed}s — still working, this can take up to a minute for longer files.
                  </p>
                </div>
              )}
              {refVideoInfo && (
                <div className="space-y-2">
                  <div className="min-w-0 space-y-1">
                    <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{refVideoFile?.name || refVideoInfo.filename}</p>
                    <p className="text-[10px] line-clamp-4" style={{ color: 'var(--color-muted)' }}>{refVideoInfo.notes}</p>
                  </div>
                  <video ref={refVideoElRef} src={refVideoObjUrl} preload="auto" muted playsInline className="hidden" />
                  <Tooltip text="Animate from a frame of this video instead of generating from text alone. Pick the moment yourself — the very last frame is often a fade to black.">
                    <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                      <input type="checkbox" checked={refSeedOn} onChange={(e) => setRefSeedOn(e.target.checked)} />
                      Start the new clip from a frame of this video
                    </label>
                  </Tooltip>
                  {refSeedOn && (() => {
                    const maxT = Math.max(0, (refVideoInfo.duration || 0) - 0.1);
                    const setT = (t) => setRefSeedTime(Math.min(maxT, Math.max(0, Number(t) || 0)));
                    return (
                      <div className="space-y-2">
                        <div className="flex gap-3 items-start">
                          <div className="w-32 shrink-0 aspect-video rounded-lg border overflow-hidden flex items-center justify-center" style={{ borderColor: 'var(--color-primary)', background: 'var(--color-surface)' }}>
                            {refSeedFrame
                              ? <img src={refSeedFrame} alt={`Frame at ${refSeedTime.toFixed(1)} seconds`} className="w-full h-full object-contain" />
                              : <span className="text-[10px]" style={{ color: 'var(--color-muted)' }}>Loading frame…</span>}
                          </div>
                          <div className="flex-1 min-w-0 space-y-2">
                            <input
                              type="range"
                              min={0}
                              max={maxT}
                              step={0.1}
                              value={Math.min(refSeedTime, maxT)}
                              onChange={(e) => setT(e.target.value)}
                              className="w-full"
                              aria-label="Frame time in seconds"
                            />
                            <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                              <input
                                type="number"
                                min={0}
                                max={maxT}
                                step={0.1}
                                value={Number(refSeedTime.toFixed(1))}
                                onChange={(e) => setT(e.target.value)}
                                className="w-16 px-2 py-1 rounded-lg border text-xs"
                                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                                aria-label="Frame time in seconds"
                              />
                              <span>of {(refVideoInfo.duration || 0).toFixed(1)} s</span>
                              <button type="button" onClick={() => setT(0)} className="px-2 py-1 rounded-lg border transition-opacity hover:opacity-60" style={{ borderColor: 'var(--color-border)' }}>Start</button>
                              <button type="button" onClick={() => setT(maxT - 0.9)} className="px-2 py-1 rounded-lg border transition-opacity hover:opacity-60" style={{ borderColor: 'var(--color-border)' }}>1 s before end</button>
                              <button type="button" onClick={() => setT(maxT)} className="px-2 py-1 rounded-lg border transition-opacity hover:opacity-60" style={{ borderColor: 'var(--color-border)' }}>End</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  <button
                    type="button"
                    onClick={() => handleRefVideoFile(null)}
                    className="text-xs transition-opacity hover:opacity-60"
                    style={{ color: 'var(--color-muted)' }}
                  >
                    Remove reference video
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>YouTube example (optional)</p>
              <div className="flex flex-wrap gap-2">
                <Tooltip text="A YouTube video whose title, transcript, or thumbnail can steer the generated clip's style.">
                  <input
                    type="url"
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=…"
                    className="flex-1 min-w-[200px] px-3 py-2 rounded-xl border text-xs"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </Tooltip>
                <Tooltip text="Fetch the video's title, transcript excerpt, and thumbnail for reference.">
                  <button
                    type="button"
                    onClick={handleLoadYoutube}
                    disabled={youtubeLoading}
                    className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70 disabled:opacity-40"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {youtubeLoading ? 'Loading…' : 'Load'}
                  </button>
                </Tooltip>
              </div>
              {youtubePreview && (
                <div className="space-y-2">
                  <div className="flex gap-3 items-start">
                    <img src={youtubePreview.thumbnailUrl} alt="" className="w-24 rounded-lg border shrink-0" style={{ borderColor: 'var(--color-border)' }} />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{youtubePreview.title}</p>
                      <p className="text-[10px] mt-1" style={{ color: 'var(--color-muted)' }}>
                        {youtubePreview.hasTranscript ? 'Transcript available for style matching' : 'No captions — thumbnail + title used'}
                      </p>
                    </div>
                  </div>
                  {youtubePreview.transcriptExcerpt && (
                    <p className="text-[10px] line-clamp-3" style={{ color: 'var(--color-muted)' }}>{youtubePreview.transcriptExcerpt}</p>
                  )}
                  <Tooltip text="Animate from this video's thumbnail image instead of generating from text alone.">
                    <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                      <input
                        type="checkbox"
                        checked={useYoutubeThumbnailAsSeed}
                        onChange={(e) => setUseYoutubeThumbnailAsSeed(e.target.checked)}
                      />
                      Use YouTube thumbnail as starting frame
                    </label>
                  </Tooltip>
                </div>
              )}
            </div>

            {replicateActive && generateModels.length > 1 && (
              <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <label className="block space-y-1 max-w-xs">
                  <span className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Video model</span>
                  <Tooltip text="Hailuo 2.3 is the default. Seedance 1 Pro adds an end frame, a seed and a locked camera. Run the same brief on both to compare quality and cost.">
                    <select
                      value={videoModel}
                      onChange={(e) => setVideoModel(e.target.value)}
                      className="w-full px-2 py-2 rounded-xl border text-xs"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {generateModels.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                    </select>
                  </Tooltip>
                </label>

                {modelCaps.promptOptimizer && (
                  <Tooltip text="Hailuo rewrites your prompt before rendering. Great for loose ideas; turn it off when you need exact instructions kept, such as 'do not change the cabinet'.">
                    <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                      <input type="checkbox" checked={promptOptimizer} onChange={(e) => setPromptOptimizer(e.target.checked)} />
                      Let Hailuo rewrite my prompt (prompt optimizer)
                    </label>
                  </Tooltip>
                )}

                {modelCaps.endFrame && (
                  <div className="space-y-2">
                    <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>End frame (optional)</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                      The clip finishes on this image. It needs a starting image too: add a Reference image above and set it to animate.
                    </p>
                    <ImageReferenceUpload
                      file={endImageFile}
                      previewUrl={endImagePreview}
                      onFile={(f) => setEndImageFile(f)}
                      onClear={() => setEndImageFile(null)}
                    />
                    {endImageFile && !(seedImageFile || seedImageUrl.trim()) && (
                      <p className="text-xs" style={{ color: '#b45309' }}>Add a starting Reference image above, or the end frame can't be used.</p>
                    )}
                  </div>
                )}

                {(modelCaps.seed || modelCaps.cameraFixed) && (
                  <div className="flex flex-wrap items-end gap-4">
                    {modelCaps.seed && (
                      <label className="block space-y-1">
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Seed (optional)</span>
                        <Tooltip text="Keep the same seed and change the prompt slightly to get a similar result. Leave blank for a fresh random result each time (and different takes).">
                          <input
                            type="number"
                            min={0}
                            max={2147483647}
                            step={1}
                            value={seedValue}
                            onChange={(e) => setSeedValue(e.target.value)}
                            placeholder="random"
                            className="w-40 px-2 py-2 rounded-xl border text-xs"
                            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                          />
                        </Tooltip>
                      </label>
                    )}
                    {modelCaps.cameraFixed && (
                      <Tooltip text="Keep the camera still so only the subject, light or reflections move.">
                        <label className="flex items-center gap-2 text-xs cursor-pointer pb-2" style={{ color: 'var(--color-muted)' }}>
                          <input type="checkbox" checked={cameraFixed} onChange={(e) => setCameraFixed(e.target.checked)} />
                          Camera fixed (no camera movement)
                        </label>
                      </Tooltip>
                    )}
                  </div>
                )}
                {modelCaps.seed && seedValue.trim() !== '' && batchCount > 1 && (
                  <p className="text-xs" style={{ color: '#b45309' }}>With a fixed seed the takes will be near-identical. Clear the seed to get different takes.</p>
                )}
                {modelCaps.seed && (
                  <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                    Seedance renders at 1080p by default, so a clip costs more than Hailuo. Check Replicate's pricing; no price is on file for it here.
                  </p>
                )}
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Style</span>
                <Tooltip text="A visual style hint that steers the expanded video prompt.">
                  <select
                    value={style}
                    onChange={(e) => setStyle(e.target.value)}
                    className="w-full px-2 py-2 rounded-xl border text-xs"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="product b-roll">Product b-roll</option>
                    <option value="abstract motion">Abstract motion</option>
                    <option value="UGC social">UGC / social</option>
                    <option value="cinematic">Cinematic</option>
                  </select>
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Aspect</span>
                <Tooltip text="The frame shape of the generated clip.">
                  <select
                    value={aspect}
                    onChange={(e) => setAspect(e.target.value)}
                    className="w-full px-2 py-2 rounded-xl border text-xs"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="16:9">16:9 landscape</option>
                    <option value="9:16">9:16 story</option>
                    <option value="1:1">1:1 square</option>
                  </select>
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Duration (s)</span>
                <Tooltip text="How many seconds of video to generate — short clips render faster and more reliably.">
                  <input
                    type="number"
                    min={modelCaps.seed ? 2 : 3}
                    max={modelCaps.seed ? 12 : 10}
                    value={durationSec}
                    onChange={(e) => setDurationSec(Number(e.target.value))}
                    className="w-full px-2 py-2 rounded-xl border text-xs"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </Tooltip>
              </label>
            </div>
            <label className="block space-y-1 max-w-xs">
              <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Takes</span>
              <Tooltip text="Render the same clip several times and pick the best. Each take is a separate paid render, so 3 takes cost about 3 times as much as one.">
                <select
                  value={batchCount}
                  onChange={(e) => setBatchCount(Number(e.target.value))}
                  className="w-full px-2 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value={1}>1 take</option>
                  <option value={2}>2 takes</option>
                  <option value={3}>3 takes</option>
                  <option value={4}>4 takes</option>
                </select>
              </Tooltip>
              {batchCount > 1 && (
                <span className="block text-[10px]" style={{ color: '#b45309' }}>
                  {batchCount} separate renders: about {batchCount}× the cost of one clip.
                </span>
              )}
            </label>
            <EndCardToggle
              enabled={ctaOnGenerate}
              setEnabled={setCtaOnGenerate}
              cta={cta}
              setCta={setCta}
              tip="After the clip renders, add a closing screen with your message and button. Done on the server, no extra render cost."
            />
            <Tooltip text="Submit the brief and references to the video model — rendering can take one to three minutes.">
              <button
                type="button"
                disabled={!generateOk}
                onClick={handleGenerate}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {batchCount > 1 ? `Generate ${batchCount} takes` : 'Generate clip'}
              </button>
            </Tooltip>
            {generateResult?.video_prompt && (
              <div className="rounded-xl border p-3 text-xs space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="font-medium" style={{ color: 'var(--color-text)' }}>
                  Model prompt {generateResult.mode === 'image-to-video' ? '(image-to-video)' : '(text-to-video)'}
                </p>
                <p style={{ color: 'var(--color-muted)' }}>{generateResult.video_prompt}</p>
                {generateResult.references?.imageDescription && (
                  <p style={{ color: 'var(--color-muted)' }}><span className="font-medium" style={{ color: 'var(--color-text)' }}>Image style:</span> {generateResult.references.imageDescription}</p>
                )}
                {generateResult.seedUsed != null && (
                  <p style={{ color: 'var(--color-muted)' }}><span className="font-medium" style={{ color: 'var(--color-text)' }}>Seed used:</span> {generateResult.seedUsed}</p>
                )}
                {generateResult.references?.youtube && (
                  <p style={{ color: 'var(--color-muted)' }}><span className="font-medium" style={{ color: 'var(--color-text)' }}>YouTube ref:</span> {generateResult.references.youtube.title}</p>
                )}
                {generateResult.usage && (
                  <p style={{ color: 'var(--color-muted)' }}>
                    <span className="font-medium" style={{ color: 'var(--color-text)' }}>Usage:</span>{' '}
                    {generateResult.usage.promptTokens.toLocaleString()} tokens (prompt){generateResult.usage.videoCostKnown === false ? ' · render cost not priced here (check Replicate)' : ` · ~$${generateResult.usage.totalEstimatedCostUsd.toFixed(3)} estimated total`}
                  </p>
                )}
              </div>
            )}
            <TakesGrid takes={batchTakes} chosen={batchChosen} onChoose={(i) => chooseTake(i)} />
            {resultForTool === 'generate' && (
              <ResultVideo
                blobUrl={resultBlob}
                downloadName={resultName}
                onUse={useResultAsSource}
                {...resultSaveProps}
              />
            )}
            {resultForTool === 'generate' && resultBlob && (
              <LastFramePicker
                videoUrl={resultBlob}
                onUse={(file, t) => {
                  setSeedImageFile(file);
                  setSeedImageUrl('');
                  setSeedImageMode('animate');
                  addToast(`Frame at ${t.toFixed(1)} s is now the Reference image — the next clip will start from it`, 'success');
                  window.scrollTo?.({ top: 0, behavior: 'smooth' });
                }}
              />
            )}
          </section>
        )}

        {tool === 'clip' && (
          <div className="space-y-1.5">
            <input
              type="text"
              placeholder="Paste a direct video file URL — or leave blank and choose a file below"
              value={clipUrl}
              onChange={(e) => setClipUrl(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border text-xs"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            {isClipUrlMode && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                Must be a direct link to the video file itself, not a YouTube/Vimeo/TikTok page — those never serve the raw file at a plain URL.
              </p>
            )}
          </div>
        )}

        {tool !== 'generate' && tool !== 'transcribe-audio' && tool !== 'trim-audio' && tool !== 'isolate-voice' && tool !== 'mix-audio' && tool !== 'saved-library' && tool !== 'join' && tool !== 'overlay' && tool !== 'slideshow' && !(tool === 'caption-studio' && captionLibraryId) && !(tool === 'clip' && isClipUrlMode) && (
          <VideoUpload
            file={sourceFile}
            onFile={(f) => { setSourceFile(f); if (f && tool === 'caption-studio') setCaptionLibraryId(''); }}
            libraryItems={tool === 'caption-studio' ? [] : libraryVideoItems}
            onPickLibrary={tool === 'caption-studio' ? undefined : useLibraryItemAsSource}
          />
        )}

        {previewUrl && tool !== 'generate' && tool !== 'transcribe-audio' && tool !== 'trim-audio' && tool !== 'isolate-voice' && tool !== 'mix-audio' && tool !== 'saved-library' && tool !== 'join' && tool !== 'overlay' && tool !== 'slideshow' && !(tool === 'clip' && isClipUrlMode) && (
          <>
            <video
              ref={tool === 'clip' ? clipVideoRef : undefined}
              src={previewUrl}
              controls
              className="w-full max-h-48 rounded-xl bg-black"
              onLoadedMetadata={tool === 'clip' ? handleClipVideoMeta : undefined}
            />
            {tool === 'clip' && (
              <ClipTimeline
                src={previewUrl}
                videoRef={clipVideoRef}
                duration={clipDuration}
                startSec={startSec}
                endSec={endSec}
                onStartChange={setStartSec}
                onEndChange={handleClipEndChange}
              />
            )}
          </>
        )}

        {tool === 'clip' && (
          <section className="space-y-3">
            <ToolHeader id="clip" label="Clip / trim" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              {isClipUrlMode ? 'Set the in/out range in seconds — the file will be fetched and cut on export.' : 'Drag the timeline markers above, or fine-tune with seconds below.'}
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Start (seconds)</span>
                <Tooltip text="Where the exported clip begins — matches the start marker on the timeline above.">
                  <input type="number" min={0} step={0.1} max={clipDuration || undefined} value={startSec} onChange={(e) => setStartSec(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>End (seconds)</span>
                <Tooltip text="Where the exported clip stops — matches the end marker on the timeline above.">
                  <input type="number" min={0} step={0.1} max={clipDuration || undefined} value={endSec} onChange={(e) => setEndSec(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
              <input type="checkbox" checked={clipKeepOriginal} onChange={(e) => setClipKeepOriginal(e.target.checked)} className="mt-0.5" />
              <span>
                <Tooltip text="Copies the picture and sound exactly as they are, with no re-compression, so quality is identical to your master. The cut can only start on a keyframe, so it may begin a second or two before your Start time.">
                  <span className="font-medium">Keep original quality (no re-encode)</span>
                </Tooltip>
                <span className="block" style={{ color: 'var(--color-muted)' }}>Fastest and lossless. Off = exact cut to the frame, re-saved at very high quality.</span>
              </span>
            </label>
            <Tooltip text={isClipUrlMode ? 'Download the file and cut it to the selected in/out range.' : 'Cut the video down to just the selected in/out range.'}>
              <button
                type="button"
                onClick={() => {
                  if (isClipUrlMode) { runClipFromUrl(); return; }
                  if (!requireFile()) return;
                  const fd = new FormData();
                  fd.append('video', sourceFile);
                  fd.append('startSec', String(startSec));
                  if (endSec !== '') fd.append('endSec', String(endSec));
                  fd.append('keepOriginal', String(clipKeepOriginal));
                  runFormVideo('clip', fd, { label: 'Clipping…', resultFilename: 'clip.mp4', forTool: 'clip' });
                }}
                disabled={!ffmpegOk || (isClipUrlMode && clipUrlLoading)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {isClipUrlMode ? (clipUrlLoading ? 'Clipping…' : 'Download & clip') : 'Export clip'}
              </button>
            </Tooltip>
            {resultForTool === 'clip' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'convert' && (
          <section className="space-y-3">
            <ToolHeader id="convert" label="Convert / compress" onHelp={setHelpTool} getIcon={getIcon} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Quality (CRF 18–35, lower = better)</span>
                <Tooltip text="Controls the quality/file-size trade-off — lower numbers look better but produce larger files.">
                  <input type="number" min={18} max={35} value={crf} onChange={(e) => setCrf(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Max width (optional)</span>
                <Tooltip text="Shrink the video to this width if it's larger, keeping its aspect ratio. Leave blank to keep the original size.">
                  <input type="number" placeholder="1280" value={maxWidth} onChange={(e) => setMaxWidth(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <Tooltip text="Re-encode the video as an H.264 MP4 with these settings.">
              <button type="button" onClick={() => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('crf', String(crf)); if (maxWidth) fd.append('maxWidth', maxWidth); runFormVideo('convert', fd, { label: 'Converting…', resultFilename: 'converted.mp4' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
                Convert
              </button>
            </Tooltip>
            {resultForTool === 'convert' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'extend-ending' && (
          <section className="space-y-3">
            <ToolHeader id="extend-ending" label="Extend ending" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Hold the last picture for a few seconds so the video does not stop dead, and let your music play on and fade out over that time. Choose your video above.
            </p>
            <div className="space-y-1 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Music or audio (recommended)</p>
              <div className="flex flex-wrap items-center gap-2">
                <Tooltip text="Choose the music or audio file that goes with this video (for example the file you used in Mix audio). It plays from the start, carries on through the held frame, and fades out. It replaces the video's own sound.">
                  <button
                    type="button"
                    onClick={() => exAudioInputRef.current?.click()}
                    className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    {exAudio ? 'Change audio file' : 'Choose audio file'}
                  </button>
                </Tooltip>
                {exAudio && (
                  <Tooltip text="Use the video's own sound instead (no audio file).">
                    <button type="button" onClick={() => setExAudio(null)} className="text-[11px] underline hover:opacity-60 transition-opacity" style={{ color: 'var(--color-muted)' }}>Remove</button>
                  </Tooltip>
                )}
                {exAudio && <span className="text-[11px] truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>{exAudio.name} · {formatBytes(exAudio.size)}</span>}
                <input
                  ref={exAudioInputRef}
                  type="file"
                  accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus"
                  className="hidden"
                  onChange={(e) => { setExAudio(e.target.files?.[0] || null); e.target.value = ''; }}
                />
              </div>
              {exAudio && (
                <Tooltip text="Play the audio to check it is the right file.">
                  <audio src={exAudioUrl} controls className="w-full" />
                </Tooltip>
              )}
              <p className="text-[11px]" style={{ color: exAudio ? 'var(--color-muted)' : '#b45309' }}>
                {exAudio
                  ? 'This audio plays from the start of the video, through the held frame, and fades out. It replaces the video\'s own sound. If it is shorter than the video it repeats smoothly.'
                  : 'No audio file chosen: the video\'s own sound is kept, but it ended with the video, so it cannot carry on. It will fade out at the end of the video and the held frame will be silent. Choose your music file to have it play through the held frame.'}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Hold the last frame for (seconds)</span>
                <Tooltip text="How long the final picture stays on screen after the video would have ended. 3 to 8 seconds is usual. If you add a call to action it appears during this time.">
                  <input type="number" min={1} max={30} step={0.5} value={exHold} onChange={(e) => setExHold(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Music fades out over (seconds)</span>
                <Tooltip text={exAudio ? 'How long the fade-out lasts, ending exactly when the video ends. Leave empty to fade over exactly the held time. 0 = no fade.' : 'How long the video\'s own sound takes to fade out, ending where the video itself ends. Leave empty to use the held time. 0 = no fade.'}>
                  <input type="number" min={0} max={60} step={0.5} value={exFade} placeholder={String(exHold)} onChange={(e) => setExFade(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <EndCardToggle
              enabled={ctaOnExtend}
              setEnabled={setCtaOnExtend}
              cta={cta}
              setCta={setCta}
              lockTiming
              label="Show a call to action over the held frame"
              tip="Puts your closing message (headline, button-style label, web address) over the held frame, fading in while the music fades out."
            />
            <Tooltip text="Hold the last frame, carry the music through it with a fade-out, and add the call to action if ticked. Your original files are not changed.">
              <button
                type="button"
                onClick={() => {
                  if (!requireFile()) return;
                  const fd = new FormData();
                  fd.append('video', sourceFile);
                  if (exAudio) fd.append('audio', exAudio);
                  fd.append('holdSec', String(exHold || 4));
                  if (exFade !== '') fd.append('fadeOutSec', String(exFade));
                  if (ctaOnExtend) {
                    if (!ctaHasContent(cta)) { addToast('Add a headline, button text or web address for the call to action, or untick it', 'error'); return; }
                    appendEndCardFields(fd, cta);
                  }
                  runFormVideo('extend-ending', fd, { label: 'Extending the ending…', resultFilename: 'extended.mp4', forTool: 'extend-ending' });
                }}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Extend ending
              </button>
            </Tooltip>
            {resultForTool === 'extend-ending' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'mix-audio' && (
          <section className="space-y-3">
            <ToolHeader id="mix-audio" label="Mix audio" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Combine a voice recording and a piece of music into one audio file. The music sits quietly behind the voice and dips when the voice speaks.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['voice', 'Voice (foreground)', mxVoice, setMxVoice, mxVoiceInputRef, mxVoiceUrl, 'Choose the recording of the spoken voice. This is the main track; the music goes behind it.'],
                ['music', 'Music (background)', mxMusic, setMxMusic, mxMusicInputRef, mxMusicUrl, 'Choose the background music. If it is shorter than the voice it repeats smoothly; if it is longer it is trimmed.'],
              ].map(([key, title, file, setFile, inputRef, url, tip]) => (
                <div key={key} className="space-y-1 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{title}</p>
                  <Tooltip text={tip}>
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                    >
                      {file ? 'Change file' : 'Choose audio file'}
                    </button>
                  </Tooltip>
                  {file && <p className="text-[11px] truncate" style={{ color: 'var(--color-muted)' }}>{file.name} · {formatBytes(file.size)}</p>}
                  <input
                    ref={inputRef}
                    type="file"
                    accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus"
                    className="hidden"
                    onChange={(e) => { setFile(e.target.files?.[0] || null); setResultFromBlob(null, null, null); e.target.value = ''; }}
                  />
                  {file && (
                    <Tooltip text={`Play the ${key} to check it is the right file.`}>
                      <audio src={url} controls className="w-full" />
                    </Tooltip>
                  )}
                </div>
              ))}
            </div>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Music level: {mxMusicPct}% of the voice</span>
              <Tooltip text="How loud the music is next to the voice. About 20 to 40 is a good quiet background; 100 is as loud as the voice.">
                <input type="range" min={5} max={100} step={5} value={mxMusicPct} onChange={(e) => setMxMusicPct(Number(e.target.value))} className="w-full" />
              </Tooltip>
            </label>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Music dips while the voice speaks</span>
              <Tooltip text="Lowers the music automatically whenever someone is talking and brings it back up in the gaps, so the voice always stays clear. Light is gentle; Strong drops the music a lot; Off keeps one steady level.">
                <select value={mxDucking} onChange={(e) => setMxDucking(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="light">Light dip (recommended)</option>
                  <option value="strong">Strong dip</option>
                  <option value="off">Off (steady level)</option>
                </select>
              </Tooltip>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Music starts before the voice (seconds)</span>
                <Tooltip text="Lets the music play on its own for this long before the voice comes in. 0 = the voice starts straight away.">
                  <input type="number" min={0} max={30} step={0.5} value={mxLead} onChange={(e) => setMxLead(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Music carries on after the voice (seconds)</span>
                <Tooltip text="Lets the music play on for this long after the voice finishes, fading out at the end. 0 = it ends when the voice ends.">
                  <input type="number" min={0} max={60} step={0.5} value={mxTail} onChange={(e) => setMxTail(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Save as</span>
              <Tooltip text="MP3 is small and plays everywhere. WAV is uncompressed and large, for further editing.">
                <select value={mxFormat} onChange={(e) => setMxFormat(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="mp3">MP3</option>
                  <option value="wav">WAV (large)</option>
                </select>
              </Tooltip>
            </label>
            <Tooltip text="Mix the voice and the music into one audio file. Your original files are not changed.">
              <button
                type="button"
                onClick={handleMixAudio}
                disabled={!mxVoice || !mxMusic || !ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Mix audio
              </button>
            </Tooltip>
            {resultForTool === 'mix-audio' && resultBlob && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
                <Tooltip text="Listen to the mix to check the levels before you download it. If the music is too loud or quiet, change the music level and mix again.">
                  <audio src={resultBlob} controls className="w-full" />
                </Tooltip>
                <div className="flex flex-wrap gap-2">
                  <Tooltip text="Save the mixed audio to your computer.">
                    <a href={resultBlob} download={resultName} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download {resultName}</a>
                  </Tooltip>
                  <Tooltip text="Open Trim audio with the mix already chosen, to keep a part of it or cut a part out.">
                    <button type="button" onClick={() => sendMixedTo('trim-audio')} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Trim this →</button>
                  </Tooltip>
                  <Tooltip text="Open Audio to transcript with the mix already chosen.">
                    <button type="button" onClick={() => sendMixedTo('transcribe-audio')} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Transcribe this →</button>
                  </Tooltip>
                </div>
              </div>
            )}
          </section>
        )}

        {tool === 'isolate-voice' && (
          <section className="space-y-3">
            <ToolHeader id="isolate-voice" label="Isolate voice" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Choose a recording with background music and get the spoken words back on their own. Your original is not changed.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Choose an audio file: MP3, M4A, WAV, OGG, FLAC and similar.">
                <button
                  type="button"
                  onClick={() => ivInputRef.current?.click()}
                  className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {ivFile ? 'Change file' : 'Choose audio file'}
                </button>
              </Tooltip>
              {ivFile && (
                <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>
                  {ivFile.name} · {formatBytes(ivFile.size)}
                </span>
              )}
              <input
                ref={ivInputRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus"
                className="hidden"
                onChange={(e) => { setIvFile(e.target.files?.[0] || null); setIvResult(null); setIvVoiceUrl(''); setIvMusicUrl(''); e.target.value = ''; }}
              />
            </div>
            {ivFile && (
              <Tooltip text="Play the recording to check it is the right file.">
                <audio src={ivFileUrl} controls className="w-full" />
              </Tooltip>
            )}
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>How</legend>
              <Tooltip text={status?.isolateVoice?.ai
                ? 'An AI model splits the recording into the voice and the music. Best result, and you also get the music-only file. It is billed per run on the server\'s Replicate account (usually a few cents) and can take a minute or two.'
                : 'This option is not set up on this server (it needs the Replicate key). Use the quick filter instead.'}>
                <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)', opacity: status?.isolateVoice?.ai ? 1 : 0.5 }}>
                  <input type="radio" name="ivMode" checked={ivMode === 'ai'} disabled={!status?.isolateVoice?.ai} onChange={() => setIvMode('ai')} className="mt-0.5" />
                  <span>
                    Best quality (AI)
                    <span className="block" style={{ color: 'var(--color-muted)' }}>Separates the voice from the music. Small cost per run; takes a minute or two.</span>
                  </span>
                </label>
              </Tooltip>
              <Tooltip text="Free and fast. It cuts rumble and hiss and lowers steady background noise, so the voice stands out more. It cannot remove music, only turn it down a little.">
                <label className="flex items-start gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                  <input type="radio" name="ivMode" checked={ivMode === 'quick' || !status?.isolateVoice?.ai} onChange={() => setIvMode('quick')} className="mt-0.5" />
                  <span>
                    Quick filter (free)
                    <span className="block" style={{ color: 'var(--color-muted)' }}>Reduces the music but cannot remove it. Good for a light touch-up.</span>
                  </span>
                </label>
              </Tooltip>
            </fieldset>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Works best on speech over instrumental music. If the music has singing, some of it will leak into the voice.
            </p>
            <Tooltip text="Take the voice out of the recording. Your original file is not changed.">
              <button
                type="button"
                onClick={handleIsolateVoice}
                disabled={!ivFile || !ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {ivMode === 'ai' && status?.isolateVoice?.ai ? 'Separate voice from music' : 'Clean up voice'}
              </button>
            </Tooltip>
            {ivResult && ivVoiceUrl && (
              <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
                <div className="space-y-1">
                  <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Voice</p>
                  <Tooltip text="Listen to the voice-only file to check it before you use it.">
                    <audio src={ivVoiceUrl} controls className="w-full" />
                  </Tooltip>
                </div>
                {ivMusicUrl && (
                  <div className="space-y-1">
                    <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Music only</p>
                    <Tooltip text="The background music with the voice taken out, in case you want to keep or reuse it.">
                      <audio src={ivMusicUrl} controls className="w-full" />
                    </Tooltip>
                  </div>
                )}
                {ivResult.mode === 'quick' && (
                  <p className="text-xs" style={{ color: '#b45309' }}>This is the quick filter: some music will still be audible. For a cleaner voice use Best quality (AI).</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Tooltip text="Save the voice-only audio to your computer.">
                    <a href={ivVoiceUrl} download={ivResult.voice.fileName} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download voice</a>
                  </Tooltip>
                  {ivMusicUrl && (
                    <Tooltip text="Save the music-only audio to your computer.">
                      <a href={ivMusicUrl} download={ivResult.music.fileName} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download music</a>
                    </Tooltip>
                  )}
                  <Tooltip text="Open Audio to transcript with this voice file already chosen, so you can write out what is said.">
                    <button type="button" onClick={() => sendVoiceTo('transcribe-audio')} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Transcribe this →</button>
                  </Tooltip>
                  <Tooltip text="Open Trim audio with this voice file already chosen, so you can keep or cut out a part of it.">
                    <button type="button" onClick={() => sendVoiceTo('trim-audio')} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Trim this →</button>
                  </Tooltip>
                </div>
              </div>
            )}
          </section>
        )}

        {tool === 'trim-audio' && (
          <section className="space-y-3">
            <ToolHeader id="trim-audio" label="Trim audio" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Choose an MP3 (or other audio), pick the part you want, and get a new, shorter file. Your original is not changed.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Choose an audio file: MP3, M4A, WAV, OGG, FLAC and similar.">
                <button
                  type="button"
                  onClick={() => taInputRef.current?.click()}
                  className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {taFile ? 'Change file' : 'Choose audio file'}
                </button>
              </Tooltip>
              {taFile && (
                <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>
                  {taFile.name} · {formatBytes(taFile.size)}{taDuration ? ` · ${formatClock(taDuration)} long` : ''}
                </span>
              )}
              <input
                ref={taInputRef}
                type="file"
                accept="audio/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus"
                className="hidden"
                onChange={(e) => { setTaFile(e.target.files?.[0] || null); setTaDuration(0); setTaStart('0:00'); setTaEnd(''); setResultFromBlob(null, null, null); e.target.value = ''; }}
              />
            </div>
            {taFile && (
              <Tooltip text="Play the recording and listen for where the part you want starts and ends. Then press Set start or Set end at that moment.">
                <audio
                  ref={taAudioRef}
                  src={taUrl}
                  controls
                  className="w-full"
                  onLoadedMetadata={(e) => setTaDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
                />
              </Tooltip>
            )}
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>What do you want?</legend>
              {[
                ['keep', 'Keep this part', 'The new file is only the section between your start and end: an extract from the longer recording.'],
                ['remove', 'Cut this part out', 'The section between your start and end is removed, and what is left is joined up into one file.'],
              ].map(([val, label, tip]) => (
                <Tooltip key={val} text={tip}>
                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="radio" name="taMode" checked={taMode === val} onChange={() => setTaMode(val)} />
                    {label}
                  </label>
                </Tooltip>
              ))}
            </fieldset>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="block text-xs" style={{ color: 'var(--color-muted)' }} htmlFor="ta-start">Start</label>
                <Tooltip text="Where the part begins. Type a time like 1:30 or 90 (seconds), or press Set start while the audio is playing.">
                  <input id="ta-start" type="text" value={taStart} onChange={(e) => setTaStart(e.target.value)} placeholder="0:00" className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
                <Tooltip text="Use the point the audio player is at right now as the start.">
                  <button type="button" disabled={!taFile} onClick={() => setTaStart(formatClock(taAudioRef.current?.currentTime || 0))} className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Set start to here</button>
                </Tooltip>
              </div>
              <div className="space-y-1">
                <label className="block text-xs" style={{ color: 'var(--color-muted)' }} htmlFor="ta-end">End</label>
                <Tooltip text="Where the part finishes. Leave empty to go to the end of the recording. Type a time like 2:45 or 165, or press Set end while the audio is playing.">
                  <input id="ta-end" type="text" value={taEnd} onChange={(e) => setTaEnd(e.target.value)} placeholder={taDuration ? formatClock(taDuration) : 'end of recording'} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
                <Tooltip text="Use the point the audio player is at right now as the end.">
                  <button type="button" disabled={!taFile} onClick={() => setTaEnd(formatClock(taAudioRef.current?.currentTime || 0))} className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Set end to here</button>
                </Tooltip>
              </div>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Fade in (seconds)</span>
                <Tooltip text="Starts the result quietly and brings the volume up over this many seconds. 0 = no fade. Uses MP3 output.">
                  <input type="number" min={0} max={10} step={0.5} value={taFadeIn} onChange={(e) => setTaFadeIn(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Fade out (seconds)</span>
                <Tooltip text="Fades the volume down to silence over the last few seconds, so it does not stop abruptly. 0 = no fade. Uses MP3 output.">
                  <input type="number" min={0} max={10} step={0.5} value={taFadeOut} onChange={(e) => setTaFadeOut(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Save as</span>
              <Tooltip text="Same file type is fastest and keeps the sound exactly as it was (no re-compression), but it cannot do fades or cut a middle section out; those make an MP3. Choose MP3 or WAV to force a type.">
                <select value={taFormat} onChange={(e) => setTaFormat(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="original">Same type as the original (no quality loss)</option>
                  <option value="mp3">MP3 (192 kbps)</option>
                  <option value="wav">WAV (uncompressed, large)</option>
                </select>
              </Tooltip>
            </label>
            <Tooltip text="Make the new, shorter audio file. Your original file is not changed.">
              <button
                type="button"
                onClick={handleTrimAudio}
                disabled={!taFile || !ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Trim audio
              </button>
            </Tooltip>
            {resultForTool === 'trim-audio' && resultBlob && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
                <Tooltip text="Listen to the new file to check it before you download it.">
                  <audio src={resultBlob} controls className="w-full" />
                </Tooltip>
                <div className="flex flex-wrap gap-2">
                  <Tooltip text="Save the new audio file to your computer.">
                    <a href={resultBlob} download={resultName} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download {resultName}</a>
                  </Tooltip>
                  <Tooltip text="Open Audio to transcript with this new file already chosen, so you can write out what is said.">
                    <button type="button" onClick={useTrimmedForTranscript} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Transcribe this →</button>
                  </Tooltip>
                </div>
              </div>
            )}
          </section>
        )}

        {tool === 'extract-audio' && (
          <section className="space-y-3">
            <ToolHeader id="extract-audio" label="Extract audio" onHelp={setHelpTool} getIcon={getIcon} />
            <Tooltip text="Pull the soundtrack out of the video and download it as an MP3 file.">
              <button type="button" onClick={async () => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('format', 'mp3'); await runFormVideo('extract-audio', fd, { label: 'Extracting audio…', resultFilename: 'audio.mp3' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
                Export MP3
              </button>
            </Tooltip>
            {resultForTool === 'extract-audio' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} />
            )}
          </section>
        )}

        {tool === 'transcribe-audio' && (
          <section className="space-y-3">
            <ToolHeader id="transcribe-audio" label="Audio → transcript" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Choose a recording (audio or video) and get the words back as text you can correct, copy or download. Wrote the words yourself? Use &quot;I have a script&quot; below.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip text="Choose an audio file (MP3, M4A, WAV, OGG, FLAC) or a video file (MP4, MOV). A video file lets you put the captions straight onto it afterwards.">
                <button
                  type="button"
                  onClick={() => trInputRef.current?.click()}
                  className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  {trAudioFile ? 'Change file' : 'Choose audio or video file'}
                </button>
              </Tooltip>
              {trAudioFile && (
                <span className="text-xs truncate max-w-xs" style={{ color: 'var(--color-muted)' }}>
                  {trAudioFile.name} · {formatBytes(trAudioFile.size)}
                </span>
              )}
              <input
                ref={trInputRef}
                type="file"
                accept="audio/*,video/*,.mp3,.m4a,.wav,.ogg,.flac,.aac,.opus,.mp4,.mov,.mkv,.m4v"
                className="hidden"
                onChange={(e) => { setTrAudioFile(e.target.files?.[0] || null); setTrText(''); setTrSrt(''); setTrNote(''); e.target.value = ''; }}
              />
            </div>
            {trAudioFile && (
              <Tooltip text="Play it to check it is the right file before you transcribe.">
                {trIsVideo
                  ? <video src={trAudioUrl} controls className="w-full max-h-48 rounded-xl bg-black" />
                  : <audio src={trAudioUrl} controls className="w-full" />}
              </Tooltip>
            )}
            <fieldset className="space-y-1">
              <legend className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Result</legend>
              {[
                ['text', 'Plain transcript', 'Just the words, in paragraphs. Best for reading, notes and articles.'],
                ['srt', 'With timestamps (SRT)', 'Short lines with start and end times. Needed if you want the words shown along the bottom of a video (Caption studio). A plain-text copy is shown too.'],
              ].map(([val, label, tip]) => (
                <Tooltip key={val} text={tip}>
                  <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="radio" name="trFormat" checked={trFormat === val} onChange={() => setTrFormat(val)} />
                    {label}
                  </label>
                </Tooltip>
              ))}
            </fieldset>
            <Tooltip text="Listen to the recording and write out what is said.">
              <button
                type="button"
                onClick={handleTranscribeAudio}
                disabled={!trAudioFile || !ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Transcribe
              </button>
            </Tooltip>
            <ScriptTimer
              file={trAudioFile}
              onTimed={(d) => {
                setTrSrt(d.srt);
                setTrText(srtLines(d.srt));
                setTrNote('');
                addToast(d.method === 'speech' ? 'Script timed to the recording' : 'Script spread evenly over the recording', d.method === 'speech' ? 'success' : 'info');
              }}
            />
            {(trText || trSrt) && (
              <div className="space-y-2">
                {trNote && <p className="text-xs" style={{ color: '#b45309' }}>{trNote}</p>}
                {!trSrt && (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    This text has no times. That is fine: when you put it on a video, Vault listens to the recording and shows each line as it is spoken.
                  </p>
                )}
                {trSrt && (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    Fix any words below, one line per caption. Keep the same number of lines so each caption keeps its timing.
                  </p>
                )}
                <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Transcript (you can edit it)</p>
                <Tooltip text="The written-out words. Click in and fix any mistakes before you copy or download; your edits are what get copied or saved as .txt.">
                  <textarea
                    value={trText}
                    onChange={(e) => setTrText(e.target.value)}
                    rows={14}
                    aria-label="Transcript"
                    className="w-full px-3 py-2 rounded-xl border text-sm"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  />
                </Tooltip>
                <div className="flex flex-wrap gap-2">
                  <Tooltip text="Copy the transcript above (including your edits) to the clipboard.">
                    <button type="button" onClick={copyTranscript} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Copy text</button>
                  </Tooltip>
                  <Tooltip text="Save the transcript above as a plain text file, named after your audio file.">
                    <button type="button" onClick={() => downloadTranscript('txt')} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download .txt</button>
                  </Tooltip>
                  {(trSrt || trText.trim()) && (
                    <Tooltip text="Already have a video? Opens Caption studio with these captions (including your corrections) so you can choose it and burn them along the bottom. No video? Use Make a video below instead.">
                      <button type="button" onClick={useTranscriptAsCaptions} className="px-3 py-2 rounded-xl text-xs font-medium text-white transition-opacity hover:opacity-80" style={{ background: 'var(--color-primary)' }}>Add as captions on a video →</button>
                    </Tooltip>
                  )}
                  {trSrt && (
                    <Tooltip text="Save the timestamped version as a subtitle (.srt) file, including your corrections, to use in any video editor or player.">
                      <button type="button" onClick={() => downloadTranscript('srt')} className="px-3 py-2 rounded-xl text-xs font-medium border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Download .srt (timestamps)</button>
                    </Tooltip>
                  )}
                </div>
                {(trSrt || trText.trim()) && (
                  <div className="space-y-3 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <div>
                      <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{trIsVideo ? 'Put the transcript on your video' : 'Make a video with the transcript on it'}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {trIsVideo
                          ? 'The words are shown along the bottom of your video as it plays. Your corrections above are included.'
                          : trAudioFile
                            ? 'This makes a video from your audio: a plain coloured screen with the words shown along the bottom as it plays. Your corrections above are included.'
                            : 'Choose your audio or video file at the top first. A video gets the words put on it; audio gets a plain coloured screen made for it.'}
                      </p>
                    </div>
                    {!trIsVideo && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block space-y-1">
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Video shape</span>
                        <Tooltip text="Landscape for YouTube and screens, portrait for Reels/TikTok/Shorts, square or 4:5 for feeds.">
                          <select value={avAspect} onChange={(e) => setAvAspect(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            <option value="16:9">Landscape 16:9</option>
                            <option value="9:16">Portrait 9:16</option>
                            <option value="1:1">Square 1:1</option>
                            <option value="4:5">Portrait 4:5</option>
                          </select>
                        </Tooltip>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Screen colour</span>
                        <Tooltip text="The colour of the whole video screen behind the words. Pick something that contrasts with your text colour.">
                          <input type="color" value={avCanvasColor} onChange={(e) => setAvCanvasColor(e.target.value)} className="w-full h-9 rounded-xl border cursor-pointer" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }} />
                        </Tooltip>
                      </label>
                    </div>
                    )}
                    <p className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>The words</p>
                    <TextStyleFields
                      fontFamily={textFontFamily} setFontFamily={setTextFontFamily}
                      fontSize={textFontSize} setFontSize={setTextFontSize}
                      fontColor={textFontColor} setFontColor={setTextFontColor}
                      fontWeight={textFontWeight} setFontWeight={setTextFontWeight}
                      backgroundColor={textBackgroundColor} setBackgroundColor={setTextBackgroundColor}
                      backgroundTransparent={textBackgroundTransparent} setBackgroundTransparent={setTextBackgroundTransparent}
                    />
                    <Tooltip text={trIsVideo ? 'Put the transcript along the bottom of your video, in sync. The picture and sound are kept; long videos take a while.' : 'Build the video: your audio on a coloured screen, with the transcript shown along the bottom in sync. Long recordings take a while.'}>
                      <button
                        type="button"
                        onClick={makeTranscriptVideo}
                        disabled={!ffmpegOk || !trAudioFile}
                        className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                        style={{ background: 'var(--color-primary)' }}
                      >
                        {trIsVideo ? 'Add captions to the video' : 'Make video'}
                      </button>
                    </Tooltip>
                    {resultForTool === 'transcribe-audio' && (
                      <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
                    )}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {tool === 'audio' && (
          <section className="space-y-3">
            <ToolHeader id="audio" label="Mute / replace audio" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Strip the soundtrack, or replace it with a music / voice file. Replace uses the shorter of video and audio length.
            </p>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'mute', label: 'Mute', tip: 'Remove the existing soundtrack entirely, leaving a silent video.' },
                { id: 'replace', label: 'Replace audio', tip: 'Swap the existing soundtrack for a different audio file you upload.' },
              ].map((m) => (
                <Tooltip key={m.id} text={m.tip}>
                  <button
                    type="button"
                    onClick={() => setAudioMode(m.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                    style={{
                      borderColor: audioMode === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                      color: audioMode === m.id ? 'var(--color-primary)' : 'var(--color-text)',
                      background: 'var(--color-bg)',
                    }}
                  >
                    {m.label}
                  </button>
                </Tooltip>
              ))}
            </div>
            {audioMode === 'replace' && (
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Audio file (mp3 / wav / m4a)</span>
                <Tooltip text="The music or voice track to use as the new soundtrack — the shorter of video/audio length wins.">
                  <input
                    type="file"
                    accept="audio/*,.mp3,.wav,.m4a,.aac"
                    onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                    className="block w-full text-xs"
                    style={{ color: 'var(--color-text)' }}
                  />
                </Tooltip>
                {audioFile && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{audioFile.name}</span>}
              </label>
            )}
            <Tooltip text={audioMode === 'mute' ? 'Strip the soundtrack from the video.' : 'Replace the soundtrack with the uploaded audio file.'}>
              <button
                type="button"
                onClick={() => {
                  if (!requireFile()) return;
                  if (audioMode === 'replace' && !audioFile) {
                    addToast('Choose an audio file to replace with', 'error');
                    return;
                  }
                  const fd = new FormData();
                  fd.append('video', sourceFile);
                  fd.append('mode', audioMode);
                  if (audioMode === 'replace') fd.append('audio', audioFile);
                  runFormVideo('audio', fd, {
                    label: audioMode === 'mute' ? 'Muting…' : 'Replacing audio…',
                    resultFilename: audioMode === 'mute' ? 'muted.mp4' : 'audio-replaced.mp4',
                    forTool: 'audio',
                  });
                }}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                {audioMode === 'mute' ? 'Mute video' : 'Replace audio'}
              </button>
            </Tooltip>
            {resultForTool === 'audio' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'normalize' && (
          <section className="space-y-3">
            <ToolHeader id="normalize" label="Normalize audio" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Evens out volume so quiet and loud moments sit at a consistent, comfortable level. One click — no manual levels to set.
            </p>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Target loudness</span>
              <Tooltip text="Quiet suits podcasts/voice, Normal suits most social clips, Loud pushes closer to broadcast/streaming levels.">
                <select
                  value={normalizePreset}
                  onChange={(e) => setNormalizePreset(e.target.value)}
                  className="w-full px-2 py-2 rounded-xl border text-xs"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                >
                  <option value="quiet">Quiet</option>
                  <option value="normal">Normal</option>
                  <option value="loud">Loud</option>
                </select>
              </Tooltip>
            </label>
            <Tooltip text="Re-encode the audio track to the selected loudness target; video is copied unchanged when possible.">
              <button
                type="button"
                onClick={() => {
                  if (!requireFile()) return;
                  const fd = new FormData();
                  fd.append('video', sourceFile);
                  fd.append('preset', normalizePreset);
                  runFormVideo('normalize', fd, { label: 'Normalizing audio…', resultFilename: 'normalized.mp4', forTool: 'normalize' });
                }}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Normalize volume
              </button>
            </Tooltip>
            {resultForTool === 'normalize' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'togif' && (
          <section className="space-y-3">
            <ToolHeader id="togif" label="Video → GIF" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Exports a short looping GIF using ffmpeg's two-pass palette technique for cleaner colour than a naive conversion.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Frame rate (10–20 typical)</span>
                <Tooltip text="Higher looks smoother but makes a larger file. 10-20 fps is the usual sweet spot for GIFs.">
                  <input type="number" min={1} max={30} value={gifFps} onChange={(e) => setGifFps(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Max width (px)</span>
                <Tooltip text="The GIF is scaled to this width, keeping its original aspect ratio. Smaller widths make smaller files.">
                  <input type="number" min={80} max={1280} value={gifWidth} onChange={(e) => setGifWidth(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Start (seconds)</span>
                <Tooltip text="Where in the source video the GIF should start.">
                  <input type="number" min={0} step={0.1} value={gifStartSec} onChange={(e) => setGifStartSec(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>End (seconds, optional)</span>
                <Tooltip text="Where the GIF should stop. Leave blank to use the rest of the video — keep GIFs short (a few seconds).">
                  <input type="number" min={0} step={0.1} placeholder="end of video" value={gifEndSec} onChange={(e) => setGifEndSec(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <Tooltip text="Builds an optimized colour palette from this clip, then encodes the GIF using it — two ffmpeg passes for cleaner colour.">
              <button
                type="button"
                onClick={handleToGif}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Create GIF
              </button>
            </Tooltip>
            {gifBlobUrl && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
                <img src={gifBlobUrl} alt="Generated GIF" className="max-w-full rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />
                <div className="flex flex-wrap gap-2">
                  <a href={gifBlobUrl} download="output.gif" className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80" style={{ background: 'var(--color-primary)' }}>
                    Download GIF
                  </a>
                  <Tooltip text="Store this GIF in your Saved media library.">
                    <button type="button" onClick={handleSaveGif} className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>
                      Save to library
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
          </section>
        )}

        {tool === 'export-social' && (
          <section className="space-y-3">
            <ToolHeader id="export-social" label="Export for Social" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              One video in, one MP4 per selected preset out. Reels/TikTok/Shorts trims from the start when the source is longer than 60s; Square and Landscape keep the full length. All presets share the same crop focus.
            </p>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Presets</span>
                <Tooltip text="Tick or untick every preset in one click.">
                  <button
                    type="button"
                    onClick={() => setExportPresets((prev) => (
                      prev.length === SOCIAL_EXPORT_PRESETS.length ? [] : SOCIAL_EXPORT_PRESETS.map((p) => p.id)
                    ))}
                    className="text-xs transition-opacity hover:opacity-70"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {exportPresets.length === SOCIAL_EXPORT_PRESETS.length ? 'Deselect all' : 'Select all'}
                  </button>
                </Tooltip>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                {SOCIAL_EXPORT_PRESETS.map((p) => (
                  <label
                    key={p.id}
                    className="flex items-start gap-2 text-xs rounded-xl border p-3 cursor-pointer"
                    style={{
                      borderColor: exportPresets.includes(p.id) ? 'var(--color-primary)' : 'var(--color-border)',
                      background: 'var(--color-bg)',
                    }}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={exportPresets.includes(p.id)}
                      onChange={(e) => setExportPresets((prev) => (
                        e.target.checked ? [...prev, p.id] : prev.filter((id) => id !== p.id)
                      ))}
                    />
                    <span>
                      <span className="block font-medium" style={{ color: 'var(--color-text)' }}>{p.label}</span>
                      <span className="block mt-0.5" style={{ color: 'var(--color-muted)' }}>{p.desc}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Crop focus (shared across presets)</span>
              <Tooltip text="When a preset's aspect ratio is narrower or wider than the source, this picks which part of the frame stays in view.">
                <select value={exportFocus} onChange={(e) => setExportFocus(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  <option value="center">Centre</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </Tooltip>
            </label>
            <Tooltip text="Renders every ticked preset — this can take a while for longer videos or several presets.">
              <button
                type="button"
                onClick={handleExportSocial}
                disabled={!ffmpegOk || !exportPresets.length}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Export {exportPresets.length || 0} preset{exportPresets.length === 1 ? '' : 's'}
              </button>
            </Tooltip>

            {exportItems.length > 0 && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Results</p>
                  <Tooltip text="Download every rendered preset together in one .zip file.">
                    <button
                      type="button"
                      onClick={downloadExportZip}
                      className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80"
                      style={{ background: 'var(--color-primary)' }}
                    >
                      Download all (zip)
                    </button>
                  </Tooltip>
                </div>
                <ul className="space-y-2">
                  {exportItems.map((item) => (
                    <li key={item.presetId} className="flex items-center gap-3 rounded-lg border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                      {item.thumbnailDataUrl && (
                        <img src={item.thumbnailDataUrl} alt="" className="w-14 h-14 object-cover rounded-lg border shrink-0" style={{ borderColor: 'var(--color-border)' }} />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.label}</p>
                        <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>{item.aspect} · {item.width}×{item.height} · {formatBytes(item.bytes)}</p>
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        <Tooltip text="Download just this preset's MP4.">
                          <button type="button" onClick={() => downloadExportFile(item)} className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            Download
                          </button>
                        </Tooltip>
                        <Tooltip text="Store this preset's video in your Saved media library.">
                          <button type="button" onClick={() => saveExportItemToLibrary(item)} className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70" style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}>
                            Save
                          </button>
                        </Tooltip>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        {tool === 'reframe' && (
          <section className="space-y-3">
            <ToolHeader id="reframe" label="Crop / reframe" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Fit video to a social aspect ratio. Crop fills the frame (may trim edges); pad letterboxes without cutting.
            </p>
            <div className="flex flex-wrap gap-2">
              {['9:16', '16:9', '1:1', '4:5'].map((a) => (
                <Tooltip key={a} text={`Target frame shape: ${a}.`}>
                  <button
                    type="button"
                    onClick={() => setReframeAspect(a)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                    style={{
                      borderColor: reframeAspect === a ? 'var(--color-primary)' : 'var(--color-border)',
                      color: reframeAspect === a ? 'var(--color-primary)' : 'var(--color-text)',
                      background: 'var(--color-bg)',
                    }}
                  >
                    {a}{a === '9:16' ? ' · Reels' : a === '1:1' ? ' · Square' : ''}
                  </button>
                </Tooltip>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {[
                { id: 'crop', label: 'Crop (fill)', tip: 'Fill the whole new frame, trimming edges of the video that don\'t fit.' },
                { id: 'pad', label: 'Pad (letterbox)', tip: 'Keep the entire original frame, adding black bars instead of cropping.' },
              ].map((m) => (
                <Tooltip key={m.id} text={m.tip}>
                  <button
                    type="button"
                    onClick={() => setReframeMode(m.id)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                    style={{
                      borderColor: reframeMode === m.id ? 'var(--color-primary)' : 'var(--color-border)',
                      color: reframeMode === m.id ? 'var(--color-primary)' : 'var(--color-text)',
                      background: 'var(--color-bg)',
                    }}
                  >
                    {m.label}
                  </button>
                </Tooltip>
              ))}
            </div>
            {reframeMode === 'crop' && (
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Crop focus</span>
                <Tooltip text="Which part of the original frame to keep centred when cropping to the new shape.">
                  <select value={reframeFocus} onChange={(e) => setReframeFocus(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="center">Centre</option>
                    <option value="top">Top</option>
                    <option value="bottom">Bottom</option>
                    <option value="left">Left</option>
                    <option value="right">Right</option>
                  </select>
                </Tooltip>
              </label>
            )}
            <Tooltip text="Render the video at the chosen aspect ratio and crop/pad mode.">
              <button
                type="button"
                onClick={() => {
                  if (!requireFile()) return;
                  const fd = new FormData();
                  fd.append('video', sourceFile);
                  fd.append('aspect', reframeAspect);
                  fd.append('mode', reframeMode);
                  fd.append('focus', reframeFocus);
                  runFormVideo('reframe', fd, { label: 'Reframing…', resultFilename: `reframed-${reframeAspect.replace(':', 'x')}.mp4`, forTool: 'reframe' });
                }}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Reframe to {reframeAspect}
              </button>
            </Tooltip>
            {resultForTool === 'reframe' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'speed' && (
          <section className="space-y-3">
            <ToolHeader id="speed" label="Speed" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Change playback speed from 0.25× (slow-mo) to 4×. Audio tempo follows when a soundtrack is present.
            </p>
            <div className="flex flex-wrap gap-2">
              {['0.5', '0.75', '1.25', '1.5', '2', '3'].map((s) => (
                <Tooltip key={s} text={Number(s) < 1 ? `Slow the video down to ${s}× its original speed.` : `Speed the video up to ${s}× its original speed.`}>
                  <button
                    type="button"
                    onClick={() => setSpeedFactor(s)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium border transition-opacity hover:opacity-70"
                    style={{
                      borderColor: speedFactor === s ? 'var(--color-primary)' : 'var(--color-border)',
                      color: speedFactor === s ? 'var(--color-primary)' : 'var(--color-text)',
                      background: 'var(--color-bg)',
                    }}
                  >
                    {s}×
                  </button>
                </Tooltip>
              ))}
            </div>
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Custom speed (0.25–4)</span>
              <Tooltip text="How fast the video plays back — audio pitch and tempo adjust to match.">
                <input type="number" min={0.25} max={4} step={0.05} value={speedFactor} onChange={(e) => setSpeedFactor(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </Tooltip>
            </label>
            <Tooltip text="Re-encode the video at the chosen speed.">
              <button
                type="button"
                onClick={() => {
                  if (!requireFile()) return;
                  const s = Number(speedFactor);
                  if (!Number.isFinite(s) || s < 0.25 || s > 4) {
                    addToast('Speed must be between 0.25 and 4', 'error');
                    return;
                  }
                  const fd = new FormData();
                  fd.append('video', sourceFile);
                  fd.append('speed', String(s));
                  runFormVideo('speed', fd, { label: `Applying ${s}× speed…`, resultFilename: `speed-${s}x.mp4`, forTool: 'speed' });
                }}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Apply {speedFactor || '?'}×
              </button>
            </Tooltip>
            {resultForTool === 'speed' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'annotate' && (
          <section className="space-y-3">
            <ToolHeader id="annotate" label="Annotate" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Burn a styled text label into the full clip. The preview below appears only after you apply.</p>
            <Tooltip text="The text that gets burned into the video frame.">
              <VoiceInput value={overlayText} onChange={setOverlayText} placeholder="Label text" label="Label text" />
            </Tooltip>
            <PositionGrid value={textPosition} onChange={setTextPosition} label="Label position" />
            <TextStyleFields
              fontFamily={textFontFamily}
              setFontFamily={setTextFontFamily}
              fontSize={textFontSize}
              setFontSize={setTextFontSize}
              fontColor={textFontColor}
              setFontColor={setTextFontColor}
              fontWeight={textFontWeight}
              setFontWeight={setTextFontWeight}
              backgroundColor={textBackgroundColor}
              setBackgroundColor={setTextBackgroundColor}
              backgroundTransparent={textBackgroundTransparent}
              setBackgroundTransparent={setTextBackgroundTransparent}
            />
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Fade in (seconds)</span>
                <Tooltip text="Label starts invisible and eases in over this many seconds. 0 = appears instantly (default).">
                  <input type="number" min={0} max={30} step={0.1} value={fadeInSec} onChange={(e) => setFadeInSec(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Fade out (seconds)</span>
                <Tooltip text="Label eases out over this many seconds before the clip ends. 0 = disappears instantly (default).">
                  <input type="number" min={0} max={30} step={0.1} value={fadeOutSec} onChange={(e) => setFadeOutSec(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <EndCardToggle
              enabled={ctaOnAnnotate}
              setEnabled={setCtaOnAnnotate}
              cta={cta}
              setCta={setCta}
              tip="After the label is burned in, finish the video with a closing screen carrying your message and button."
            />
            <Tooltip text="Burn the styled text label into the video permanently.">
              <button type="button" onClick={() => { if (!requireFile() || !overlayText.trim()) return; if (ctaOnAnnotate && !ctaHasContent(cta)) { addToast('Add a headline, button text or web address for the call to action', 'error'); return; } const fd = new FormData(); fd.append('video', sourceFile); fd.append('text', overlayText); appendTextStyleFields(fd); if (Number(fadeInSec) > 0) fd.append('fadeInSec', String(fadeInSec)); if (Number(fadeOutSec) > 0) fd.append('fadeOutSec', String(fadeOutSec)); if (ctaOnAnnotate) appendEndCardFields(fd, cta); runFormVideo('annotate', fd, { label: ctaOnAnnotate ? 'Annotating and adding call to action…' : 'Annotating…', resultFilename: 'annotated.mp4', forTool: 'annotate' }); }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
                Apply label
              </button>
            </Tooltip>
            {resultForTool === 'annotate' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'end-card' && (
          <section className="space-y-3">
            <ToolHeader id="end-card" label="Call to action" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Add a closing screen to the end of your video. The preview below appears only after you apply.</p>
            <EndCardFields cta={cta} setCta={setCta} />
            <Tooltip text="Append the closing screen to the end of the video.">
              <button
                type="button"
                onClick={() => {
                  if (!requireFile()) return;
                  if (!ctaHasContent(cta)) { addToast('Add a headline, button text or web address', 'error'); return; }
                  const fd = endCardFormData(sourceFile, cta);
                  runFormVideo('end-card', fd, { label: 'Adding call to action…', resultFilename: 'with-call-to-action.mp4', forTool: 'end-card' });
                }}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Add call to action
              </button>
            </Tooltip>
            {resultForTool === 'end-card' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'overlay' && (
          <section className="space-y-3">
            <ToolHeader id="overlay" label="Overlay / watermark" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Place a logo or image on top of the video. PNG with transparency works best.
            </p>
            <VideoUpload file={sourceFile} onFile={setSourceFile} label="Video" libraryItems={libraryVideoItems} onPickLibrary={useLibraryItemAsSource} />
            {previewUrl && (
              <video src={previewUrl} controls className="w-full max-h-48 rounded-xl bg-black" />
            )}
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Overlay image (PNG / JPG)</span>
              <Tooltip text="The logo or image to place on top of the video — a transparent PNG blends in most cleanly.">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                  onChange={(e) => setOverlayImageFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs"
                  style={{ color: 'var(--color-text)' }}
                />
              </Tooltip>
              {overlayImageFile && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{overlayImageFile.name}</span>}
            </label>
            <PositionGrid value={overlayPosition} onChange={setOverlayPosition} label="Overlay position" />
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Size (% of video width)</span>
                <Tooltip text="How large the overlay image renders, as a percentage of the video's width.">
                  <input type="number" min={5} max={80} value={overlayScale} onChange={(e) => setOverlayScale(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Opacity (0.05–1)</span>
                <Tooltip text="How see-through the overlay is — lower values blend it more subtly into the video.">
                  <input type="number" min={0.05} max={1} step={0.05} value={overlayOpacity} onChange={(e) => setOverlayOpacity(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
            </div>
            <EndCardToggle
              enabled={ctaOnOverlay}
              setEnabled={setCtaOnOverlay}
              cta={cta}
              setCta={setCta}
              tip="After the overlay is applied, finish the video with a closing screen carrying your message and button."
            />
            <Tooltip text="Burn the overlay image onto the video at the chosen position, size, and opacity.">
              <button
                type="button"
                onClick={() => {
                  if (!requireFile()) return;
                  if (!overlayImageFile) {
                    addToast('Choose an overlay image', 'error');
                    return;
                  }
                  const fd = new FormData();
                  fd.append('video', sourceFile);
                  fd.append('image', overlayImageFile);
                  fd.append('position', overlayPosition);
                  fd.append('scalePct', String(overlayScale));
                  fd.append('opacity', String(overlayOpacity));
                  if (ctaOnOverlay) {
                    if (!ctaHasContent(cta)) { addToast('Add a headline, button text or web address for the call to action', 'error'); return; }
                    appendEndCardFields(fd, cta);
                  }
                  runFormVideo('overlay', fd, { label: ctaOnOverlay ? 'Applying overlay and adding call to action…' : 'Applying overlay…', resultFilename: 'overlay.mp4', forTool: 'overlay' });
                }}
                disabled={!ffmpegOk}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Apply overlay
              </button>
            </Tooltip>
            {resultForTool === 'overlay' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'join' && (
          <section className="space-y-3">
            <ToolHeader id="join" label="Join videos" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Join two or more clips into one MP4, with a transition between each pair (crossfade, dip to black or white, wipe, slide) and optional effects on each clip (trim, speed, brightness, colour look, fades, volume). Clips are normalized to a common size and frame rate so mixed formats still join cleanly. Order in the list is the play order.
            </p>
            <MultiVideoUpload files={joinFiles} onFiles={setJoinFiles} />
            <JoinPlanner files={joinFiles} plan={joinPlan} onPlan={setJoinPlan} />
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Max width (output)</span>
                <Tooltip text="All clips are normalized to this width before joining, so mixed resolutions still match.">
                  <input type="number" min={320} max={3840} step={2} value={joinMaxWidth} onChange={(e) => setJoinMaxWidth(e.target.value)} placeholder="Original size" className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Quality (CRF 18–35)</span>
                <Tooltip text="Controls the quality/file-size trade-off for the joined output — lower numbers look better but produce larger files.">
                  <input type="number" min={18} max={35} value={joinCrf} onChange={(e) => setJoinCrf(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              {!joinPlan && (
              <label className="block space-y-1 col-span-2">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Crossfade (seconds) — 0 = hard cut</span>
                <Tooltip text="Blend this many seconds between consecutive clips instead of cutting straight to the next one.">
                  <input type="number" min={0} max={5} step={0.1} value={joinCrossfade} onChange={(e) => setJoinCrossfade(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              )}
            </div>
            <EndCardToggle
              enabled={ctaOnJoin}
              setEnabled={setCtaOnJoin}
              cta={cta}
              setCta={setCta}
              tip="Finish the joined video with a closing screen carrying your message and button."
            />
            <Tooltip text="Normalize and concatenate the clips in the order shown above into one MP4.">
              <button
                type="button"
                onClick={() => {
                  if (joinFiles.length < 2) {
                    addToast('Add at least two videos to join', 'error');
                    return;
                  }
                  const fd = new FormData();
                  joinFiles.forEach((f) => fd.append('videos', f));
                  if (joinMaxWidth) fd.append('maxWidth', String(joinMaxWidth));
                  fd.append('crf', String(joinCrf));
                  const planned = joinPlan
                    ? (joinPlan.joins || []).some((j) => j.type !== 'cut') || (joinPlan.clips || []).some((c) => c && Object.keys(c).length > 0)
                    : false;
                  const xf = joinPlan ? 0 : (Number(joinCrossfade) || 0);
                  if (joinPlan) fd.append('plan', JSON.stringify(joinPlan));
                  else if (xf > 0) fd.append('crossfadeSec', String(xf));
                  if (ctaOnJoin) {
                    if (!ctaHasContent(cta)) { addToast('Add a headline, button text or web address for the call to action', 'error'); return; }
                    appendEndCardFields(fd, cta);
                  }
                  runFormVideo('join', fd, {
                    label: ctaOnJoin ? 'Joining and adding call to action…' : planned ? 'Joining with your transitions and effects…' : xf > 0 ? 'Joining with crossfade…' : 'Joining videos…',
                    resultFilename: 'joined.mp4',
                    forTool: 'join',
                  });
                }}
                disabled={!ffmpegOk || joinFiles.length < 2}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Join {joinFiles.length || 0} clips{joinPlan ? ` · ${describePlan(joinPlan)}` : (Number(joinCrossfade) > 0 ? ` · ${joinCrossfade}s fade` : '')}
              </button>
            </Tooltip>
            {resultForTool === 'join' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'slideshow' && (
          <section className="space-y-3">
            <ToolHeader id="slideshow" label="Slideshow" onHelp={setHelpTool} getIcon={getIcon} />
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Turn product photos or other images into a promo video with background music — each image gets the same fitted aspect, one shared duration per slide.
            </p>
            <MultiImageUpload files={slideImages} onFiles={setSlideImages} />
            <SlideshowPlanner files={slideImages} hasAudio={Boolean(slideAudioFile)} plan={slidePlan} onPlan={setSlidePlan} />
            {!slidePlan && (
            <>
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Seconds per slide</span>
                <Tooltip text="How long each image stays on screen — the same duration is used for every slide.">
                  <input type="number" min={1} max={30} value={slideSecondsPerSlide} onChange={(e) => setSlideSecondsPerSlide(Number(e.target.value))} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
                </Tooltip>
              </label>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Aspect / resolution</span>
                <Tooltip text="Output frame shape — each image is letterboxed to fit without cropping.">
                  <select value={slideAspect} onChange={(e) => setSlideAspect(e.target.value)} className="w-full px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    <option value="9:16">9:16 · Reels/Stories</option>
                    <option value="16:9">16:9 · Landscape</option>
                    <option value="1:1">1:1 · Square</option>
                    <option value="4:5">4:5 · Portrait</option>
                  </select>
                </Tooltip>
              </label>
            </div>
            <Tooltip text="Blend gently between slides instead of a hard cut.">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                <input type="checkbox" checked={slideCrossfade} onChange={(e) => setSlideCrossfade(e.target.checked)} />
                Crossfade between slides
              </label>
            </Tooltip>
            </>
            )}
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Background music (optional)</span>
              <Tooltip text="A music or voice track to play under the slideshow. Short tracks loop to fill the video; long tracks are trimmed to match.">
                <input
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.aac"
                  onChange={(e) => setSlideAudioFile(e.target.files?.[0] || null)}
                  className="block w-full text-xs"
                  style={{ color: 'var(--color-text)' }}
                />
              </Tooltip>
              {slideAudioFile && <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{slideAudioFile.name} — loops if shorter than the slideshow, trims if longer.</span>}
            </label>
            <EndCardToggle
              enabled={ctaOnSlideshow}
              setEnabled={setCtaOnSlideshow}
              cta={cta}
              setCta={setCta}
              tip="Finish the slideshow with a closing screen carrying your message and button."
            />
            <Tooltip text="Render all slides, apply the transition and music, and produce one MP4.">
              <button
                type="button"
                onClick={handleSlideshow}
                disabled={!ffmpegOk || slideImages.length < 2}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Build slideshow{slideImages.length ? ` · ${slideImages.length} images` : ''}
              </button>
            </Tooltip>
            {resultForTool === 'slideshow' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'caption-studio' && (
          <section className="space-y-4">
            <div>
              <ToolHeader id="caption-studio" label="Caption studio" onHelp={setHelpTool} getIcon={getIcon} />
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Pick a saved video or upload one, then burn styled SRT subtitles. Return later to add or update captions on library items.
              </p>
            </div>

            <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>Video source</p>
              <label className="block space-y-1">
                <span className="text-xs" style={{ color: 'var(--color-muted)' }}>From library (optional)</span>
                <Tooltip text="Pick a video already saved in your library instead of uploading a new file.">
                  <select
                    value={captionLibraryId}
                    onChange={(e) => {
                      setCaptionLibraryId(e.target.value);
                      if (e.target.value) setSourceFile(null);
                    }}
                    className="w-full px-2 py-2 rounded-xl border text-xs"
                    style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                  >
                    <option value="">Upload a file instead</option>
                    {libraryVideoItems.map((item) => (
                      <option key={item.id} value={String(item.id)}>{item.title} · {item.tool || 'video'}</option>
                    ))}
                  </select>
                </Tooltip>
              </label>
              {captionLibraryId && (
                <p className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                  Using saved video #{captionLibraryId}. Upload below to switch to a new file.
                </p>
              )}
            </div>

            <PositionGrid value={textPosition} onChange={setTextPosition} label="Caption position" />

            <CaptionStyleFields
              fontFamily={textFontFamily}
              setFontFamily={setTextFontFamily}
              fontSize={textFontSize}
              setFontSize={setTextFontSize}
              fontColor={textFontColor}
              setFontColor={setTextFontColor}
              fontWeight={textFontWeight}
              setFontWeight={setTextFontWeight}
              backgroundColor={textBackgroundColor}
              setBackgroundColor={setTextBackgroundColor}
              backgroundTransparent={textBackgroundTransparent}
              setBackgroundTransparent={setTextBackgroundTransparent}
            />

            <ScriptTimer
              file={sourceFile}
              libraryId={captionLibraryId}
              onTimed={(d) => {
                setSrtText(d.srt);
                addToast(d.method === 'speech' ? 'Script timed to the speech. Check the captions below.' : 'Script spread evenly over the video. Check the captions below.', d.method === 'speech' ? 'success' : 'info');
              }}
            />

            <div className="space-y-2">
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>Subtitles (SRT)</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {status?.transcribe?.note || 'Paste SRT content or auto-transcribe when uploading a file.'}
                {' '}No timestamps? Paste plain text or a script instead: when you burn, Vault listens to the video and times each line to the speech.
                {' '}Caption burn re-encodes once to embed text — audio is copied unchanged from your source.
              </p>
              {status?.transcribe?.available && !captionLibraryId && (
                <Tooltip text={status.transcribe.source === 'gemini' ? 'Extracts the audio track and asks Gemini to return ready-to-use SRT captions.' : 'Uses the local whisper-cli binary to transcribe speech (local dev only).'}>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!requireFile()) return;
                      const fd = new FormData();
                      fd.append('video', sourceFile);
                      startProcessing('Transcribing…', status.transcribe.source === 'gemini' ? 'Extracting audio and asking Gemini for SRT captions.' : '');
                      try {
                        const res = await api.postForm('/api/videos/transcribe', fd);
                        const data = await res.json();
                        if (!res.ok) throw new Error(data.error);
                        if (data.srt) {
                          setSrtText(data.srt);
                          addToast('Transcript ready — SRT captions filled in below', 'success');
                        } else {
                          setTranscript(data.text || '');
                          addToast('Transcript ready — convert to SRT or paste below', 'success');
                        }
                      } catch (e) {
                        addToast(e.message, 'error');
                      } finally {
                        stopProcessing();
                      }
                    }}
                    className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                    style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                  >
                    {status.transcribe.source === 'gemini' ? 'Auto-transcribe (Gemini)' : 'Auto-transcribe (local)'}
                  </button>
                </Tooltip>
              )}
              {transcript && (
                <textarea value={transcript} readOnly rows={3} className="w-full text-xs rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }} />
              )}
              <Tooltip text="Timed subtitle text in SRT format — paste it here or use auto-transcribe above.">
                <textarea
                  value={srtText}
                  onChange={(e) => setSrtText(e.target.value)}
                  rows={8}
                  placeholder="Paste SRT content here…"
                  className="w-full px-3 py-2 rounded-xl border text-xs font-mono"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </Tooltip>
            </div>

            <Tooltip text="Automatically store the captioned video in Saved media once it's done.">
              <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                <input
                  type="checkbox"
                  checked={captionSaveToLibrary}
                  onChange={(e) => setCaptionSaveToLibrary(e.target.checked)}
                />
                Save captioned result to library
              </label>
            </Tooltip>

            <Tooltip text="Burn the styled subtitles into the video.">
              <button
                type="button"
                onClick={handleCaptionStudio}
                disabled={!ffmpegOk || (!captionLibraryId && !sourceFile)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                style={{ background: 'var(--color-primary)' }}
              >
                Apply captions
              </button>
            </Tooltip>
            {resultForTool === 'caption-studio' && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} {...resultSaveProps} />
            )}
          </section>
        )}

        {tool === 'saved-library' && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <ToolHeader id="saved-library" label="Saved media" onHelp={setHelpTool} getIcon={getIcon} />
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Videos and images from tool runs — preview, delete, or open in Caption studio.
                </p>
              </div>
              <Tooltip text="Reload the saved media list from the server.">
                <button
                  type="button"
                  onClick={loadLibrary}
                  disabled={libraryLoading}
                  className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70 disabled:opacity-40"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                >
                  {libraryLoading ? 'Refreshing…' : 'Refresh'}
                </button>
              </Tooltip>
            </div>

            {libraryLoading && libraryItems.length === 0 && (
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>
            )}

            {!libraryLoading && libraryItems.length === 0 && (
              <p className="text-xs rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                Nothing saved yet. Run a tool and use <strong>Save to library</strong> on the result.
              </p>
            )}

            <ul className="space-y-2">
              {libraryItems.map((item) => (
                <li
                  key={item.id}
                  className="rounded-xl border p-3 space-y-2"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {renameId === item.id ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={async (e) => {
                            e.preventDefault();
                            if (await renameLibraryItem(item.id, renameValue)) setRenameId(null);
                          }}
                        >
                          <input
                            autoFocus
                            value={renameValue}
                            maxLength={200}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setRenameId(null); }}
                            className="text-sm rounded-lg border px-2 py-1 min-w-0"
                            style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                          />
                          <button type="submit" className="text-xs font-medium transition-opacity hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Save</button>
                          <button type="button" onClick={() => setRenameId(null)} className="text-xs transition-opacity hover:opacity-70" style={{ color: 'var(--color-muted)' }}>Cancel</button>
                        </form>
                      ) : (
                        <p className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{item.title}</p>
                      )}
                      <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {item.tool || '—'} · {item.mediaType} · {formatBytes(item.fileSize)} · {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5 shrink-0">
                      <Tooltip text="Load this saved file below to view it.">
                        <button
                          type="button"
                          onClick={() => previewLibraryItem(item)}
                          className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                        >
                          Preview
                        </button>
                      </Tooltip>
                      <Tooltip text="Change this file's name.">
                        <button
                          type="button"
                          onClick={() => { setRenameId(item.id); setRenameValue(item.title || ''); }}
                          className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                        >
                          Rename
                        </button>
                      </Tooltip>
                      {item.mediaType === 'video' && (
                        <Tooltip text="Open Caption studio with this video pre-selected.">
                          <button
                            type="button"
                            onClick={() => openCaptionStudioFor(item)}
                            className="text-xs px-2.5 py-1 rounded-lg border transition-opacity hover:opacity-70"
                            style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                          >
                            Add captions
                          </button>
                        </Tooltip>
                      )}
                      {deleteConfirmId === item.id ? (
                        <span className="flex items-center gap-1.5 text-xs">
                          <span style={{ color: 'var(--color-muted)' }}>Delete?</span>
                          <button type="button" onClick={() => deleteLibraryItem(item.id)} className="font-medium" style={{ color: '#ef4444' }}>Yes</button>
                          <button type="button" onClick={() => setDeleteConfirmId(null)} style={{ color: 'var(--color-muted)' }}>No</button>
                        </span>
                      ) : (
                        <Tooltip text="Permanently remove this file from your library.">
                          <button
                            type="button"
                            onClick={() => setDeleteConfirmId(item.id)}
                            className="text-xs px-2.5 py-1 rounded-lg transition-opacity hover:opacity-70"
                            style={{ color: '#ef4444' }}
                          >
                            Delete
                          </button>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  {item.transaction && Object.keys(item.transaction).length > 0 && (
                    <details className="text-[10px]" style={{ color: 'var(--color-muted)' }}>
                      <summary className="cursor-pointer transition-opacity hover:opacity-70">Tool settings</summary>
                      <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-[10px] p-2 rounded-lg" style={{ background: 'var(--color-surface)' }}>
                        {JSON.stringify(item.transaction, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
            </ul>

            {resultForTool === 'saved-library' && resultBlob && (
              <ResultVideo blobUrl={resultBlob} downloadName={resultName} onUse={useResultAsSource} />
            )}
            {thumbUrl && tool === 'saved-library' && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Image preview</p>
                <img src={thumbUrl} alt="" className="max-w-full rounded-lg border" style={{ borderColor: 'var(--color-border)' }} />
              </div>
            )}
          </section>
        )}

        {tool === 'info' && (
          <section className="space-y-3">
            <ToolHeader id="info" label="File info" onHelp={setHelpTool} getIcon={getIcon} />
            <Tooltip text="Read the video's duration, resolution, codec, and audio/container details with ffprobe.">
              <button type="button" onClick={handleProbe} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
                Analyse file
              </button>
            </Tooltip>
            {probe && (
              <dl className="text-xs grid grid-cols-2 gap-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <dt style={{ color: 'var(--color-muted)' }}>Duration</dt><dd>{formatDuration(probe.duration)}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Resolution</dt><dd>{probe.width && probe.height ? `${probe.width}×${probe.height}` : '—'}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Codec</dt><dd>{probe.codec || '—'}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Audio</dt><dd>{probe.hasAudio ? 'Yes' : 'No'}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Size</dt><dd>{formatBytes(probe.uploadSize || probe.size)}</dd>
                <dt style={{ color: 'var(--color-muted)' }}>Container</dt><dd>{probe.format || '—'}</dd>
              </dl>
            )}
          </section>
        )}

        {tool === 'thumbnail' && (
          <section className="space-y-3">
            <ToolHeader id="thumbnail" label="Thumbnail" onHelp={setHelpTool} getIcon={getIcon} />
            <label className="block space-y-1">
              <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Frame at (seconds)</span>
              <Tooltip text="The timestamp in the video to capture as a still image.">
                <input type="number" min={0} step={0.1} value={thumbTime} onChange={(e) => setThumbTime(Number(e.target.value))} className="w-32 px-2 py-2 rounded-xl border text-xs" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} />
              </Tooltip>
            </label>
            <Tooltip text="Capture the frame at that timestamp as a JPG image.">
              <button type="button" onClick={async () => { if (!requireFile()) return; const fd = new FormData(); fd.append('video', sourceFile); fd.append('timeSec', String(thumbTime)); startProcessing('Capturing frame…', ''); try { const res = await api.postForm('/api/videos/thumbnail', fd); if (!res.ok) { const e = await res.json(); throw new Error(e.error); } const blob = await res.blob(); thumbBlobRef.current = blob; if (thumbUrl) URL.revokeObjectURL(thumbUrl); setThumbUrl(URL.createObjectURL(blob)); addToast('Thumbnail ready', 'success'); } catch (e) { addToast(e.message, 'error'); } finally { stopProcessing(); } }} disabled={!ffmpegOk} className="px-4 py-2 rounded-xl text-sm font-medium text-white transition-opacity hover:opacity-80 disabled:opacity-40" style={{ background: 'var(--color-primary)' }}>
                Export JPG
              </button>
            </Tooltip>
            {thumbUrl && (
              <div className="space-y-2 rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <p className="text-[10px] font-medium uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Result</p>
                <img src={thumbUrl} alt="Thumbnail" className="max-w-full rounded-xl border" style={{ borderColor: 'var(--color-border)' }} />
                <div className="flex flex-wrap gap-2">
                  <Tooltip text="Save this image to your device.">
                    <a href={thumbUrl} download="thumbnail.jpg" className="text-xs px-3 py-1.5 rounded-lg text-white transition-opacity hover:opacity-80" style={{ background: 'var(--color-primary)' }}>
                      Download JPG
                    </a>
                  </Tooltip>
                  <Tooltip text="Store this thumbnail in your Saved media library.">
                    <button
                      type="button"
                      onClick={handleSaveThumbnail}
                      className="text-xs px-3 py-1.5 rounded-lg border transition-opacity hover:opacity-70"
                      style={{ borderColor: 'var(--color-primary)', color: 'var(--color-primary)' }}
                    >
                      Save to library
                    </button>
                  </Tooltip>
                </div>
              </div>
            )}
          </section>
        )}
      </main>

      {helpTool && TOOL_HELP[helpTool] && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setHelpTool(null)}
        >
          <div
            className="rounded-2xl p-6 max-w-md w-full shadow-xl"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', border: '1px solid' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>{TOOL_HELP[helpTool].title}</h3>
              <button
                type="button"
                onClick={() => setHelpTool(null)}
                className="hover:opacity-60 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
              >
                {getIcon('x', { size: 18 })}
              </button>
            </div>
            <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{TOOL_HELP[helpTool].what}</p>
            <ul className="space-y-2">
              {TOOL_HELP[helpTool].features.map((feat, i) => (
                <li key={i} className="flex items-start gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon('check', { size: 14 })}</span>
                  {feat}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {providerInfoOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          style={{ background: 'rgba(0,0,0,0.4)' }}
          onClick={() => setProviderInfoOpen(false)}
        >
          <div
            className="rounded-2xl p-6 max-w-md w-full shadow-xl"
            style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', border: '1px solid' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>FAL vs Replicate</h3>
              <button
                type="button"
                onClick={() => setProviderInfoOpen(false)}
                className="hover:opacity-60 transition-opacity"
                style={{ color: 'var(--color-muted)' }}
              >
                {getIcon('x', { size: 18 })}
              </button>
            </div>
            <p className="text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
              Both are third-party hosts that run the same family of text-to-video models — this app doesn't train or run its own model. Which one you get depends only on which API key is configured on the server, checked in this order:
            </p>
            <ul className="space-y-2 text-sm mb-3" style={{ color: 'var(--color-text)' }}>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon('check', { size: 14 })}</span>
                <span><strong>Replicate</strong> (used first, when <code>REPLICATE_API_TOKEN</code> is set) — runs <code className="font-mono text-xs">minimax/hailuo-2.3</code>, the mainline Hailuo model. Noticeably more photoreal for humans.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="mt-0.5 flex-shrink-0" style={{ color: 'var(--color-primary)' }}>{getIcon('check', { size: 14 })}</span>
                <span><strong>FAL</strong> (fallback, when only <code>FAL_API_KEY</code> is set) — runs <code className="font-mono text-xs">fal-ai/minimax/video-01-live</code>, a "live"/animation-oriented variant. Faster/cheaper for stylized motion graphics, but humans often come out looking cartoon/CGI.</span>
              </li>
            </ul>
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Both are billed pay-per-generation by their respective providers, independent of each other and of this app. Set or remove <code>REPLICATE_API_TOKEN</code> in Railway to switch which one runs — no code change needed. The badge above always shows which one is actually active right now.
            </p>
          </div>
        </div>
      )}
      <TutorChat currentTool={tool} onOpenTool={openToolById} />
    </div>
    </VideoVoiceContext.Provider>
    </VoiceInputProvider>
  );
}
