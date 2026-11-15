'use strict';

// Sketchbook: the person's own cartoon pictures. Mounted at /api/sketchbook behind the `sketchbook` flag. Every query is by the signed-in
// person; a sketch that is not theirs is simply "not found". Delete goes into the shared recycle bin (30 days). See docs/sketchbook.md.
//
//   GET    /api/sketchbook                         list (no pictures, only previews)
//   GET    /api/sketchbook/options                 the styles, pen colours and shapes the page offers
//   GET    /api/sketchbook/cost?kind=draw|change   what one picture costs and how much of today's image limit is left
//   POST   /api/sketchbook/draw                    describe a scene -> a new sketch  { description, style?, penColor?, aspect?, title? }  (paid)
//   GET    /api/sketchbook/:id                     one sketch with its picture and a summary of earlier pictures
//   POST   /api/sketchbook/:id/change              change the same picture  { instruction?, style?, penColor?, baseUpdatedAt? }  (paid)
//   GET    /api/sketchbook/:id/notes               the person's notes that link back to the sketch (made by To Notes)
//   POST   /api/sketchbook/:id/pack                social media pack  { sizes: [{ id, mode }], zip? }  (free: crop or fit, made here)
//   POST   /api/sketchbook/:id/pack/:size/redraw   redraw the sketch for one social size's shape  (paid)
//   GET    /api/sketchbook/:id/versions/:vid       one earlier picture
//   POST   /api/sketchbook/:id/versions/:vid/restore  put an earlier picture back  { baseUpdatedAt? }
//   PUT    /api/sketchbook/:id                     rename  { title }
//   POST   /api/sketchbook/:id/duplicate           a copy
//   DELETE /api/sketchbook/:id                     into the recycle bin

const express = require('express');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const sketches = require('../services/sketchbook');
const engine = require('../services/sketchbookEngine');
const pack = require('../services/sketchbookPack');
const { aiLimiter } = require('../middleware/aiRateLimit');
const { makePaidGuard, spentLast24h, dailyCapUsd } = require('../middleware/graphicsLimits');

const router = express.Router();
const BIN_TYPE = 'sketch';
const BIN_MAX_BYTES = 16 * 1024 * 1024; // a picture plus its kept earlier pictures; the bin's default limit is 5 MB
const paidGuard = makePaidGuard({ pool });

// Two different failures, told apart so the person is never misled about money: the image service failing (nothing is logged as spent,
// because spend is only recorded after a picture comes back) and a failure AFTER a picture came back (it may have been charged).
function serviceFailure(err, where) {
  getLogger().error({ err }, `[sketchbook] ${where}: the image service failed`);
  const m = String((err && err.message) || '');
  let reason = 'The image service could not draw that just now.';
  if (/FAL_API_KEY/i.test(m)) reason = 'The image service is not set up on this server (no FAL key).';
  else if (/(404)/.test(m)) reason = 'The image service does not recognise the graphics model set in Settings (it must be a FAL model name such as fal-ai/flux/dev).';
  else if (/not supported yet/i.test(m)) reason = 'The graphics model chosen in Settings is not one Sketchbook can use (it needs a FAL or local ComfyUI model).';
  else if (/balance|exhausted|locked|quota|billing/i.test(m)) reason = 'The image service refused the request because its account is out of credit or locked.';
  else if (/timed? ?out|ETIMEDOUT|ECONNRESET|fetch failed|abort/i.test(m)) reason = 'The image service did not answer in time.';
  else if (/did not return|safety|nsfw|blocked/i.test(m)) reason = 'The image service did not return a picture (it may have blocked the request).';
  return new sketches.SketchError(`${reason} No spend was recorded for this attempt. Try again in a minute.`, 502, 'IMAGE_SERVICE');
}
function notSavedFailure(err, where) {
  getLogger().error({ err }, `[sketchbook] ${where}: the picture came back but could not be saved`);
  return new sketches.SketchError('The picture was drawn but could not be saved, so you may have been charged for it. Check Usage (feature graphics_sketchbook) and try again.', 500, 'NOT_SAVED');
}

