'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { getLogger } = require('../middleware/requestContext');
const { aiLimiter } = require('../middleware/aiRateLimit');
const { ffmpegRoute } = require('../middleware/ffmpegRoute');
const { captureIf, makeFingerprint } = require('../services/SuggestionService');
const { checkFfmpeg, MAX_VIDEO_BYTES, extensionForMime, probeVideo } = require('../services/videoFfmpeg');
const { MOOD_PRESETS, CUSTOM_ID, buildMusicPrompt } = require('../services/music/musicPrompts');
const { getMusicProvider } = require('../services/music/musicProviders');
const {
  mixMusicWithVideo, normalizeMixSettings, normalizeVoiceSettings, prepareVoiceover,
} = require('../services/music/musicFit');
const {
  VOICES, MAX_TEXT_CHARS, normalizeSpeech, getVoiceProvider,
} = require('../services/music/voiceProviders');
const { videoJobGate } = require('../services/videoJobGate');
const { createJob, runJob, runUploadedTrackJob, getJob, removeJob, publicJob } = require('../services/music/musicJobs');
const { saveAsset, getUserUsageBytes, LIBRARY_QUOTA_BYTES } = require('../services/videoLibraryService');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VIDEO_BYTES } });
const MAX_VOICE_BYTES = 40 * 1024 * 1024;
const voiceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_VOICE_BYTES } });

// Long videos mean long WAVs on disk (3 options x 10 MB/min) — keep the default modest.
const MAX_VIDEO_SEC = Number(process.env.MUSIC_MAX_VIDEO_SEC || 300);

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function findOption(req, res, { needFit = true } = {}) {
  const job = getJob(req.params.id, req.user.id);
  if (!job) { res.status(404).json({ error: 'That music job was not found or has expired — generate again.' }); return null; }
  const opt = job.options[Number(req.params.n)];
  if (!opt) { res.status(404).json({ error: 'Unknown option' }); return null; }
  if (needFit && opt.status !== 'ready') { res.status(409).json({ error: 'That option is not ready' }); return null; }
  return { job, opt };
}

router.get('/status', async (req, res) => {
  const ffmpeg = await checkFfmpeg();
  const provider = getMusicProvider().describe();
  const voiceProvider = getVoiceProvider().describe();
  await captureIf(!ffmpeg, {
    userId: req.user.id,
    source: 'music',
    category: 'alert',
    fingerprint: makeFingerprint('music', 'ffmpeg-unavailable'),
    title: 'Music: ffmpeg not available',
    body: 'checkFfmpeg() returned false on /api/music/status — fitting and mixing music will fail. Check the ffmpeg binary/PATH on this deployment.',
    context: 'server/routes/music.js /status',
  });
  await captureIf(!provider.configured, {
    userId: req.user.id,
    source: 'music',
    category: 'alert',
    fingerprint: makeFingerprint('music', 'provider-not-configured'),
    title: 'Music: generation backend not configured',
    body: `${provider.note || 'The music backend is not configured.'} Set REPLICATE_API_TOKEN on this deployment.`,
    context: 'server/routes/music.js /status',
  });
  res.json({
    ffmpeg,
    provider,
    maxUploadMb: Math.round(MAX_VIDEO_BYTES / (1024 * 1024)),
    maxVideoSec: MAX_VIDEO_SEC,
    voice: { provider: voiceProvider, voices: VOICES, maxChars: MAX_TEXT_CHARS, maxUploadMb: Math.round(MAX_VOICE_BYTES / (1024 * 1024)) },
    moods: [...MOOD_PRESETS.map((m) => ({ id: m.id, label: m.label, defaultBpm: m.defaultBpm })), { id: CUSTOM_ID, label: 'Custom prompt' }],
  });
});

