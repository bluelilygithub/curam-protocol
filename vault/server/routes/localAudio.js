'use strict';

const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const multer = require('multer');
const { runtimeConfig } = require('../config/runtime');
const {
  REF_AUDIO_PATH,
  ensureVoiceDir,
  getLocalVoiceStatus,
  getReferencePaths,
  saveProfile,
} = require('../services/localVoiceProfile');

const router = express.Router();
const F5_SPEAK_SCRIPT = path.join(__dirname, '..', 'scripts', 'f5_speak.py');
const MAX_SPEAK_CHARS = 320;
const F5_SPEAK_STEPS = Number(process.env.LOCAL_TTS_STEPS || 4);
const F5_CHUNK_CHARS = Number(process.env.LOCAL_TTS_CHUNK_CHARS || 100);
let activeSpeakJob = null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function defaultModelPath() {
  return path.join(os.homedir(), '.local/share/whisper.cpp/models/ggml-base.en.bin');
}

function extensionForMime(mime = '') {
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  if (mime.includes('wav')) return '.wav';
  return '.webm';
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (_) {
    return false;
  }
}

function cleanTranscript(text = '') {
  return String(text)
    .split('\n')
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/g, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function localPythonCommand() {
  return process.env.LOCAL_TTS_PYTHON || process.env.LOCAL_PYTHON || 'python3';
}

function chunkTextForTTS(text, maxLen = F5_CHUNK_CHARS) {
  const source = String(text || '').trim();
  if (!source) return [];
  if (source.length <= maxLen) return [source];

  const chunks = [];
  let remaining = source;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('. ', maxLen);
    if (splitAt < Math.floor(maxLen * 0.45)) splitAt = remaining.lastIndexOf(' ', maxLen);
    if (splitAt < 1) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function transcribeWavFile(wavPath) {
  const whisperCommand = process.env.LOCAL_WHISPER_COMMAND || 'whisper-cli';
  const modelPath = process.env.LOCAL_WHISPER_MODEL || defaultModelPath();
  const { stdout } = await execFileAsync(whisperCommand, [
    '-m', modelPath,
    '-f', wavPath,
    '-l', 'en',
    '-nt',
    '-np',
  ], { timeout: 180000 });
  return cleanTranscript(stdout);
}

async function convertToReferenceWav(inputPath, outputPath) {
  const ffmpegCommand = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
  await execFileAsync(ffmpegCommand, [
    '-y',
    '-i', inputPath,
    '-ac', '1',
    '-ar', '24000',
    '-sample_fmt', 's16',
    '-t', '30',
    outputPath,
  ]);
}

async function generateCloneSpeech(text, refAudioPath, refText, outputPath) {
  const pythonCommand = localPythonCommand();
  await execFileAsync(pythonCommand, [
    F5_SPEAK_SCRIPT,
    '--text', text,
    '--ref-audio', refAudioPath,
    '--ref-text', refText,
    '--output', outputPath,
    '--steps', String(F5_SPEAK_STEPS),
  ], { timeout: 600000, maxBuffer: 20 * 1024 * 1024 });
}

router.get('/tts/status', async (req, res) => {
  if (!runtimeConfig.isLocal) {
    return res.status(404).json({ error: 'Local voice cloning is only available in local mode.' });
  }
  try {
    const status = await getLocalVoiceStatus();
    res.json({
      ...status,
      pythonCommand: localPythonCommand(),
      engine: 'f5-tts-mlx',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tts/profile', async (req, res) => {
  if (!runtimeConfig.isLocal) {
    return res.status(404).json({ error: 'Local voice cloning is only available in local mode.' });
  }
  try {
    const status = await getLocalVoiceStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/tts/profile', upload.single('audio'), async (req, res) => {
  if (!runtimeConfig.isLocal) {
    return res.status(404).json({ error: 'Local voice cloning is only available in local mode.' });
  }

  const refTextInput = String(req.body?.refText || '').trim();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-local-voice-'));

  try {
    await ensureVoiceDir();
    let refText = refTextInput;

    if (req.file?.buffer?.length) {
      const inputPath = path.join(tempDir, `source${extensionForMime(req.file.mimetype)}`);
      await fs.writeFile(inputPath, req.file.buffer);
      await convertToReferenceWav(inputPath, REF_AUDIO_PATH);
      if (!refText) {
        refText = await transcribeWavFile(REF_AUDIO_PATH);
      }
    }

    if (!refText) {
      return res.status(400).json({ error: 'Reference transcript is required. Paste what you said in the recording, or upload audio to auto-transcribe.' });
    }

    if (!(await pathExists(REF_AUDIO_PATH))) {
      return res.status(400).json({ error: 'Reference audio is required. Upload a short recording of your voice.' });
    }

    await saveProfile({
      refText,
      updatedAt: new Date().toISOString(),
    });

    const status = await getLocalVoiceStatus();
    res.json({ ok: true, ...status });
  } catch (err) {
    console.error('[local-audio/tts/profile] failed:', err.stderr || err.message);
    res.status(500).json({ error: err.message || 'Could not save local voice profile.' });
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

router.post('/tts/speak', async (req, res) => {
  if (!runtimeConfig.isLocal) {
    return res.status(404).json({ error: 'Local voice cloning is only available in local mode.' });
  }

  if (activeSpeakJob) {
    return res.status(429).json({
      error: 'Local cloned voice is already generating. Wait for the current request to finish before starting another.',
    });
  }

  const reference = await getReferencePaths();
  if (!reference) {
    return res.status(503).json({ error: 'Local voice profile is not configured. Add reference audio and transcript in Settings → Profile.' });
  }

  const text = String(req.body?.text || '').trim();
  if (!text) return res.status(400).json({ error: 'Text is required.' });

  const clipped = text.length > MAX_SPEAK_CHARS
    ? `${text.slice(0, MAX_SPEAK_CHARS).trim()}…`
    : text;
  const chunks = chunkTextForTTS(clipped);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-local-tts-'));
  const chunkPaths = [];
  const job = { tempDir, startedAt: Date.now() };
  activeSpeakJob = job;

  try {
    console.log(`[local-audio/tts/speak] start chunks=${chunks.length} chars=${clipped.length}`);
    for (let i = 0; i < chunks.length; i += 1) {
      const chunkPath = path.join(tempDir, `chunk-${i}.wav`);
      const chunkStarted = Date.now();
      await generateCloneSpeech(chunks[i], reference.refAudioPath, reference.refText, chunkPath);
      console.log(`[local-audio/tts/speak] chunk ${i + 1}/${chunks.length} done in ${Date.now() - chunkStarted}ms`);
      chunkPaths.push(chunkPath);
    }

    let outputPath = chunkPaths[0];
    if (chunkPaths.length > 1) {
      outputPath = path.join(tempDir, 'combined.wav');
      const ffmpegCommand = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
      const listPath = path.join(tempDir, 'concat.txt');
      const listBody = chunkPaths.map((chunkPath) => `file '${chunkPath.replace(/'/g, "'\\''")}'`).join('\n');
      await fs.writeFile(listPath, listBody, 'utf8');
      await execFileAsync(ffmpegCommand, [
        '-y',
        '-f', 'concat',
        '-safe', '0',
        '-i', listPath,
        '-c', 'copy',
        outputPath,
      ], { timeout: 120000 });
    }

    const audio = await fs.readFile(outputPath);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    console.log(`[local-audio/tts/speak] complete in ${Date.now() - job.startedAt}ms`);
    return res.send(audio);
  } catch (err) {
    console.error('[local-audio/tts/speak] failed:', err.stderr || err.message);
    const detail = String(err.stderr || err.message || '').trim();
    return res.status(500).json({
      error: detail
        ? `Local cloned voice generation failed: ${detail.slice(0, 240)}`
        : 'Local cloned voice generation failed.',
    });
  } finally {
    if (activeSpeakJob === job) activeSpeakJob = null;
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

router.post('/transcribe', upload.single('audio'), async (req, res) => {
  if (!runtimeConfig.isLocal) {
    return res.status(404).json({ error: 'Local audio transcription is only available in local mode.' });
  }

  if (!req.file?.buffer?.length) {
    return res.status(400).json({ error: 'Audio file is required.' });
  }

  const whisperCommand = process.env.LOCAL_WHISPER_COMMAND || 'whisper-cli';
  const ffmpegCommand = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
  const modelPath = process.env.LOCAL_WHISPER_MODEL || defaultModelPath();

  if (!(await pathExists(modelPath))) {
    return res.status(503).json({ error: `Local Whisper model not found at ${modelPath}` });
  }

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vault-local-stt-'));
  const inputPath = path.join(tempDir, `source${extensionForMime(req.file.mimetype)}`);
  const wavPath = path.join(tempDir, 'converted.wav');

  try {
    await fs.writeFile(inputPath, req.file.buffer);
    await execFileAsync(ffmpegCommand, [
      '-y',
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      wavPath,
    ]);

    const { stdout } = await execFileAsync(whisperCommand, [
      '-m', modelPath,
      '-f', wavPath,
      '-l', 'en',
      '-nt',
      '-np',
    ]);

    const transcript = cleanTranscript(stdout);
    if (!transcript) {
      return res.status(422).json({ error: 'No speech detected in the recording.' });
    }
    return res.json({ transcript });
  } catch (err) {
    console.error('[local-audio/transcribe] failed:', err.stderr || err.message);
    return res.status(500).json({ error: 'Local transcription failed.' });
  } finally {
    fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
});

module.exports = router;
