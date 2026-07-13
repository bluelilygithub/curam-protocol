'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs/promises');
const { runtimeConfig } = require('../config/runtime');
const { saveAsset, listAssets, getAsset, deleteAsset } = require('../services/videoLibraryService');
const { startVideoGeneration, pollVideoGeneration, getVideoGenerateConfig, buildYoutubeContext, fetchPlaybackVideo } = require('../services/videoGenerateService');
const {
  checkFfmpeg,
  MAX_VIDEO_BYTES,
  extensionForMime,
  probeVideo,
  clipVideo,
  convertVideo,
  extractAudio,
  captureThumbnail,
  annotateVideo,
  burnSubtitles,
  extractWav16k,
  withTempDir,
  readOutputFile,
  execFileAsync,
} = require('../services/videoFfmpeg');

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
  res.json({
    ffmpeg,
    maxUploadMb: Math.round(MAX_VIDEO_BYTES / (1024 * 1024)),
    generate,
    transcribe: {
      available: runtimeConfig.isLocal && ffmpeg,
      note: runtimeConfig.isLocal
        ? 'Local whisper-cli when model is installed'
        : 'Paste SRT on hosted Vault — auto-transcribe is local-only for now',
    },
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
      await annotateVideo(inputPath, outputPath, {
        text,
        position: req.body?.position || 'bottom',
        fontSize: style.fontSize,
        fontColor: style.fontColor,
        fontFamily: style.fontFamily,
        fontWeight: style.fontWeight,
        backgroundColor: style.backgroundColor,
        backgroundTransparent: style.backgroundTransparent,
      }, dir);
      return readOutputFile(outputPath);
    });

    sendVideoBuffer(res, buffer, 'annotated.mp4');
  } catch (err) {
    console.error('[videos/annotate]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/transcribe', upload.single('video'), async (req, res) => {
  try {
    if (!runtimeConfig.isLocal) {
      return res.status(503).json({
        error: 'Auto-transcribe is available in local dev with whisper-cli. On hosted Vault, paste an SRT file in Captions.',
      });
    }

    const ffmpeg = await checkFfmpeg();
    if (!ffmpeg) return res.status(503).json({ error: 'ffmpeg is not available' });

    const text = await withTempDir(async (dir) => {
      const inputPath = await writeUpload(dir, req.file);
      const wavPath = path.join(dir, 'audio.wav');
      await extractWav16k(inputPath, wavPath);
      return transcribeWav(wavPath);
    });

    res.json({ text });
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

module.exports = router;
