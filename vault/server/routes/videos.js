'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const archiver = require('archiver');
const { runtimeConfig } = require('../config/runtime');
const { saveAsset, listAssets, getAsset, deleteAsset } = require('../services/videoLibraryService');
const {
  startVideoGeneration, pollVideoGeneration, getVideoGenerateConfig, buildYoutubeContext, fetchPlaybackVideo,
  transcribeAudioWithGemini, isGeminiTranscribeAvailable,
} = require('../services/videoGenerateService');
const {
  checkFfmpeg,
  MAX_VIDEO_BYTES,
  extensionForMime,
  probeVideo,
  clipVideo,
  convertVideo,
  joinVideosWithOptionalCrossfade,
  reframeVideo,
  muteOrReplaceAudio,
  changeVideoSpeed,
  overlayImage,
  extractAudio,
  captureThumbnail,
  annotateVideo,
  burnSubtitles,
  extractWav16k,
  withTempDir,
  readOutputFile,
  execFileAsync,
  normalizeAudioLoudness,
  videoToGif,
  buildSlideshow,
} = require('../services/videoFfmpeg');
const { normalizeSrt } = require('../services/srtUtils');

const router = express.Router();

const videoJobCache = new Map();
const VIDEO_JOB_TTL_MS = 60 * 60 * 1000;

function rememberVideoJob(requestId, userId, payload) {
  videoJobCache.set(requestId, { userId, payload, at: Date.now() });
}

function getVideoJob(requestId, userId) {
  const entry = videoJobCache.get(requestId);
  if (!entry) return null;
  if (Date.now() - entry.at > VIDEO_JOB_TTL_MS) {
    videoJobCache.delete(requestId);
    return null;
  }
  if (entry.userId !== userId) return null;
  return entry.payload;
}

function forgetVideoJob(requestId) {
  videoJobCache.delete(requestId);
}

// Export for Social — short-lived server-side cache of rendered per-preset
// buffers so the client can download each file individually or as one zip
// without re-uploading/re-encoding. Same TTL-map pattern as videoJobCache.
const exportSocialCache = new Map();
const EXPORT_SOCIAL_TTL_MS = 30 * 60 * 1000;

const SOCIAL_EXPORT_PRESETS = {
  reels: { label: 'Reels / TikTok / Shorts', aspect: '9:16', maxDurationSec: 60 },
  square: { label: 'Square', aspect: '1:1', maxDurationSec: null },
  landscape: { label: 'Landscape / YouTube', aspect: '16:9', maxDurationSec: null },
};

function rememberExportSocial(exportId, userId, items) {
  exportSocialCache.set(exportId, { userId, items, at: Date.now() });
}

function getExportSocial(exportId, userId) {
  const entry = exportSocialCache.get(exportId);
  if (!entry) return null;
  if (Date.now() - entry.at > EXPORT_SOCIAL_TTL_MS) {
    exportSocialCache.delete(exportId);
    return null;
  }
  if (entry.userId !== userId) return null;
  return entry;
}

function pruneExportSocialCache() {
  const now = Date.now();
  for (const [id, entry] of exportSocialCache) {
    if (now - entry.at > EXPORT_SOCIAL_TTL_MS) exportSocialCache.delete(id);
  }
}

function parseJsonBodyField(val) {
  if (val == null || val === '') return null;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

function captionStyleFromBody(body) {
  const transparent = body?.backgroundTransparent === 'true'
    || body?.backgroundTransparent === true
    || body?.backgroundColor === 'transparent';
  return {
    fontFamily: body?.fontFamily || 'Roboto',
    fontSize: Number(body?.fontSize) || 24,
    fontColor: body?.fontColor || '#FFFFFF',
    fontWeight: body?.fontWeight || 'normal',
    backgroundColor: body?.backgroundColor || '#000000',
    backgroundTransparent: transparent,
    position: body?.position || 'bottom-center',
    outlineColor: body?.outlineColor || '#000000',
    outline: Number(body?.outline) || 1,
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES },
});