// Upload the video, start generating 3 options in the background, answer straight away; the
// client polls GET /jobs/:id. Generation takes tens of seconds per option, so it must not hold a request open.
// With a `track` file the user's own music is fitted instead of generating any (no provider, no cost).
function audioExt(file) {
  const ext = path.extname(String(file.originalname || '')).toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

router.post('/jobs', aiLimiter, upload.fields([{ name: 'video', maxCount: 1 }, { name: 'track', maxCount: 1 }]), ffmpegRoute('jobs', async (req, res) => {
  const file = req.files?.video?.[0];
  const trackFile = req.files?.track?.[0] || null;
  if (!file?.buffer?.length) return res.status(400).json({ error: 'Choose a video file first' });
  if (trackFile && !trackFile.buffer?.length) return res.status(400).json({ error: 'That music file is empty' });

  const provider = getMusicProvider();
  const info = provider.describe();
  if (!trackFile && !info.configured) return res.status(503).json({ error: info.note || 'Music generation is not set up on this server.' });

  let promptInfo = null;
  if (!trackFile) {
    try {
      promptInfo = buildMusicPrompt({ mood: req.body?.mood, custom: req.body?.prompt, bpm: req.body?.bpm });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  let job;
  try {
    job = await createJob({
      userId: req.user.id,
      videoFile: { buffer: file.buffer, ext: extensionForMime(file.mimetype) },
      durationS: 0,
      hasAudio: false,
      promptInfo,
      providerName: trackFile ? 'your own track' : info.name,
      trackFile: trackFile ? { buffer: trackFile.buffer, ext: audioExt(trackFile) } : null,
    });
  } catch (err) {
    if (err.code === 'MUSIC_BUSY') return res.status(429).json({ error: err.message });
    throw err;
  }

  // Probe after the file is on disk: the real duration decides everything downstream.
  let probe;
  try {
    probe = await probeVideo(job.videoPath);
  } catch {
    await removeJob(job);
    return res.status(400).json({ error: 'That file could not be read as a video.' });
  }
  if (!probe.width || !probe.duration || probe.duration < 1) {
    await removeJob(job);
    return res.status(400).json({ error: 'That file does not look like a video with a picture and a length.' });
  }
  if (probe.duration > MAX_VIDEO_SEC) {
    await removeJob(job);
    return res.status(400).json({ error: `Videos over ${Math.round(MAX_VIDEO_SEC / 60)} minutes are not supported yet (yours is ${Math.round(probe.duration)}s).` });
  }
  job.durationS = probe.duration;
  job.hasAudio = probe.hasAudio;

  if (trackFile) {
    let trackProbe;
    try {
      trackProbe = await probeVideo(job.trackPath);
    } catch {
      await removeJob(job);
      return res.status(400).json({ error: 'That music file could not be read. Try an MP3, WAV or M4A.' });
    }
    if (!trackProbe.hasAudio || !(trackProbe.duration > 0)) {
      await removeJob(job);
      return res.status(400).json({ error: 'That file has no audio in it.' });
    }
    runUploadedTrackJob(job).catch((err) => {
      getLogger().error({ err }, '[music/jobs track]');
      job.status = 'failed';
      job.stage = 'Failed';
      job.error = String(err.message || err).slice(0, 300);
    });
    return res.status(202).json(publicJob(job));
  }

  runJob(job, provider).catch((err) => {
    getLogger().error({ err }, '[music/jobs run]');
    job.status = 'failed';
    job.stage = 'Failed';
    job.error = String(err.message || err).slice(0, 300);
  });
  return res.status(202).json(publicJob(job));
}, { source: 'music', routePrefix: 'music' }));

router.get('/jobs/:id', (req, res) => {
  const job = getJob(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'That music job was not found or has expired — generate again.' });
  res.json(publicJob(job));
});

router.delete('/jobs/:id', async (req, res) => {
  const job = getJob(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  await removeJob(job);
  res.json({ ok: true });
});

// The fitted music alone (WAV), exactly the video's length with fades.
router.get('/jobs/:id/options/:n/audio', (req, res) => {
  const found = findOption(req, res);
  if (!found) return;
  res.download(found.opt.fitPath, `music-${stamp()}-option${found.opt.n + 1}.wav`);
});

// Mixed video. `preview=1` renders a small fast copy for the browser; otherwise the full export.
// Renders are cached per (option, volume, ducking, kind) inside the job's directory.
// Render (or reuse) the mixed video for an option; returns the file path.
async function ensureMixRender(job, opt, kind, query) {
  const preview = kind === 'preview';
  const settings = normalizeMixSettings({ volume: query.volume, ducking: query.ducking });
  // A voiceover changes the render, so its identity (rev), level and start are part of the cache name.
  const voice = job.voice ? normalizeVoiceSettings({ voiceVolume: query.voiceVolume, voiceStartS: query.voiceStart }, job.durationS) : null;
  const voiceTag = voice ? `_v${job.voice.rev}_${Math.round(voice.volume * 100)}_${Math.round(voice.startS * 10)}` : '';
  const outPath = path.join(job.dir, `${kind}_${opt.n}_${Math.round(settings.volume * 100)}_${settings.ducking}${voiceTag}.mp4`);
  const exists = await fs.access(outPath).then(() => true, () => false);
  if (!exists) {
    // Render to a temp name then rename, so two requests for the same render never read a half-written file.
    const partPath = outPath.replace(/\.mp4$/, '.part.mp4');
    await mixMusicWithVideo({
      videoPath: job.videoPath,
      musicPath: opt.fitPath,
      outPath: partPath,
      durationS: job.durationS,
      hasAudio: job.hasAudio,
      ...settings,
      preview,
      voicePath: voice ? job.voice.path : null,
      voice,
    });
    await fs.rename(partPath, outPath);
  }
  return { outPath, settings, voice };
}

function mixedVideoRoute(kind) {
  const preview = kind === 'preview';
  return ffmpegRoute(`${kind}`, async (req, res) => {
    const found = findOption(req, res);
    if (!found) return;
    const { job, opt } = found;
    const { outPath } = await ensureMixRender(job, opt, kind, req.query);
    if (preview) return res.sendFile(outPath);
    return res.download(outPath, `video-with-music-${stamp()}-option${opt.n + 1}.mp4`);
  }, { source: 'music', routePrefix: 'music' });
}
// Voiceover: either an uploaded recording (`voice` file) or a script read by an AI voice
// (`text`, optional `voice` id and `speed`). One per job — adding another replaces it. It is converted to a
// known WAV format here; level and start time are chosen at render time (voiceVolume / voiceStart).
router.post('/jobs/:id/voiceover', aiLimiter, voiceUpload.single('voice'), ffmpegRoute('voiceover', async (req, res) => {
  const job = getJob(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'That music job was not found or has expired — generate again.' });
  if (job.status !== 'done') return res.status(409).json({ error: 'Wait for the music to finish first.' });

  let srcBuffer;
  let source;
  let speech = null;
  if (req.file?.buffer?.length) {
    srcBuffer = req.file.buffer;
    source = 'upload';
  } else {
    try {
      speech = normalizeSpeech({ text: req.body?.text, voice: req.body?.voice, speed: req.body?.speed });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    const provider = getVoiceProvider();
    const info = provider.describe();
    if (!info.configured) return res.status(503).json({ error: info.note || 'AI voices are not set up on this server.' });
    try {
      srcBuffer = await provider.speak(speech);
    } catch (err) {
      getLogger().error({ err }, '[music/voiceover speak]');
      return res.status(502).json({ error: String(err.message || 'The voice could not be generated').slice(0, 300) });
    }
    source = 'tts';
  }

  job.voiceRev = (job.voiceRev || 0) + 1; // never reused, even after the voiceover is removed
  const rev = job.voiceRev;
  const srcPath = path.join(job.dir, `voice_src_${rev}${source === 'upload' ? audioExt(req.file) : '.audio'}`);
  const outPath = path.join(job.dir, `voice_${rev}.wav`);
  await fs.writeFile(srcPath, srcBuffer);
  try {
    await videoJobGate.run(() => prepareVoiceover(srcPath, outPath));
  } catch {
    await fs.rm(srcPath, { force: true }).catch(() => {});
    return res.status(400).json({ error: source === 'upload' ? 'That voice file could not be read. Try an MP3, WAV or M4A.' : 'The generated voice could not be processed.' });
  }
  const probe = await probeVideo(outPath).catch(() => null);
  await fs.rm(srcPath, { force: true }).catch(() => {});
  if (!probe || !(probe.duration > 0.2)) {
    await fs.rm(outPath, { force: true }).catch(() => {});
    return res.status(400).json({ error: 'That voice recording has no audio in it.' });
  }

  if (job.voice?.path) await fs.rm(job.voice.path, { force: true }).catch(() => {});
  job.voice = {
    path: outPath,
    rev,
    source,
    durationS: probe.duration,
    text: speech?.text || null,
    voiceId: speech?.voice || null,
  };
  res.status(201).json(publicJob(job));
}, { source: 'music', routePrefix: 'music' }));

router.delete('/jobs/:id/voiceover', async (req, res) => {
  const job = getJob(req.params.id, req.user.id);
  if (!job) return res.status(404).json({ error: 'That music job was not found or has expired — generate again.' });
  if (job.voice?.path) await fs.rm(job.voice.path, { force: true }).catch(() => {});
  job.voice = null;
  res.json(publicJob(job));
});

// The voiceover on its own (as the mixer receives it), for a quick listen.
router.get('/jobs/:id/voiceover/audio', (req, res) => {
  const job = getJob(req.params.id, req.user.id);
  if (!job?.voice) return res.status(404).json({ error: 'No voiceover on this job' });
  res.sendFile(job.voice.path);
});

router.get('/jobs/:id/options/:n/preview', mixedVideoRoute('preview'));
router.get('/jobs/:id/options/:n/video', mixedVideoRoute('export'));

// Save the full-quality mixed video to Saved media (Video Tools' library), so it can be captioned,
// joined, annotated and so on. Body: { title?, volume?, ducking? } (same settings as the export).
router.post('/jobs/:id/options/:n/save', ffmpegRoute('save', async (req, res) => {
  const found = findOption(req, res);
  if (!found) return;
  const { job, opt } = found;
  const { outPath, settings, voice } = await ensureMixRender(job, opt, 'export', req.body || {});
  const buffer = await fs.readFile(outPath);

  const used = await getUserUsageBytes(req.user.id);
  if (used + buffer.length > LIBRARY_QUOTA_BYTES) {
    return res.status(413).json({ error: `Library is full (${Math.round(LIBRARY_QUOTA_BYTES / (1024 * 1024))}MB limit) — delete some saved items first` });
  }
  const own = job.source === 'upload';
  const item = await saveAsset(req.user.id, buffer, {
    title: String(req.body?.title || '').trim().slice(0, 120) || `Video with ${voice ? 'music and voiceover' : 'music'} ${stamp()}`,
    tool: 'music',
    mediaType: 'video',
    mimeType: 'video/mp4',
    transaction: {
      tool: 'music',
      source: job.source,
      mood: own ? undefined : job.mood,
      prompt: own ? undefined : job.prompt,
      bpm: own ? undefined : job.bpm,
      volume: settings.volume,
      ducking: settings.ducking,
      option: opt.n + 1,
      voiceover: voice ? {
        source: job.voice.source,
        text: job.voice.text,
        voice: job.voice.voiceId,
        volume: voice.volume,
        startS: voice.startS,
      } : undefined,
    },
    metadata: { durationS: job.durationS },
  });
  res.status(201).json(item);
}, { source: 'music', routePrefix: 'music' }));

module.exports = router;