function fail(res, err, where) {
  if (err instanceof sketches.SketchError) return res.status(err.status).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  // a restricted idea (Settings -> content restrictions): same answer shape as Graphics Generate
  if (err && err.code === 'CONTENT_RESTRICTED') return res.status(err.status || 422).json({ error: err.message, code: err.code, matches: err.matches });
  getLogger().error({ err }, `[sketchbook] ${where}`);
  return res.status(500).json({ error: 'Something went wrong with your sketches. Try again.' });
}

const idOf = (req) => {
  const n = Number(req.params.id);
  return Number.isInteger(n) && n > 0 ? n : 0;
};

router.get('/', async (req, res) => {
  try {
    res.json({ sketches: await sketches.list(pool, req.user.id), max: sketches.MAX_SKETCHES_PER_USER });
  } catch (err) { fail(res, err, 'list'); }
});

router.get('/options', (req, res) => {
  res.json({
    styles: sketches.STYLE_IDS.map((id) => ({ id, label: sketches.STYLES[id].label, tip: sketches.STYLES[id].tip })),
    penColors: sketches.PEN_COLOR_IDS.map((id) => ({ id, label: sketches.PEN_COLORS[id].label, hex: sketches.PEN_COLORS[id].hex })),
    aspects: Object.entries(sketches.ASPECTS).map(([id, a]) => ({ id, label: a.label, width: a.width, height: a.height })),
    versionsKept: sketches.MAX_VERSIONS,
    packSizes: pack.PACK_SIZES,
    packModes: pack.MODE_IDS.map((id) => ({ id, label: pack.MODES[id] })),
  });
});

router.get('/cost', async (req, res) => {
  try {
    const kind = req.query.kind === 'change' ? 'change' : 'draw';
    const p = await engine.price(req.user.id, kind);
    const cap = dailyCapUsd();
    let spent = 0;
    try { spent = await spentLast24h(pool, req.user.id); } catch { /* the note then shows the price without the remaining limit */ }
    res.json({ kind, usd: p.usd, local: !!p.local, estimate: !!p.estimate, capUsd: cap, spentUsd: Number(spent.toFixed(4)), remainingUsd: cap > 0 ? Math.max(0, Number((cap - spent).toFixed(4))) : null });
  } catch (err) { fail(res, err, 'cost'); }
});

// Describe a scene or a theory -> one new picture. The limits that guard Graphics' paid tools apply: two image jobs at once, the daily spend
// cap, the AI rate limit and the admin's content restrictions.
router.post('/draw', aiLimiter, paidGuard, async (req, res) => {
  try {
    const b = req.body || {};
    const description = sketches.cleanDescription(b.description);
    const style = sketches.checkStyle(b.style);
    const penColor = sketches.checkPenColor(b.penColor);
    const aspect = sketches.ASPECTS[sketches.checkAspect(b.aspect)];
    await sketches.checkRoom(pool, req.user.id); // before paying for a picture there is no room to keep
    const prompt = sketches.buildDrawPrompt({ description, style, penColor });
    let made;
    try { made = await engine.draw({ userId: req.user.id, prompt, width: aspect.width, height: aspect.height }); }
    catch (err) { if (err && err.code === 'CONTENT_RESTRICTED') throw err; throw serviceFailure(err, 'draw'); }
    try {
      const pic = await engine.normalise(made.imageDataUrl);
      const sketch = await sketches.create(pool, req.user.id, {
        title: b.title ? b.title : sketches.titleFromDescription(description), description, style, penColor,
        image: pic.imageDataUrl, thumbnail: await engine.thumbnail(pic.imageDataUrl), width: pic.width, height: pic.height, seed: made.seed, model: made.model,
      });
      return res.status(201).json({ sketch: await sketches.get(pool, req.user.id, sketch.id), costUsd: made.costUsd });
    } catch (err) {
      if (err instanceof sketches.SketchError) throw err;
      throw notSavedFailure(err, 'draw');
    }
  } catch (err) { fail(res, err, 'draw'); }
});