function defaultModelPath() {
  const os = require('os');
  return path.join(os.homedir(), '.local/share/whisper.cpp/models/ggml-base.en.bin');
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function transcribeWav(wavPath) {
  const whisperCommand = process.env.LOCAL_WHISPER_COMMAND || 'whisper-cli';
  const modelPath = process.env.LOCAL_WHISPER_MODEL || defaultModelPath();
  if (!(await pathExists(modelPath))) {
    throw new Error(`Whisper model not found at ${modelPath}`);
  }
  const { stdout } = await execFileAsync(whisperCommand, [
    '-m', modelPath,
    '-f', wavPath,
    '--no-timestamps',
    '-l', 'en',
  ]);
  return String(stdout || '').trim();
}

function sendVideoBuffer(res, buffer, filename = 'output.mp4', contentType = 'video/mp4') {
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}

function sendImageBuffer(res, buffer, filename = 'thumbnail.jpg') {
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(buffer);
}

async function writeUpload(dir, file) {
  if (!file?.buffer?.length) throw new Error('Video file is required');
  const ext = extensionForMime(file.mimetype);
  const inputPath = path.join(dir, `input${ext}`);
  await fs.writeFile(inputPath, file.buffer);
  return inputPath;
}

router.get('/status', async (req, res) => {
  const ffmpeg = await checkFfmpeg();
  const generate = getVideoGenerateConfig();

  let transcribe;
  if (runtimeConfig.isLocal) {
    transcribe = {
      available: ffmpeg,
      source: 'whisper-local',
      note: 'Local whisper-cli when model is installed',
    };
  } else {
    const geminiOk = ffmpeg && await isGeminiTranscribeAvailable(req.user.id);
    transcribe = {
      available: geminiOk,
      source: geminiOk ? 'gemini' : null,
      note: geminiOk
        ? 'Hosted auto-transcribe via Gemini — extracts the audio track and returns SRT captions.'
        : 'Add GEMINI_API_KEY and a Gemini model in Settings to enable hosted auto-transcribe, or paste an SRT file.',
    };
  }

  res.json({
    ffmpeg,
    maxUploadMb: Math.round(MAX_VIDEO_BYTES / (1024 * 1024)),
    generate,
    transcribe,
  });
});

router.post('/youtube-preview', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url?.trim()) return res.status(400).json({ error: 'url is required' });
    const ref = await buildYoutubeContext(req.user.id, url.trim(), { describeThumbnail: false });
    res.json({
      videoId: ref.videoId,
      title: ref.title,
      url: ref.url,
      thumbnailUrl: ref.thumbnailUrl,
      transcriptExcerpt: ref.transcriptExcerpt,
      hasTranscript: Boolean(ref.transcriptExcerpt),
    });
  } catch (err) {
    console.error('[videos/youtube-preview]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.post('/playback', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url) return res.status(400).json({ error: 'url is required' });
    const { buffer, contentType } = await fetchPlaybackVideo(url);
    res.setHeader('Content-Type', contentType || 'video/mp4');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buffer);
  } catch (err) {
    console.error('[videos/playback]', err.message);
    res.status(400).json({ error: err.message });
  }
});

