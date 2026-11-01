'use strict';

// "Generate a transcript with AI" for a YouTube video that has none: the plan shown before the person agrees (length, cost, wait), the background
// job that asks Gemini to watch the video, and the saved result. A transcript is saved per person and video in youtube_transcripts as soon as it
// comes back, whether or not the window is still open, and every other part of the YouTube page (Transcript, Insights, Ask, saved videos) then
// uses it exactly like captions. Everything outside the database and the network is injected so it can be tested (youtubeAiJobs.test.js).

const T = require('./youtubeAiTranscript');

const JOB_KEEP_MS = 30 * 60 * 1000;

function createAiTranscripts({ pool, ytGet, getKey, getModelsForUser, logUsage, watchVideo, apiKey = () => process.env.GEMINI_API_KEY, now = () => Date.now() }) {
  const jobs = new Map(); // `${userId}:${videoId}` -> { status, startedAt, finishedAt, error, costUsd }
  const keyOf = (userId, videoId) => `${userId}:${videoId}`;

  function sweep() {
    for (const [k, j] of jobs) if (j.finishedAt && now() - j.finishedAt > JOB_KEEP_MS) jobs.delete(k);
  }

  async function stored(userId, videoId) {
    const { rows } = await pool.query(
      'SELECT title, segments, language, source, model, "durationSec", "costUsd", "createdAt" FROM youtube_transcripts WHERE "userId" = $1 AND "videoId" = $2',
      [userId, videoId]
    );
    return rows[0] || null;
  }

  async function savedIds(userId) {
    const { rows } = await pool.query('SELECT "videoId" FROM youtube_transcripts WHERE "userId" = $1', [userId]);
    return rows.map((r) => r.videoId);
  }

  async function remove(userId, videoId) {
    const r = await pool.query('DELETE FROM youtube_transcripts WHERE "userId" = $1 AND "videoId" = $2', [userId, videoId]);
    jobs.delete(keyOf(userId, videoId));
    return r.rowCount > 0;
  }

  async function videoFacts(videoId) {
    const data = await ytGet(`/youtube/v3/videos?part=snippet,contentDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(getKey())}`);
    const item = data && data.items && data.items[0];
    if (!item) return null;
    return { title: (item.snippet && item.snippet.title) || 'YouTube video', durationSec: T.parseIsoDuration(item.contentDetails && item.contentDetails.duration) };
  }

  /** What would happen if the person pressed Generate: everything the confirmation window shows. Never starts anything. */
  async function plan(userId, videoId) {
    const have = await stored(userId, videoId);
    if (have) return { available: false, saved: true, reason: 'A transcript is already saved for this video.' };
    const facts = await videoFacts(videoId);
    if (!facts) return { available: false, reason: 'YouTube does not show this video, so it cannot be transcribed.' };
    const { gemini: model } = await getModelsForUser(userId);
    const base = { title: facts.title, model: model || null };
    if (!apiKey()) return { ...base, available: false, reason: 'Gemini is not set up on this server (no key).' };
    if (!model) return { ...base, available: false, reason: 'No Gemini model is set up in Settings.' };
    if (facts.durationSec <= 0) return { ...base, available: false, reason: 'This looks like a live stream, which cannot be transcribed.' };
    const est = T.estimate({ durationSec: facts.durationSec, modelId: model });
    if (est.tooLong) return { ...base, ...est, available: false, reason: `Videos over ${T.formatLength(est.maxSeconds)} are not supported (this one is ${T.formatLength(est.durationSec)}).` };
    return { ...base, ...est, available: true };
  }

  async function run(userId, videoId, p) {
    const job = jobs.get(keyOf(userId, videoId));
    try {
      const out = await watchVideo({
        apiKey: apiKey(), model: p.model, url: `https://www.youtube.com/watch?v=${videoId}`, prompt: T.TRANSCRIBE_PROMPT,
        maxOutputTokens: Math.min(60000, Math.max(4000, p.tokensOut * 2)),
      });
      logUsage({ userId, model: p.model, inputTokens: out.inputTokens, outputTokens: out.outputTokens, feature: 'youtube-transcript' });
      const parsed = T.normalizeTranscript(out.text, { durationSec: p.durationSec });
      if (!parsed) throw new Error('Gemini listened but did not find any speech to write down.');
      const { calculateCost } = require('./costCalculator');
      const costUsd = calculateCost(p.model, out.inputTokens, out.outputTokens);
      await pool.query(
        `INSERT INTO youtube_transcripts ("userId","videoId",title,segments,language,source,model,"durationSec","costUsd")
         VALUES ($1,$2,$3,$4,'', 'gemini', $5, $6, $7)
         ON CONFLICT ("userId","videoId") DO UPDATE SET title=EXCLUDED.title, segments=EXCLUDED.segments, source=EXCLUDED.source, model=EXCLUDED.model,
           "durationSec"=EXCLUDED."durationSec", "costUsd"=EXCLUDED."costUsd", "createdAt"=NOW()`,
        [userId, videoId, p.title, JSON.stringify(parsed.segments), p.model, p.durationSec, costUsd]
      );
      Object.assign(job, { status: 'done', finishedAt: now(), costUsd, cutOff: parsed.cutOff });
    } catch (err) {
      Object.assign(job, { status: 'error', finishedAt: now(), error: String((err && err.message) || 'Could not write the transcript.').slice(0, 300) });
    }
  }

  /** Start the job. Returns { started: true } or { error, status } (not allowed, busy, already saved). The work carries on after this returns. */
  async function start(userId, videoId) {
    sweep();
    for (const [k, j] of jobs) if (k.startsWith(`${userId}:`) && j.status === 'running') return { error: 'Another transcript is already being written. Wait for it to finish.', status: 409 };
    const p = await plan(userId, videoId);
    if (p.saved) return { error: p.reason, status: 409 };
    if (!p.available) return { error: p.reason, status: 400 };
    jobs.set(keyOf(userId, videoId), { status: 'running', startedAt: now(), finishedAt: null, error: null, costUsd: null });
    run(userId, videoId, p); // deliberately not awaited
    return { started: true };
  }

  /** Where things stand for one video: the saved transcript (details only) and any job in the last half hour. */
  async function status(userId, videoId) {
    sweep();
    const have = await stored(userId, videoId);
    const j = jobs.get(keyOf(userId, videoId));
    return {
      saved: have ? { source: have.source, model: have.model, durationSec: have.durationSec, costUsd: Number(have.costUsd) || 0, createdAt: have.createdAt, lines: Array.isArray(have.segments) ? have.segments.length : 0 } : null,
      job: j ? { status: j.status, startedAt: j.startedAt, error: j.error, costUsd: j.costUsd, cutOff: !!j.cutOff } : null,
    };
  }

  return { plan, start, status, stored, savedIds, remove };
}

module.exports = { createAiTranscripts, JOB_KEEP_MS };
