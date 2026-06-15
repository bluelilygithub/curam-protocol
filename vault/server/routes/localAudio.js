'use strict';

const express = require('express');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const multer = require('multer');
const { runtimeConfig } = require('../config/runtime');

const router = express.Router();
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