router.get('/library', async (req, res) => {
  try {
    const items = await listAssets(req.user.id);
    res.json(items);
  } catch (err) {
    console.error('[videos/library]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/library', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file?.buffer?.length) return res.status(400).json({ error: 'file is required' });

    const item = await saveAsset(req.user.id, file.buffer, {
      title: req.body?.title,
      tool: req.body?.tool,
      mediaType: req.body?.mediaType === 'image' ? 'image' : 'video',
      mimeType: file.mimetype,
      transaction: parseJsonBodyField(req.body?.transaction),
      metadata: parseJsonBodyField(req.body?.metadata),
    });
    res.status(201).json(item);
  } catch (err) {
    console.error('[videos/library POST]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/library/:id/stream', async (req, res) => {
  try {
    const asset = await getAsset(req.user.id, Number(req.params.id));
    if (!asset) return res.status(404).json({ error: 'Not found' });
    const buf = await fs.readFile(asset.filePath);
    res.setHeader('Content-Type', asset.mimeType || (asset.mediaType === 'image' ? 'image/jpeg' : 'video/mp4'));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  } catch (err) {
    console.error('[videos/library/stream]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/library/:id/captions', upload.fields([{ name: 'srt', maxCount: 1 }]), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const asset = await getAsset(req.user.id, Number(req.params.id));
    if (!asset || asset.mediaType !== 'video') return res.status(404).json({ error: 'Video not found in library' });

    const srtFile = req.files?.srt?.[0];
    const srtText = req.body?.srtText;
    if (!srtFile && !srtText?.trim()) return res.status(400).json({ error: 'srt file or srtText is required' });

    const style = captionStyleFromBody(req.body);
    const saveToLibrary = req.body?.saveToLibrary === 'true' || req.body?.saveToLibrary === true;

    const buffer = await withTempDir(async (dir) => {
      const inputPath = asset.filePath;
      const srtPath = path.join(dir, 'captions.srt');
      if (srtFile) {
        await fs.writeFile(srtPath, srtFile.buffer);
      } else {
        await fs.writeFile(srtPath, String(srtText), 'utf8');
      }
      const outputPath = path.join(dir, 'captioned.mp4');
      await burnSubtitles(inputPath, srtPath, outputPath, style, dir);
      return readOutputFile(outputPath);
    });

    if (saveToLibrary) {
      await saveAsset(req.user.id, buffer, {
        title: `${asset.title} (captioned)`,
        tool: 'caption-studio',
        mediaType: 'video',
        mimeType: 'video/mp4',
        transaction: { sourceLibraryId: asset.id, captionStyle: style },
        metadata: { parentId: asset.id },
      });
    }

    sendVideoBuffer(res, buffer, 'captioned.mp4');
  } catch (err) {
    console.error('[videos/library/captions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/library/:id', async (req, res) => {
  try {
    const ok = await deleteAsset(req.user.id, Number(req.params.id));
    if (!ok) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[videos/library DELETE]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/generate/status', async (req, res) => {
  try {
    const requestId = String(req.query?.requestId || '').trim();
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required' });
    }

    const cached = getVideoJob(requestId, req.user.id);
    if (!cached) {
      return res.status(404).json({ error: 'Generation job not found or expired — submit again' });
    }

    const polled = await pollVideoGeneration({
      provider: cached.provider,
      endpoint: cached.endpoint,
      requestId,
      pollUrl: cached.pollUrl,
      meta: cached,
    });

    if (polled.status === 'COMPLETED') forgetVideoJob(requestId);
    res.json(polled);
  } catch (err) {
    console.error('[videos/generate/status]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/generate', async (req, res) => {
  try {
    const {
      brief,
      style,
      aspect,
      durationSec,
      seedImage,
      seedImageDataUrl,
      seedImageUrl,
      seedImageMode,
      youtubeUrl,
      useYoutubeThumbnailAsSeed,
    } = req.body || {};

    const started = await startVideoGeneration(req.user.id, {
      brief: brief?.trim() || '',
      style,
      aspect: aspect || '16:9',
      durationSec,
      seedImage: seedImageDataUrl || seedImageUrl || seedImage,
      seedImageMode: seedImageMode === 'suggest' ? 'suggest' : 'animate',
      youtubeUrl: youtubeUrl?.trim() || '',
      useYoutubeThumbnailAsSeed: Boolean(useYoutubeThumbnailAsSeed),
    });

    rememberVideoJob(started.requestId, req.user.id, {
      provider: started.provider,
      model: started.model,
      endpoint: started.endpoint,
      pollUrl: started.pollUrl,
      mode: started.mode,
      video_prompt: started.video_prompt,
      negative_prompt: started.negative_prompt,
      aspect: started.aspect,
      width: started.width,
      height: started.height,
      durationSec: started.durationSec,
      references: started.references,
    });

    res.json(started);
  } catch (err) {
    console.error('[videos/generate]', err.message);
    res.status(err.message.includes('not configured') ? 503 : 500).json({ error: err.message });
  }
});

router.post('/probe', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const info = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      return probeVideo(inputPath);
    });

    res.json({
      filename: req.file?.originalname || 'video',
      mime: req.file?.mimetype,
      uploadSize: req.file?.size,
      ...info,
    });
  } catch (err) {
    console.error('[videos/probe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/clip', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const startSec = Number(req.body?.startSec ?? 0);
    const endSec = req.body?.endSec != null && req.body.endSec !== '' ? Number(req.body.endSec) : null;
    if (!Number.isFinite(startSec) || startSec < 0) {
      return res.status(400).json({ error: 'startSec must be a non-negative number' });
    }
    if (endSec != null && (!Number.isFinite(endSec) || endSec <= startSec)) {
      return res.status(400).json({ error: 'endSec must be greater than startSec' });
    }

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'clip.mp4');
      await clipVideo(inputPath, outputPath, { startSec, endSec });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'clip.mp4');
  } catch (err) {
    console.error('[videos/clip]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/convert', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const crf = Number(req.body?.crf ?? 23);
    const maxWidth = req.body?.maxWidth ? Number(req.body.maxWidth) : null;

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'converted.mp4');
      await convertVideo(inputPath, outputPath, {
        crf: Number.isFinite(crf) ? Math.min(35, Math.max(18, crf)) : 23,
        maxWidth: maxWidth && Number.isFinite(maxWidth) ? maxWidth : null,
      });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'converted.mp4');
  } catch (err) {
    console.error('[videos/convert]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/join', upload.array('videos', 12), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const files = req.files || [];
    if (files.length < 2) {
      return res.status(400).json({ error: 'Upload at least two video files (field name: videos)' });
    }

    const maxWidth = req.body?.maxWidth ? Number(req.body.maxWidth) : 1280;
    const crf = req.body?.crf != null && req.body.crf !== '' ? Number(req.body.crf) : 23;
    const crossfadeSec = req.body?.crossfadeSec != null && req.body.crossfadeSec !== ''
      ? Number(req.body.crossfadeSec)
      : 0;

    const buffer = await withTempDir(async (dir) => {
      const inputPaths = [];
      for (let i = 0; i < files.length; i += 1) {
        const file = files[i];
        if (!file?.buffer?.length) throw new Error(`Video file #${i + 1} is empty`);
        const ext = extensionForMime(file.mimetype);
        const inputPath = path.join(dir, `join_in_${i}${ext}`);
        await fs.writeFile(inputPath, file.buffer);
        inputPaths.push(inputPath);
      }
      const outputPath = path.join(dir, 'joined.mp4');
      await joinVideosWithOptionalCrossfade(inputPaths, outputPath, {
        maxWidth: Number.isFinite(maxWidth) ? maxWidth : 1280,
        crf: Number.isFinite(crf) ? crf : 23,
        crossfadeSec: Number.isFinite(crossfadeSec) ? Math.max(0, crossfadeSec) : 0,
      });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'joined.mp4');
  } catch (err) {
    console.error('[videos/join]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reframe', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const aspect = req.body?.aspect || '9:16';
    const mode = req.body?.mode === 'pad' ? 'pad' : 'crop';
    const focus = req.body?.focus || 'center';
    const maxHeight = req.body?.maxHeight ? Number(req.body.maxHeight) : 1920;

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'reframed.mp4');
      await reframeVideo(inputPath, outputPath, { aspect, mode, focus, maxHeight });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'reframed.mp4');
  } catch (err) {
    console.error('[videos/reframe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/audio', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'audio', maxCount: 1 },
]), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const mode = req.body?.mode === 'replace' ? 'replace' : 'mute';
    const videoFile = req.files?.video?.[0];
    if (!videoFile) return res.status(400).json({ error: 'Video file is required' });
    if (mode === 'replace' && !req.files?.audio?.[0]) {
      return res.status(400).json({ error: 'Audio file is required for replace mode' });
    }

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, videoFile);
      let audioPath = null;
      if (mode === 'replace') {
        const af = req.files.audio[0];
        const aext = af.mimetype?.includes('wav') ? '.wav'
          : af.mimetype?.includes('mpeg') || af.mimetype?.includes('mp3') ? '.mp3'
            : af.mimetype?.includes('mp4') || af.mimetype?.includes('m4a') ? '.m4a'
              : '.mp3';
        audioPath = path.join(dir, `audio_in${aext}`);
        await fs.writeFile(audioPath, af.buffer);
      }
      const outputPath = path.join(dir, 'audio_out.mp4');
      await muteOrReplaceAudio(inputPath, outputPath, { mode, audioPath });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, mode === 'mute' ? 'muted.mp4' : 'audio-replaced.mp4');
  } catch (err) {
    console.error('[videos/audio]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/speed', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const speed = Number(req.body?.speed);
    if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
      return res.status(400).json({ error: 'speed must be a number between 0.25 and 4' });
    }

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'speed.mp4');
      await changeVideoSpeed(inputPath, outputPath, { speed });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'speed.mp4');
  } catch (err) {
    console.error('[videos/speed]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/overlay', upload.fields([
  { name: 'video', maxCount: 1 },
  { name: 'image', maxCount: 1 },
]), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const videoFile = req.files?.video?.[0];
    const imageFile = req.files?.image?.[0];
    if (!videoFile) return res.status(400).json({ error: 'Video file is required' });
    if (!imageFile) return res.status(400).json({ error: 'Image file is required (logo/watermark)' });

    const position = req.body?.position || 'bottom-right';
    const scalePct = req.body?.scalePct != null ? Number(req.body.scalePct) : 20;
    const opacity = req.body?.opacity != null ? Number(req.body.opacity) : 0.85;

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, videoFile);
      const imgExt = imageFile.mimetype?.includes('png') ? '.png'
        : imageFile.mimetype?.includes('webp') ? '.webp'
          : '.jpg';
      const imagePath = path.join(dir, `overlay${imgExt}`);
      await fs.writeFile(imagePath, imageFile.buffer);
      const outputPath = path.join(dir, 'overlay.mp4');
      await overlayImage(inputPath, imagePath, outputPath, { position, scalePct, opacity });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'overlay.mp4');
  } catch (err) {
    console.error('[videos/overlay]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/extract-audio', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const format = req.body?.format === 'wav' ? 'wav' : 'mp3';

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, `audio.${format}`);
      await extractAudio(inputPath, outputPath, format);
      return readOutputFile(outputPath);
    });

    res.setHeader('Content-Type', format === 'wav' ? 'audio/wav' : 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="audio.${format}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) {
    console.error('[videos/extract-audio]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/thumbnail', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const timeSec = Number(req.body?.timeSec ?? 1);

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'thumb.jpg');
      await captureThumbnail(inputPath, outputPath, timeSec);
      return readOutputFile(outputPath);
    });

    sendImageBuffer(res, buffer);
  } catch (err) {
    console.error('[videos/thumbnail]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/annotate', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'text is required' });

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'annotated.mp4');
      const style = captionStyleFromBody(req.body);
      const fadeInSec = req.body?.fadeInSec != null && req.body.fadeInSec !== '' ? Number(req.body.fadeInSec) : 0;
      const fadeOutSec = req.body?.fadeOutSec != null && req.body.fadeOutSec !== '' ? Number(req.body.fadeOutSec) : 0;
      await annotateVideo(inputPath, outputPath, {
        text,
        position: style.position || req.body?.position || 'bottom-center',
        fontSize: style.fontSize,
        fontColor: style.fontColor,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        backgroundColor: style.backgroundColor,
        backgroundTransparent: style.backgroundTransparent,
        fadeInSec: Number.isFinite(fadeInSec) ? Math.min(30, Math.max(0, fadeInSec)) : 0,
        fadeOutSec: Number.isFinite(fadeOutSec) ? Math.min(30, Math.max(0, fadeOutSec)) : 0,
      }, dir);
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'annotated.mp4');
  } catch (err) {
    console.error('[videos/annotate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const MAX_GEMINI_AUDIO_BYTES = 18 * 1024 * 1024;

router.post('/transcribe', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available' });

    if (runtimeConfig.isLocal) {
      const text = await withTempDir(async (dir) => {
        const inputPath = await writeUpload(dir, req.file);
        const wavPath = path.join(dir, 'audio.wav');
        await extractWav16k(inputPath, wavPath);
        return transcribeWav(wavPath);
      });
      return res.json({ text, source: 'whisper-local' });
    }

    // Hosted (e.g. Railway): no whisper-cli binary available — extract the
    // audio track and use Gemini's audio understanding to return SRT directly.
    const srt = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const audioPath = path.join(dir, 'audio.mp3');
      await extractAudio(inputPath, audioPath, 'mp3');
      const buf = await fs.readFile(audioPath);
      if (buf.length > MAX_GEMINI_AUDIO_BYTES) {
        throw new Error('Video is too long for hosted transcription (audio track over ~18MB) — trim it first, or use local dev with whisper-cli.');
      }
      const raw = await transcribeAudioWithGemini(req.user.id, buf.toString('base64'), 'audio/mp3');
      return normalizeSrt(raw);
    });

    res.json({ srt, source: 'gemini' });
  } catch (err) {
    console.error('[videos/transcribe]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/burn-captions', upload.fields([{ name: 'video', maxCount: 1 }, { name: 'srt', maxCount: 1 }]), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const videoFile = req.files?.video?.[0];
    const srtFile = req.files?.srt?.[0];
    const srtText = req.body?.srtText;
    if (!videoFile) return res.status(400).json({ error: 'video is required' });
    if (!srtFile && !srtText?.trim()) return res.status(400).json({ error: 'srt file or srtText is required' });

    const style = captionStyleFromBody(req.body);

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, videoFile);
      const srtPath = path.join(dir, 'captions.srt');
      if (srtFile) {
        await fs.writeFile(srtPath, srtFile.buffer);
      } else {
        await fs.writeFile(srtPath, String(srtText), 'utf8');
      }
      const outputPath = path.join(dir, 'captioned.mp4');
      await burnSubtitles(inputPath, srtPath, outputPath, style, dir);
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'captioned.mp4');
  } catch (err) {
    console.error('[videos/burn-captions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/normalize', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const preset = ['quiet', 'normal', 'loud'].includes(req.body?.preset) ? req.body.preset : 'normal';

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'normalized.mp4');
      await normalizeAudioLoudness(inputPath, outputPath, { preset });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'normalized.mp4');
  } catch (err) {
    console.error('[videos/normalize]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/togif', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const fps = req.body?.fps ? Number(req.body.fps) : 12;
    const width = req.body?.width ? Number(req.body.width) : 480;
    const startSec = req.body?.startSec != null && req.body.startSec !== '' ? Number(req.body.startSec) : 0;
    const endSec = req.body?.endSec != null && req.body.endSec !== '' ? Number(req.body.endSec) : null;

    const buffer = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const outputPath = path.join(dir, 'output.gif');
      await videoToGif(inputPath, outputPath, { fps, width, startSec, endSec });
      return readOutputFile(outputPath);
    });

    res.setHeader('Content-Type', 'image/gif');
    res.setHeader('Content-Disposition', 'inline; filename="output.gif"');
    res.setHeader('Cache-Control', 'no-store');
    res.send(buffer);
  } catch (err) {
    console.error('[videos/togif]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/slideshow', upload.fields([
  { name: 'images', maxCount: 20 },
  { name: 'audio', maxCount: 1 },
]), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const images = req.files?.images || [];
    if (images.length < 2) return res.status(400).json({ error: 'Upload at least two images (field name: images)' });
    if (images.length > 20) return res.status(400).json({ error: 'Maximum 20 images' });

    const secondsPerSlide = req.body?.secondsPerSlide ? Number(req.body.secondsPerSlide) : 3;
    const aspect = req.body?.aspect || '9:16';
    const mode = req.body?.mode === 'crop' ? 'crop' : 'pad';
    const crossfadeSec = req.body?.crossfadeSec != null && req.body.crossfadeSec !== '' ? Number(req.body.crossfadeSec) : 0;
    const audioFile = req.files?.audio?.[0] || null;

    const buffer = await withTempDir(async (dir) => {
      const imagePaths = [];
      for (let i = 0; i < images.length; i += 1) {
        const f = images[i];
        if (!f?.buffer?.length) throw new Error(`Image #${i + 1} is empty`);
        const ext = f.mimetype?.includes('png') ? '.png' : f.mimetype?.includes('webp') ? '.webp' : '.jpg';
        const imgPath = path.join(dir, `slide_src_${i}${ext}`);
        await fs.writeFile(imgPath, f.buffer);
        imagePaths.push(imgPath);
      }

      let audioPath = null;
      if (audioFile) {
        const aext = audioFile.mimetype?.includes('wav') ? '.wav'
          : audioFile.mimetype?.includes('mp4') || audioFile.mimetype?.includes('m4a') ? '.m4a'
            : '.mp3';
        audioPath = path.join(dir, `slideshow_audio${aext}`);
        await fs.writeFile(audioPath, audioFile.buffer);
      }

      const outputPath = path.join(dir, 'slideshow.mp4');
      await buildSlideshow(imagePaths, outputPath, {
        secondsPerSlide, aspect, mode, crossfadeSec, audioPath,
      });
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'slideshow.mp4');
  } catch (err) {
    console.error('[videos/slideshow]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Export for Social — one video in, N social-preset MP4s out. Reuses
// Reframe's aspect-crop logic for each preset and Clip's trim-from-start
// for presets with a sensible duration cap (Reels/TikTok/Shorts). Renders
// are cached server-side (short TTL) so the client can download individual
// files or a zip without re-uploading — mirrors the videoJobCache pattern
// used by Generate.
router.post('/export-social', upload.single('video'), async (req, res) => {
  try {
    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available on this server' });

    const videoFile = req.file;
    if (!videoFile?.buffer?.length) return res.status(400).json({ error: 'Video file is required' });

    let presetIds = [];
    try {
      const parsed = JSON.parse(req.body?.presets || '[]');
      if (Array.isArray(parsed)) presetIds = parsed.map((p) => String(p));
    } catch {
      presetIds = String(req.body?.presets || '').split(',').map((s) => s.trim()).filter(Boolean);
    }
    presetIds = [...new Set(presetIds)].filter((id) => SOCIAL_EXPORT_PRESETS[id]);
    if (!presetIds.length) return res.status(400).json({ error: 'Select at least one preset to export' });

    const focus = ['center', 'top', 'bottom', 'left', 'right'].includes(req.body?.focus) ? req.body.focus : 'center';

    const items = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, videoFile);
      const probe = await probeVideo(inputPath);
      const results = [];
      for (let i = 0; i < presetIds.length; i += 1) {
        const presetId = presetIds[i];
        const preset = SOCIAL_EXPORT_PRESETS[presetId];

        let workingPath = inputPath;
        if (preset.maxDurationSec && probe.duration && probe.duration > preset.maxDurationSec) {
          const trimmedPath = path.join(dir, `${presetId}_trimmed.mp4`);
          // eslint-disable-next-line no-await-in-loop
          await clipVideo(inputPath, trimmedPath, { startSec: 0, endSec: preset.maxDurationSec });
          workingPath = trimmedPath;
        }

        const outPath = path.join(dir, `${presetId}.mp4`);
        // eslint-disable-next-line no-await-in-loop
        await reframeVideo(workingPath, outPath, { aspect: preset.aspect, mode: 'crop', focus });
        // eslint-disable-next-line no-await-in-loop
        const outProbe = await probeVideo(outPath);
        // eslint-disable-next-line no-await-in-loop
        const buffer = await readOutputFile(outPath);

        const thumbPath = path.join(dir, `${presetId}_thumb.jpg`);
        // eslint-disable-next-line no-await-in-loop
        await captureThumbnail(outPath, thumbPath, Math.min(1, outProbe.duration || 0));
        // eslint-disable-next-line no-await-in-loop
        const thumbBuf = await readOutputFile(thumbPath);

        results.push({
          presetId,
          label: preset.label,
          aspect: preset.aspect,
          width: outProbe.width,
          height: outProbe.height,
          durationSec: outProbe.duration,
          bytes: buffer.length,
          fileName: `${presetId}-${outProbe.width}x${outProbe.height}.mp4`,
          buffer,
          thumbnailDataUrl: `data:image/jpeg;base64,${thumbBuf.toString('base64')}`,
        });
      }
      return results;
    });

    const exportId = crypto.randomBytes(8).toString('hex');
    rememberExportSocial(exportId, req.user.id, items);
    pruneExportSocialCache();

    res.json({
      exportId,
      count: items.length,
      items: items.map(({ buffer, ...rest }) => rest),
    });
  } catch (err) {
    console.error('[videos/export-social]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/export-social/:exportId/file/:presetId', async (req, res) => {
  try {
    const entry = getExportSocial(req.params.exportId, req.user.id);
    if (!entry) return res.status(404).json({ error: 'Export not found or expired — run export again' });
    const item = entry.items.find((i) => i.presetId === req.params.presetId);
    if (!item) return res.status(404).json({ error: 'Preset not found in this export' });
    sendVideoBuffer(res, item.buffer, item.fileName);
  } catch (err) {
    console.error('[videos/export-social/file]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/export-social/:exportId/zip', async (req, res) => {
  try {
    const entry = getExportSocial(req.params.exportId, req.user.id);
    if (!entry) return res.status(404).json({ error: 'Export not found or expired — run export again' });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="export-social.zip"');
    res.setHeader('Cache-Control', 'no-store');

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (err) => {
      console.error('[videos/export-social/zip]', err.message);
      if (!res.headersSent) res.status(500);
      res.end();
    });
    archive.pipe(res);
    entry.items.forEach((item) => archive.append(item.buffer, { name: item.fileName }));
    await archive.finalize();
  } catch (err) {
    console.error('[videos/export-social/zip]', err.message);
    if (!res.headersSent) res.status(500).json({ error: err.message });
    else res.end();
  }
});

module.exports = router;
