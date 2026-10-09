'use strict';

// In-memory job store for music generation. A job owns a temp directory holding the uploaded
// video, the 3 fitted music WAVs and any rendered previews. Nothing is persisted to the database;
// jobs expire after a TTL and their directories are deleted (also swept at start-up for
// directories orphaned by a restart).

const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { videoJobGate } = require('../videoJobGate');
const { fitMusicToDuration } = require('./musicFit');

const OPTION_COUNT = 3;
const JOB_TTL_MS = Number(process.env.MUSIC_JOB_TTL_MIN || 90) * 60 * 1000;
const MAX_ACTIVE_PER_USER = 2;
const MAX_STORED_JOBS = 30;
const ROOT = path.join(os.tmpdir(), 'vault-music');

const jobs = new Map();

function jobRoot() {
  return ROOT;
}

function publicJob(job) {
  return {
    id: job.id,
    status: job.status,
    stage: job.stage,
    durationS: job.durationS,
    hasAudio: job.hasAudio,
    source: job.source,
    voice: job.voice ? {
      source: job.voice.source,
      durationS: job.voice.durationS,
      text: job.voice.text || null,
      voice: job.voice.voiceId || null,
      rev: job.voice.rev,
    } : null,
    prompt: job.prompt,
    mood: job.mood,
    bpm: job.bpm,
    provider: job.providerName,
    options: job.options.map((o) => ({
      n: o.n,
      status: o.status,
      seed: o.seed,
      error: o.error || null,
      loops: o.loops ?? null,
    })),
    error: job.error || null,
    createdAt: job.createdAt,
  };
}

async function removeJob(job) {
  jobs.delete(job.id);
  await fs.rm(job.dir, { recursive: true, force: true }).catch(() => {});
}

function activeJobsFor(userId) {
  let n = 0;
  for (const j of jobs.values()) if (j.userId === userId && j.status === 'running') n += 1;
  return n;
}

/**
 * `trackFile` ({ buffer, ext }) = the user's own music: a single option is made from it and no
 * provider is involved. Without it, OPTION_COUNT generated options are made from `promptInfo`.
 */
async function createJob({ userId, videoFile, durationS, hasAudio, promptInfo, providerName, trackFile = null }) {
  if (activeJobsFor(userId) >= MAX_ACTIVE_PER_USER) {
    const err = new Error('You already have music generating — wait for it to finish first.');
    err.code = 'MUSIC_BUSY';
    throw err;
  }
  // Evict the oldest finished jobs when the store is full.
  if (jobs.size >= MAX_STORED_JOBS) {
    const oldest = [...jobs.values()].filter((j) => j.status !== 'running').sort((a, b) => a.createdAt - b.createdAt)[0];
    if (oldest) await removeJob(oldest);
  }
  const id = crypto.randomBytes(10).toString('hex');
  const dir = path.join(ROOT, id);
  await fs.mkdir(dir, { recursive: true });
  const videoPath = path.join(dir, `source${videoFile.ext}`);
  await fs.writeFile(videoPath, videoFile.buffer);

  let trackPath = null;
  if (trackFile) {
    trackPath = path.join(dir, `track${trackFile.ext || ''}`);
    await fs.writeFile(trackPath, trackFile.buffer);
  }

  const baseSeed = crypto.randomInt(1, 2 ** 30);
  const optionCount = trackFile ? 1 : OPTION_COUNT;
  const job = {
    id,
    userId,
    dir,
    videoPath,
    durationS,
    hasAudio,
    source: trackFile ? 'upload' : 'generated',
    trackPath,
    voice: null, // { path, source, durationS, text?, voiceId?, rev } once a voiceover is added
    prompt: promptInfo?.prompt || null,
    mood: promptInfo?.mood || null,
    bpm: promptInfo?.bpm || null,
    providerName,
    status: 'running',
    stage: 'Starting…',
    error: null,
    createdAt: Date.now(),
    options: Array.from({ length: optionCount }, (_, i) => ({
      n: i,
      seed: baseSeed + i * 7919,
      status: 'pending',
      fitPath: null,
      error: null,
      loops: null,
    })),
  };
  jobs.set(id, job);
  return job;
}

/** Generate + fit every option; one failing option never sinks the others. */
async function runJob(job, provider) {
  const clipS = Math.max(1, Math.min(provider.maxClipS, Math.ceil(job.durationS)));
  let finished = 0;
  const setStage = () => { job.stage = `Generated ${finished} of ${job.options.length} options…`; };
  setStage();

  await Promise.all(job.options.map(async (opt) => {
    opt.status = 'generating';
    try {
      const wav = await provider.generate({ prompt: job.prompt, durationS: clipS, seed: opt.seed });
      opt.status = 'fitting';
      const rawPath = path.join(job.dir, `raw_${opt.n}.wav`);
      await fs.writeFile(rawPath, wav);
      const fitPath = path.join(job.dir, `option_${opt.n}.wav`);
      const fit = await videoJobGate.run(() => fitMusicToDuration(rawPath, fitPath, job.durationS));
      opt.fitPath = fitPath;
      opt.loops = fit.copies;
      opt.status = 'ready';
    } catch (err) {
      opt.status = 'failed';
      opt.error = String(err.message || err).slice(0, 300);
    } finally {
      finished += 1;
      setStage();
    }
  }));

  const ok = job.options.filter((o) => o.status === 'ready').length;
  if (ok === 0) {
    job.status = 'failed';
    job.error = job.options.find((o) => o.error)?.error || 'No music could be generated';
  } else {
    job.status = 'done';
  }
  job.stage = job.status === 'done' ? 'Ready' : 'Failed';
}

/** The user's own track: fit it to the video (loop with crossfades if short, trim + fade) as the one option. */
async function runUploadedTrackJob(job) {
  const opt = job.options[0];
  job.stage = 'Fitting your track to the video…';
  opt.status = 'fitting';
  try {
    const fitPath = path.join(job.dir, 'option_0.wav');
    const fit = await videoJobGate.run(() => fitMusicToDuration(job.trackPath, fitPath, job.durationS));
    opt.fitPath = fitPath;
    opt.loops = fit.copies;
    opt.status = 'ready';
    job.status = 'done';
    job.stage = 'Ready';
  } catch (err) {
    opt.status = 'failed';
    opt.error = String(err.message || err).slice(0, 300);
    job.status = 'failed';
    job.error = opt.error;
    job.stage = 'Failed';
  }
}

function getJob(id, userId) {
  const job = jobs.get(String(id));
  if (!job || job.userId !== userId) return null;
  return job;
}

async function sweep(now = Date.now()) {
  for (const job of [...jobs.values()]) {
    if (job.status !== 'running' && now - job.createdAt > JOB_TTL_MS) await removeJob(job);
  }
  // Directories left by a previous process (the jobs map is gone but the files are not).
  try {
    for (const name of await fs.readdir(ROOT)) {
      if (jobs.has(name)) continue;
      const dir = path.join(ROOT, name);
      const stat = await fs.stat(dir).catch(() => null);
      if (stat && now - stat.mtimeMs > JOB_TTL_MS) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  } catch { /* ROOT may not exist yet */ }
}

const timer = setInterval(() => { sweep().catch(() => {}); }, 10 * 60 * 1000);
timer.unref?.();
sweep().catch(() => {});

module.exports = {
  OPTION_COUNT, JOB_TTL_MS, createJob, runJob, runUploadedTrackJob, getJob, removeJob, publicJob, sweep, jobRoot,
};
