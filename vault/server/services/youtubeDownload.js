'use strict';

// YouTube Download and Chapters, with yt-dlp (installed in the image by Dockerfile.base / requirements.txt; Guitar uses it too) and ffmpeg (joins
// the video and sound streams, makes MP3s).
// Download: a background job per person saves the video (or its audio) to a temp folder, the page polls its progress, then fetches the file once
// and it is deleted. Chapters: the video's own chapters, from the timestamps in its description (how YouTube makes them), else from yt-dlp, which
// also sees YouTube's automatic chapters. Pure parts are tested in youtubeDownload.test.js; `run` is injected so the test needs no yt-dlp.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const KINDS = {
  video720: { label: 'Video up to 720p (MP4)', args: ['-f', 'bv*[height<=720][ext=mp4]+ba[ext=m4a]/b[height<=720][ext=mp4]/bv*[height<=720]+ba/b[height<=720]/b', '--merge-output-format', 'mp4'] },
  video1080: { label: 'Video up to 1080p (MP4)', args: ['-f', 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/bv*[height<=1080]+ba/b[height<=1080]/b', '--merge-output-format', 'mp4'] },
  audio: { label: 'Audio only (MP3)', args: ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0'] },
};
const MAX_FILESIZE = '2G';
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const KEEP_MS = 30 * 60 * 1000; // a finished file nobody fetched is deleted after this
const MAX_RUNNING = 2;          // across everyone: each download uses bandwidth, disk and ffmpeg
// yt-dlp's own default player clients: Guitar's fixed list (tv_embedded,android_vr,web) got HTTP 403 on video data with yt-dlp 2026.10.26.
const BASE_ARGS = ['--no-playlist', '--no-warnings', '--socket-timeout', '30'];

const urlOf = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

/** yt-dlp's error output -> a sentence for the person. Order matters: the bot check also mentions "sign in". */
function friendlyError(text) {
  const s = String(text || '').toLowerCase();
  if (s.includes('not a bot') || s.includes('failed to extract any player response')) return 'YouTube blocked this server as a bot, which happens on cloud hosting. Setting YOUTUBE_COOKIES on the server usually fixes it; otherwise try again later.';
  if (s.includes('confirm your age') || s.includes('age-restricted') || s.includes('age restricted') || s.includes('inappropriate for some users')) return 'This video is age-restricted, so YouTube will not give it to the server without a signed-in account (YOUTUBE_COOKIES).';
  if (s.includes('private video') || s.includes('video unavailable') || s.includes('removed by the uploader')) return 'This video is private or no longer available.';
  if (s.includes('is live') || s.includes('live event will begin') || s.includes('premieres in')) return 'Live streams and premieres cannot be downloaded until they have finished.';
  if (s.includes('larger than max-filesize') || s.includes('file is larger than')) return `This video is bigger than the ${MAX_FILESIZE}B limit. Try 720p or Audio only.`;
  if (s.includes('ffmpeg not found') || s.includes('ffprobe and ffmpeg not found')) return 'ffmpeg is not installed on this server, so the video and sound cannot be joined (or the MP3 made).';
  if (s.includes('http error 403')) return 'YouTube refused the download (403). Updating yt-dlp on the server or setting YOUTUBE_COOKIES usually fixes it.';
  if (s.includes('enoent') || (s.includes('not found') && s.includes('yt-dlp'))) return 'yt-dlp is not installed on this server.';
  return 'The download failed. YouTube may have refused it; try again later or pick another quality.';
}

/** "[download]  42.3% of ..." -> 42.3, else null. */
function parseProgress(line) {
  const m = /\[download\]\s+([\d.]+)%/.exec(String(line));
  return m ? Math.min(100, Number(m[1])) : null;
}

/** A file name from the video title: letters, numbers and simple punctuation, at most 120 characters. */
function safeName(title, ext) {
  const base = String(title || 'youtube-video').normalize('NFKD').replace(/[^\w\s.,()&'-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'youtube-video';
  return `${base}.${ext}`;
}

const toSeconds = (ts) => ts.split(':').reduce((n, p) => n * 60 + Number(p), 0);

/**
 * Chapters from a description, YouTube's rule: lines that start with a time, the first at 0:00, at least three, each later than the last.
 * Returns [{ start, title }] or [].
 */
function parseDescriptionChapters(description) {
  const out = [];
  for (const line of String(description || '').split(/\r?\n/)) {
    const m = /^\s*[[(]?((?:\d{1,2}:)?\d{1,2}:\d{2})[\])]?\s*[-–—:|.]?\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const start = toSeconds(m[1]);
    if (out.length && start <= out[out.length - 1].start) continue;
    out.push({ start, title: m[2].slice(0, 200) });
  }
  return out.length >= 3 && out[0].start === 0 ? out : [];
}

/** yt-dlp's info JSON -> [{ start, title }]. */
function chaptersFromInfo(info) {
  const list = (info && Array.isArray(info.chapters)) ? info.chapters : [];
  return list.filter((c) => c && Number.isFinite(c.start_time)).map((c) => ({ start: Math.floor(c.start_time), title: String(c.title || '').slice(0, 200) || 'Chapter' }));
}

/** Runs yt-dlp with the server's YouTube cookies (if set). Resolves { code, stdout, tail }; onLine gets every output line. */
function runYtDlp(args, { onLine = () => {}, timeoutMs = RUN_TIMEOUT_MS, maxStdout = 20 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    let cookieFile = null;
    const b64 = (process.env.YOUTUBE_COOKIES || '').trim();
    const full = [...args];
    if (b64) {
      try {
        cookieFile = path.join(os.tmpdir(), `yt_cookies_${crypto.randomUUID()}.txt`);
        fs.writeFileSync(cookieFile, Buffer.from(b64, 'base64'), { mode: 0o600 });
        full.unshift('--cookies', cookieFile);
      } catch { cookieFile = null; }
    }
    let stdout = '';
    let tail = '';
    let partial = '';
    const done = (code) => {
      clearTimeout(timer);
      if (cookieFile) fs.rm(cookieFile, { force: true }, () => {});
      resolve({ code, stdout, tail });
    };
    let child;
    try { child = spawn('yt-dlp', full, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { tail = String(e.message); return done(-1); }
    const timer = setTimeout(() => { tail += '\ntimed out'; child.kill('SIGKILL'); }, timeoutMs);
    const feed = (chunk, isOut) => {
      const s = chunk.toString();
      if (isOut && stdout.length < maxStdout) stdout += s;
      tail = (tail + s).slice(-2000);
      const lines = (partial + s).split(/\r?\n|\r/);
      partial = lines.pop();
      for (const l of lines) onLine(l);
    };
    child.stdout.on('data', (c) => feed(c, true));
    child.stderr.on('data', (c) => feed(c, false));
    child.on('error', (e) => { tail += `\n${e.message}`; });
    child.on('close', (code) => done(code));
  });
}

/** The download jobs. Kept in memory: a restart loses running jobs (the page says so) and their temp folders are swept. */
function createDownloads({ run = runYtDlp, tmpRoot = os.tmpdir(), now = () => Date.now() } = {}) {
  const jobs = new Map(); // id -> job
  const pub = (j) => ({ id: j.id, videoId: j.videoId, kind: j.kind, status: j.status, percent: j.percent, error: j.error, filename: j.filename, size: j.size, startedAt: j.startedAt });

  function remove(id) {
    const j = jobs.get(id);
    if (!j) return;
    jobs.delete(id);
    if (j.dir) fs.rm(j.dir, { recursive: true, force: true }, () => {});
  }

  function sweep() {
    for (const [id, j] of jobs) if (j.finishedAt && now() - j.finishedAt > KEEP_MS) remove(id);
  }
  const timer = setInterval(sweep, 10 * 60 * 1000);
  if (timer.unref) timer.unref();

  async function work(j) {
    const r = await run([...BASE_ARGS, ...KINDS[j.kind].args, '--max-filesize', MAX_FILESIZE, '--newline', '-o', path.join(j.dir, 'video.%(ext)s'), urlOf(j.videoId)], {
      onLine: (l) => { const p = parseProgress(l); if (p != null) j.percent = p; },
    });
    j.finishedAt = now();
    const file = fs.existsSync(j.dir) ? fs.readdirSync(j.dir).find((f) => f.startsWith('video.') && !/\.(part|ytdl|temp)$|\.f\d+\./.test(f)) : null;
    if (r.code !== 0 || !file) {
      j.status = 'error';
      j.error = friendlyError(r.tail);
      fs.rm(j.dir, { recursive: true, force: true }, () => {});
      j.dir = null;
      return;
    }
    j.file = path.join(j.dir, file);
    j.size = fs.statSync(j.file).size;
    j.filename = safeName(j.title, path.extname(file).slice(1) || 'mp4');
    j.percent = 100;
    j.status = 'done';
  }

  /** Starts a download. Returns { job } or { error, status }. One at a time per person, MAX_RUNNING across the server. */
  function start(userId, videoId, kind, title) {
    sweep();
    if (!KINDS[kind]) return { error: 'Pick video 720p, video 1080p or audio only.', status: 400 };
    const running = [...jobs.values()].filter((j) => j.status === 'running');
    if (running.some((j) => j.userId === userId)) return { error: 'You already have a download running. Wait for it to finish.', status: 409 };
    if (running.length >= MAX_RUNNING) return { error: 'The server is busy with other downloads. Try again in a few minutes.', status: 429 };
    const id = crypto.randomUUID();
    const j = { id, userId, videoId, kind, title, status: 'running', percent: 0, error: null, filename: null, size: null, startedAt: now(), finishedAt: null, dir: fs.mkdtempSync(path.join(tmpRoot, 'vault-ytdl-')), file: null };
    jobs.set(id, j);
    work(j).catch((e) => { j.status = 'error'; j.error = friendlyError(e.message); j.finishedAt = now(); });
    return { job: pub(j) };
  }

  /** The job, only for its owner. */
  function status(userId, id) {
    const j = jobs.get(id);
    return j && j.userId === userId ? pub(j) : null;
  }

  /** The finished file for its owner: { file, filename } or null. The caller sends it, then calls remove(id). */
  function file(userId, id) {
    const j = jobs.get(id);
    return j && j.userId === userId && j.status === 'done' && j.file ? { file: j.file, filename: j.filename } : null;
  }

  return { start, status, file, remove, sweep, _jobs: jobs };
}

/** The video's chapters: [{ start, title }], from its description (fetched by the caller) or else from yt-dlp. Cached per video for 6 hours. */
function createChapters({ run = runYtDlp, now = () => Date.now() } = {}) {
  const cache = new Map(); // videoId -> { at, value }
  const TTL = 6 * 60 * 60 * 1000;
  return async function chapters(videoId, description) {
    const hit = cache.get(videoId);
    if (hit && now() - hit.at < TTL) return hit.value;
    let value = { chapters: parseDescriptionChapters(description), source: 'description' };
    if (!value.chapters.length) {
      const r = await run([...BASE_ARGS, '--skip-download', '--dump-single-json', urlOf(videoId)], { timeoutMs: 60 * 1000 });
      if (r.code === 0) {
        try { value = { chapters: chaptersFromInfo(JSON.parse(r.stdout)), source: 'youtube' }; } catch { value = { chapters: [], source: null }; }
      } else {
        return { chapters: [], source: null, error: friendlyError(r.tail) }; // not cached: a bot block may clear
      }
    }
    if (cache.size > 500) cache.clear();
    cache.set(videoId, { at: now(), value });
    return value;
  };
}

module.exports = { KINDS, MAX_FILESIZE, friendlyError, parseProgress, safeName, parseDescriptionChapters, chaptersFromInfo, runYtDlp, createDownloads, createChapters };
