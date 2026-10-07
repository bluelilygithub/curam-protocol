// node server/services/music/music.e2e.test.js
// End-to-end through the real route with the synthetic "fake" provider and real ffmpeg. Skips itself
// when ffmpeg/ffprobe are not installed (set LOCAL_FFMPEG_COMMAND / LOCAL_FFPROBE_COMMAND to point at them).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const FF = process.env.LOCAL_FFMPEG_COMMAND || 'ffmpeg';
const FP = process.env.LOCAL_FFPROBE_COMMAND || 'ffprobe';
if (spawnSync(FF, ['-version']).status !== 0 || spawnSync(FP, ['-version']).status !== 0) {
  console.log('skipped - ffmpeg/ffprobe not available');
  process.exit(0);
}
process.env.LOCAL_FFMPEG_COMMAND = FF;
process.env.LOCAL_FFPROBE_COMMAND = FP;
process.env.MUSIC_PROVIDER = 'fake';
process.on('unhandledRejection', (e) => { console.log('UNHANDLED', e && e.message); });
const dbPath = require.resolve('../../db');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => ({ rows: [] }) } } };
const { execFileSync } = require('child_process');
const express = require('express');
const router = require('../../routes/music.js');
const { probeVideo } = require('../videoFfmpeg');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-e2e-'));
const withAudio = path.join(dir, 'with_audio.mp4');
const noAudio = path.join(dir, 'no_audio.mp4');
// 12s video; "speech" = tone bursts at 2-4s and 7-9s so ducking has something to react to.
execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=12:r=25', '-f', 'lavfi', '-i', "sine=f=300:d=12,volume='if(between(t,2,4)+between(t,7,9),0.6,0.0)':eval=frame", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', withAudio], { stdio: 'ignore' });
execFileSync(FF, ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:d=5:r=25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', noAudio], { stdio: 'ignore' });

const app = express();
app.use(express.json());
app.use((req, _r, n) => { req.user = { id: 1 }; n(); });
app.use('/api/music', router);

async function post(base, file, extra = {}) {
  const fd = new FormData();
  fd.append('video', new Blob([fs.readFileSync(file)], { type: 'video/mp4' }), path.basename(file));
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  return fetch(`${base}/jobs`, { method: 'POST', body: fd });
}
async function waitDone(base, id) {
  for (let i = 0; i < 120; i++) {
    const j = await (await fetch(`${base}/jobs/${id}`)).json();
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('job timeout');
}
function lufs(file) {
  try {
    const out = require('child_process').spawnSync(FF, ['-hide_banner', '-nostats', '-i', file, '-af', 'ebur128=framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
    const m = out.match(/I:\s+(-?[\d.]+) LUFS/g);
    return m ? m[m.length - 1] : 'n/a';
  } catch { return 'err'; }
}

const s = app.listen(0, async () => {
  const base = `http://localhost:${s.address().port}/api/music`;
  const results = [];
  const check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, extra); };
  try {
    let r = await fetch(`${base}/status`); const st = await r.json();
    check('status', r.status === 200 && st.ffmpeg && st.provider.configured && st.moods.length === 8, JSON.stringify(st.provider));

    r = await post(base, withAudio, {}); check('no mood/prompt -> 400', r.status === 400, (await r.json()).error);
    r = await fetch(`${base}/jobs`, { method: 'POST' }); check('no file -> 400', r.status === 400);
    const junk = new FormData(); junk.append('video', new Blob(['hello'], { type: 'video/mp4' }), 'x.mp4'); junk.append('mood', 'lofi-chill');
    r = await fetch(`${base}/jobs`, { method: 'POST', body: junk }); check('junk file -> 400 (not hang)', r.status === 400, (await r.json()).error);

    for (const [label, file] of [['with-audio', withAudio], ['no-audio', noAudio]]) {
      r = await post(base, file, { mood: 'lofi-chill', bpm: '76' });
      const job = await r.json();
      check(`${label}: job accepted`, r.status === 202 && job.options.length === 3, `dur=${job.durationS?.toFixed(2)} hasAudio=${job.hasAudio}`);
      const done = await waitDone(base, job.id);
      check(`${label}: job done, 3 ready`, done.status === 'done' && done.options.every((o) => o.status === 'ready'), done.options.map((o) => `${o.status}/loops=${o.loops}`).join(' '));
      check(`${label}: prompt is instrumental + has bpm`, /instrumental only/.test(done.prompt) && /76 BPM/.test(done.prompt));

      // audio export: exact length
      r = await fetch(`${base}/jobs/${job.id}/options/0/audio`);
      const wav = path.join(dir, `${label}_a.wav`); fs.writeFileSync(wav, Buffer.from(await r.arrayBuffer()));
      const ap = await probeVideo(wav);
      check(`${label}: wav exact length`, r.status === 200 && Math.abs(ap.duration - done.durationS) < 0.05, `${ap.duration} vs ${done.durationS}`);

      for (const [kind, url] of [['preview', 'preview?volume=0.6&ducking=strong'], ['export', 'video?volume=0.8&ducking=light'], ['export-noduck', 'video?volume=1&ducking=off']]) {
        r = await fetch(`${base}/jobs/${job.id}/options/1/${url}`);
        const f = path.join(dir, `${label}_${kind}.mp4`); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer()));
        const vp = await probeVideo(f);
        check(`${label}: ${kind} mp4`, r.status === 200 && Math.abs(vp.duration - done.durationS) < 0.15 && vp.hasAudio && vp.width, `status=${r.status} dur=${vp.duration} ${vp.width}x${vp.height} ${lufs(f)}`);
      }
      r = await fetch(`${base}/jobs/${job.id}/options/9/audio`); check(`${label}: bad option -> 404`, r.status === 404);
      r = await fetch(`${base}/jobs/nope`); check(`${label}: unknown job -> 404`, r.status === 404);
      r = await fetch(`${base}/jobs/${job.id}`, { method: 'DELETE' }); check(`${label}: delete`, r.status === 200);
      r = await fetch(`${base}/jobs/${job.id}`); check(`${label}: gone after delete`, r.status === 404);
    }
  } catch (e) { console.log('E2E ERROR', e.stack || e.message); results.push(false); }
  console.log(results.every(Boolean) ? 'ALL PASS' : 'SOME FAILED');
  fs.rmSync(dir, { recursive: true, force: true });
  s.close(); process.exit(results.every(Boolean) ? 0 : 1);
});