router.post('/:id/change', aiLimiter, paidGuard, async (req, res) => {
  try {
    const b = req.body || {};
    const cur = await sketches.get(pool, req.user.id, idOf(req));
    const style = sketches.checkStyle(b.style, cur.style);
    const penColor = sketches.checkPenColor(b.penColor, cur.penColor);
    const changeStyle = style !== cur.style || (style === 'pen' && penColor !== cur.penColor);
    const hasInstruction = typeof b.instruction === 'string' && b.instruction.trim() !== '';
    if (!hasInstruction && !changeStyle) throw new sketches.SketchError('Say what you want changed first.');
    const instruction = hasInstruction ? sketches.cleanInstruction(b.instruction) : sketches.restyleInstruction(style);
    const prompt = sketches.buildChangePrompt({ instruction, style, penColor, changeStyle });
    let made;
    try { made = await engine.change({ userId: req.user.id, prompt, imageDataUrl: cur.image }); }
    catch (err) { if (err && err.code === 'CONTENT_RESTRICTED') throw err; throw serviceFailure(err, 'change'); }
    try {
      const pic = await engine.normalise(made.imageDataUrl);
      const sketch = await sketches.applyChange(pool, req.user.id, cur.id, {
        image: pic.imageDataUrl, thumbnail: await engine.thumbnail(pic.imageDataUrl), note: hasInstruction ? instruction : `the look changed to ${sketches.STYLES[style].label.toLowerCase()}`,
        style, penColor, seed: made.seed, model: made.model, baseUpdatedAt: b.baseUpdatedAt,
      });
      return res.json({ sketch: await sketches.get(pool, req.user.id, sketch.id), costUsd: made.costUsd });
    } catch (err) {
      if (err instanceof sketches.SketchError) throw err; // e.g. 409: changed in another tab (the picture was paid for; the message says to reload)
      throw notSavedFailure(err, 'change');
    }
  } catch (err) { fail(res, err, 'change'); }
});

// Social media pack: every ticked size made from the sketch (crop or fit, or a stored redraw). Free and quick (sharp on a 1024px picture),
// so it sits behind no spend guard. With zip: true the answer is one ZIP instead of the pictures, so the page does not carry them twice.
router.post('/:id/pack', async (req, res) => {
  try {
    const b = req.body || {};
    const asked = Array.isArray(b.sizes) ? b.sizes : [];
    const seen = new Set();
    const wanted = [];
    for (const s of asked) {
      const sid = String((s && s.id) || '');
      if (!pack.sizeById(sid) || seen.has(sid)) continue;
      seen.add(sid);
      wanted.push({ id: sid, mode: pack.checkMode(s.mode) });
    }
    if (!wanted.length) throw new sketches.SketchError('Tick at least one size first.');
    const row = await sketches.getForPack(pool, req.user.id, idOf(req));
    const redraws = pack.parseRedraws(row.packRedraws);
    const made = [];
    for (const w of wanted) {
      // eslint-disable-next-line no-await-in-loop
      made.push(await pack.makeSize({ sketch: row, sizeId: w.id, mode: w.mode, redraws }));
    }
    if (b.zip) {
      const archiver = require('archiver');
      const archive = archiver('zip', { zlib: { level: 6 } });
      const chunks = [];
      archive.on('data', (c) => chunks.push(c));
      const done = new Promise((resolve, reject) => { archive.on('end', resolve); archive.on('error', reject); });
      made.forEach((m) => archive.append(m.buf, { name: m.item.fileName }));
      await archive.finalize();
      await done;
      const zip = Buffer.concat(chunks);
      return res.json({ count: made.length, bytes: zip.length, fileName: `${pack.slug(row.title)}-social-pack.zip`, zipDataUrl: `data:application/zip;base64,${zip.toString('base64')}` });
    }
    return res.json({ items: made.map((m) => ({ ...m.item, imageDataUrl: `data:image/jpeg;base64,${m.buf.toString('base64')}` })) });
  } catch (err) { fail(res, err, 'pack'); }
});

