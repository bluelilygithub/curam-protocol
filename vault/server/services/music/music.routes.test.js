// node server/services/music/music.routes.test.js
// Route plumbing for music made without a video (and making an option again / adding one), through the real router with
// ffmpeg, the music provider and the fit step faked, so it runs anywhere. The real-ffmpeg run is music.e2e.test.js.
const path = require('path');
const fsp = require('fs/promises');
const V = path.join(__dirname, '../..');
const dbPath = require.resolve(path.join(V, 'db'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: { query: async () => ({ rows: [] }) } } };
require(path.join(V, 'services/videoFfmpeg')).checkFfmpeg = async () => true;
require(path.join(V, 'services/music/musicProviders')).getMusicProvider = () => ({
  maxClipS: 30,
  describe: () => ({ name: 'smoke', model: 'x', configured: true }),
  generate: async () => Buffer.from('RIFFsmoke'),
});
require(path.join(V, 'services/music/musicFit')).fitMusicToDuration = async (_raw, out, durationS) => {
  await fsp.writeFile(out, `fit ${durationS}`);
  return { copies: Math.ceil(durationS / 30) };
};
const express = require('express');
const router = require(path.join(V, 'routes/music.js'));
const app = express();
app.use(express.json());
app.use((req, _r, n) => { req.user = { id: 1 }; n(); });
app.use('/api/music', router);

const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', name, extra); };
async function waitDone(base, id) {
  for (let i = 0; i < 40; i++) {
    const j = await (await fetch(`${base}/jobs/${id}`)).json();
    if (j.status !== 'running') return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout');
}
const form = (o) => { const fd = new FormData(); for (const [k, v] of Object.entries(o)) fd.append(k, v); return fd; };

const s = app.listen(0, async () => {
  const base = `http://localhost:${s.address().port}/api/music`;
  try {
    let r = await fetch(`${base}/status`); const st = await r.json();
    check('status carries music-only limits', st.musicOnly?.minSec === 5 && st.musicOnly?.maxSec === 300 && st.maxOptions === 6 && st.costPerRunUsd === null, JSON.stringify(st.musicOnly));

    r = await fetch(`${base}/jobs`, { method: 'POST', body: form({ mood: 'lofi-chill' }) });
    check('no video and no length -> 400', r.status === 400, (await r.json()).error);
    r = await fetch(`${base}/jobs`, { method: 'POST', body: form({ mood: 'lofi-chill', durationS: '2' }) });
    check('length under the minimum -> 400', r.status === 400, (await r.json()).error);
    r = await fetch(`${base}/jobs`, { method: 'POST', body: form({ mood: 'lofi-chill', durationS: '9999' }) });
    check('length over the maximum -> 400', r.status === 400);
    r = await fetch(`${base}/jobs`, { method: 'POST', body: form({ durationS: '30' }) });
    check('length but no mood/prompt -> 400', r.status === 400, (await r.json()).error);

    r = await fetch(`${base}/jobs`, { method: 'POST', body: form({ mood: 'lofi-chill', durationS: '45', seed: '1000' }) });
    const job = await r.json();
    check('music-only job accepted', r.status === 202 && job.mode === 'music-only' && job.hasVideo === false && job.durationS === 45 && job.options.length === 3, JSON.stringify({ mode: job.mode, dur: job.durationS }));
    check('typed seed is option 1\'s seed', job.options[0].seed === 1000);
    const done = await waitDone(base, job.id);
    check('job done, 3 ready', done.status === 'done' && done.options.every((o) => o.status === 'ready' && o.rev === 1), done.options.map((o) => o.status).join());

    r = await fetch(`${base}/jobs/${job.id}/options/0/audio`); check('audio download works', r.status === 200);
    r = await fetch(`${base}/jobs/${job.id}/options/0/preview`); check('video preview -> 409 (no video)', r.status === 409, (await r.json()).error);
    r = await fetch(`${base}/jobs/${job.id}/options/0/video`); check('video export -> 409', r.status === 409);
    r = await fetch(`${base}/jobs/${job.id}/options/0/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); check('save to library -> 409', r.status === 409);
    r = await fetch(`${base}/jobs/${job.id}/voiceover`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'hello' }) }); check('voiceover -> 409', r.status === 409, (await r.json()).error);

    r = await fetch(`${base}/jobs/${job.id}/options/9/regenerate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); check('regenerate unknown option -> 404', r.status === 404);
    r = await fetch(`${base}/jobs/${job.id}/options/1/regenerate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seed: '555' }) });
    const re = await r.json();
    check('regenerate accepted, job running', r.status === 202 && re.status === 'running', re.status);
    r = await fetch(`${base}/jobs/${job.id}/options/1/regenerate`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('regenerate while running -> 409', r.status === 409 || r.status === 202);
    const after = await waitDone(base, job.id);
    check('option 2 remade: seed 555, rev 2, others untouched', after.options[1].seed === 555 && after.options[1].rev === 2 && after.options[0].rev === 1 && after.options[2].rev === 1, JSON.stringify(after.options.map((o) => [o.seed, o.rev])));

    for (let i = 0; i < 3; i++) {
      r = await fetch(`${base}/jobs/${job.id}/options`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      check(`add option ${i + 4} accepted`, r.status === 202, String(r.status));
      await waitDone(base, job.id);
    }
    r = await fetch(`${base}/jobs/${job.id}/options`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    check('add a 7th option -> 409', r.status === 409, (await r.json()).error);
    const final = await (await fetch(`${base}/jobs/${job.id}`)).json();
    check('six options, all ready', final.options.length === 6 && final.options.every((o) => o.status === 'ready'));
    r = await fetch(`${base}/jobs/${job.id}`, { method: 'DELETE' }); check('delete', r.status === 200);
  } catch (e) {
    console.log('ERROR', e);
    results.push(false);
  }
  console.log(`${results.filter(Boolean).length}/${results.length} passed`);
  s.close();
  process.exit(results.every(Boolean) ? 0 : 1);
});
