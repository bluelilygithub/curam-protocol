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
const MAX_OPTIONS = 6; // 3 to start, up to 3 more with "make another"
const MIN_MUSIC_ONLY_S = 5;
const ROOT = path.join(os.tmpdir(), 'vault-music');

const jobs = new Map();

/** A seed the person typed: a whole number from 1 to 2^30, else null (a random one is used). */
function normalizeSeed(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 && n <= 2 ** 30 ? n : null;
}

/** Length asked for in "music from a description" (no video): seconds, MIN_MUSIC_ONLY_S..maxS, else null. */
function normalizeMusicLength(v, maxS) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n >= MIN_MUSIC_ONLY_S && n <= maxS ? Math.round(n * 10) / 10 : null;
}

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
    mode: job.mode,
    hasVideo: job.mode !== 'music-only',
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
      rev: o.rev || 0,
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
 * No `videoFile` = music only ("from a description"): `durationS` is the length asked for, there is no video to mix with.
 * `seed` (optional) is the first option's seed, so a result can be reproduced from the same prompt.
 */
async function createJob({ userId, videoFile, durationS, hasAudio, promptInfo, providerName, trackFile = null, seed = null }) {
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
  let videoPath = null;
  if (videoFile) {
    videoPath = path.join(dir, `source${videoFile.ext}`);
    await fs.writeFile(videoPath, videoFile.buffer);
  }

  let trackPath = null;
  if (trackFile) {
    trackPath = path.join(dir, `track${trackFile.ext || ''}`);
    await fs.writeFile(trackPath, trackFile.buffer);
  }

  const baseSeed = seed || crypto.randomInt(1, 2 ** 30 - 7919 * OPTION_COUNT);
  const optionCount = trackFile ? 1 : OPTION_COUNT;
  const job = {
    id,
    userId,
    dir,
    videoPath,
    durationS,
    hasAudio,
    source: trackFile ? 'upload' : 'generated',
    mode: videoFile ? 'video' : 'music-only',
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
      rev: 0, // bumped each time the option is made again, so cached previews of the old one are not reused
      status: 'pending',
      fitPath: null,
      error: null,
      loops: null,
    })),
  };
  jobs.set(id, job);
  return job;
}

/**
 * Generate + fit ONE option into job.dir/option_<n>.wav. Never throws: a failure is recorded on the option.
 * `deps` ({ fit, gate }) lets tests run it without ffmpeg.
 */
async function runOption(job, provider, opt, deps = {}) {
  const fit = deps.fit || fitMusicToDuration;
  const gate = deps.gate || videoJobGate;
  const clipS = Math.max(1, Math.min(provider.maxClipS, Math.ceil(job.durationS)));
  opt.status = 'generating';
  opt.error = null;
  try {
    const wav = await provider.generate({ prompt: job.prompt, durationS: clipS, seed: opt.seed });
    opt.status = 'fitting';
    const rawPath = path.join(job.dir, `raw_${opt.n}.wav`);
    await fs.writeFile(rawPath, wav);
    const fitPath = path.join(job.dir, `option_${opt.n}.wav`);
    const result = await gate.run(() => fit(rawPath, fitPath, job.durationS));
    opt.fitPath = fitPath;
    opt.loops = result.copies;
    opt.rev = (opt.rev || 0) + 1;
    opt.status = 'ready';
  } catch (err) {
    opt.status = 'failed';
    opt.error = String(err.message || err).slice(0, 300);
  }
}

/** Job status from its options: done if any is ready, else failed with the first reason. */
function settleJob(job) {
  const ok = job.options.filter((o) => o.status === 'ready').length;
  if (ok === 0) {
    job.status = 'failed';
    job.error = job.options.find((o) => o.error)?.error || 'No music could be generated';
  } else {
    job.status = 'done';
    job.error = null;
  }
  job.stage = job.status === 'done' ? 'Ready' : 'Failed';
}

/** Generate + fit every option; one failing option never sinks the others. */
async function runJob(job, provider, deps = {}) {
  let finished = 0;
  const setStage = () => { job.stage = `Generated ${finished} of ${job.options.length} options…`; };
  setStage();
  await Promise.all(job.options.map(async (opt) => {
    await runOption(job, provider, opt, deps);
    finished += 1;
    setStage();
  }));
  settleJob(job);
}

/** Make option `n` again with a fresh (or the given) seed; the other options are left alone. */
async function regenerateOption(job, provider, n, { seed = null, deps = {} } = {}) {
  const opt = job.options[n];
  if (!opt) throw Object.assign(new Error('Unknown option'), { code: 'NO_OPTION' });
  opt.seed = seed || crypto.randomInt(1, 2 ** 30);
  job.status = 'running';
  job.stage = `Making a new version of option ${n + 1}…`;
  await runOption(job, provider, opt, deps);
  settleJob(job);
}

/** Add one more option (up to MAX_OPTIONS) from the same description, with a fresh (or the given) seed. */
async function addOption(job, provider, { seed = null, deps = {} } = {}) {
  if (job.options.length >= MAX_OPTIONS) {
    throw Object.assign(new Error(`That is the most options one set can have (${MAX_OPTIONS}). Make a new set instead.`), { code: 'MAX_OPTIONS' });
  }
  const opt = { n: job.options.length, seed: seed || crypto.randomInt(1, 2 ** 30), rev: 0, status: 'pending', fitPath: null, error: null, loops: null };
  job.options.push(opt);
  job.status = 'running';
  job.stage = `Making option ${opt.n + 1}…`;
  await runOption(job, provider, opt, deps);
  settleJob(job);
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
  OPTION_COUNT, MAX_OPTIONS, MIN_MUSIC_ONLY_S, JOB_TTL_MS,
  createJob, runJob, runOption, regenerateOption, addOption, runUploadedTrackJob, getJob, removeJob, publicJob, sweep, jobRoot,
  normalizeSeed, normalizeMusicLength,
};