// Redraw the sketch for one size's shape: the sketch is put on white paper of that shape and the edit model extends the scene into the
// white. One paid image request, the same guard and usage log as Change it. The redraw is kept on the sketch (one per size; a new redraw
// replaces the old one) and the pack uses it from then on.
router.post('/:id/pack/:size/redraw', aiLimiter, paidGuard, async (req, res) => {
  try {
    const sizeId = String(req.params.size || '');
    if (!pack.sizeById(sizeId)) throw new sketches.SketchError('That size is not in the pack.');
    const row = await sketches.getForPack(pool, req.user.id, idOf(req));
    const prompt = pack.buildRedrawPrompt({ styleWords: sketches.styleWords(row.style, row.penColor), sizeId });
    const padded = await pack.padForRedraw(row.image, sizeId);
    let made;
    try { made = await engine.change({ userId: req.user.id, prompt, imageDataUrl: padded }); }
    catch (err) { if (err && err.code === 'CONTENT_RESTRICTED') throw err; throw serviceFailure(err, 'pack redraw'); }
    try {
      const image = await pack.shapeRedraw(made.imageDataUrl, sizeId);
      await sketches.saveRedraw(pool, req.user.id, row.id, sizeId, { image, from: pack.imageKey(row.image) });
      const fresh = await sketches.getForPack(pool, req.user.id, row.id);
      const m = await pack.makeSize({ sketch: fresh, sizeId, mode: 'redrawn', redraws: pack.parseRedraws(fresh.packRedraws) });
      return res.json({ item: { ...m.item, imageDataUrl: `data:image/jpeg;base64,${m.buf.toString('base64')}` }, costUsd: made.costUsd });
    } catch (err) {
      if (err instanceof sketches.SketchError) throw err;
      throw notSavedFailure(err, 'pack redraw');
    }
  } catch (err) { fail(res, err, 'pack redraw'); }
});

router.post('/:id/duplicate', async (req, res) => {
  try {
    res.status(201).json({ sketch: await sketches.duplicate(pool, req.user.id, idOf(req)) });
  } catch (err) { fail(res, err, 'duplicate'); }
});

router.get('/:id/notes', async (req, res) => {
  try {
    res.json({ notes: await sketches.linkedNotes(pool, req.user.id, idOf(req)) });
  } catch (err) { fail(res, err, 'notes'); }
});

router.get('/:id/versions/:vid', async (req, res) => {
  try {
    res.json({ version: await sketches.getVersion(pool, req.user.id, idOf(req), String(req.params.vid)) });
  } catch (err) { fail(res, err, 'version'); }
});

router.post('/:id/versions/:vid/restore', async (req, res) => {
  try {
    const row = await sketches.restoreVersion(pool, req.user.id, idOf(req), String(req.params.vid), { baseUpdatedAt: (req.body || {}).baseUpdatedAt });
    res.json({ sketch: await sketches.get(pool, req.user.id, row.id) });
  } catch (err) { fail(res, err, 'restore'); }
});

router.get('/:id', async (req, res) => {
  try {
    res.json({ sketch: await sketches.get(pool, req.user.id, idOf(req)) });
  } catch (err) { fail(res, err, 'get'); }
});

router.put('/:id', async (req, res) => {
  try {
    res.json({ sketch: await sketches.rename(pool, req.user.id, idOf(req), (req.body || {}).title) });
  } catch (err) { fail(res, err, 'rename'); }
});

router.delete('/:id', async (req, res) => {
  const bin = require('../services/recycleBin');
  require('../services/recycleBin/adapters');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM sketches WHERE id = $1 AND "userId" = $2 FOR UPDATE', [idOf(req), req.user.id]);
    if (!rows[0]) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'That sketch was not found.' }); }
    const s = rows[0];
    // the social pack redraws can be remade; they are left out when keeping them would make the sketch too big for the bin
    if (JSON.stringify(s).length > BIN_MAX_BYTES * 0.9) s.packRedraws = '{}';
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: BIN_TYPE, id: s.id, title: s.title,
      detail: s.changeCount ? `${s.changeCount} change${s.changeCount === 1 ? '' : 's'}` : 'cartoon',
      payload: { sketch: s }, maxBytes: BIN_MAX_BYTES,
    });
    await db.query('DELETE FROM sketches WHERE id = $1 AND "userId" = $2', [s.id, req.user.id]);
    await db.query('COMMIT');
    return res.json({ ok: true, binId });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    if (err && err.code === 'TOO_LARGE') return res.status(413).json({ error: 'This sketch is too big to keep in the recycle bin, so it was not deleted. Download it first.' });
    return fail(res, err, 'delete');
  } finally { db.release(); }
});

module.exports = router;
