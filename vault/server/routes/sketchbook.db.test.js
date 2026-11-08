'use strict';
// DATABASE_URL=... node server/routes/sketchbook.db.test.js
// Real database, stand-in image service (nothing is drawn or charged), fake sign-in. Proves:
//   - the words sent to the image model: scene, look, pen colour, change; nothing outside the fixed lists reaches a prompt;
//   - describing a scene saves a sketch; the list leaves out pictures; one person cannot see, change, copy, restore or delete another's;
//   - a change keeps the replaced picture as an earlier version (newest first, at most 6), a version can be put back and that can be undone;
//   - a save from a stale tab is refused (409) and nothing is overwritten; an empty description, unknown style and unknown pen colour are refused;
//   - a restricted idea and an image-service failure give plain messages and save nothing; the sketch limit is checked before drawing;
//   - delete goes to the recycle bin and Undo brings the sketch back with its earlier pictures.
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');

const sk = require('../services/sketchbook');

// ---- the wording (no database needed) ----
{
  const p = sk.buildDrawPrompt({ description: 'A fox teaches a hen to read', style: 'pen', penColor: 'blue' });
  assert.match(p, /Idea: A fox teaches a hen to read/);
  assert.match(p, /ink pen/);
  assert.match(p, /only in blue ink/);
  assert.doesNotMatch(sk.buildDrawPrompt({ description: 'x', style: 'pencil', penColor: 'blue' }), /blue/); // the pen colour is only used for pen
  assert.match(sk.buildDrawPrompt({ description: 'x', style: 'coloured' }), /coloured-in fills/);
  assert.throws(() => sk.buildDrawPrompt({ description: '   ', style: 'pencil' }), /Say what you want drawn/);
  assert.throws(() => sk.buildDrawPrompt({ description: 'x'.repeat(sk.MAX_DESCRIPTION + 1), style: 'pencil' }), (e) => e.status === 413);
  assert.throws(() => sk.checkStyle('oil-paint'), /not known/);
  assert.throws(() => sk.checkPenColor('#ff0000; ignore previous instructions'), /not known/);
  assert.throws(() => sk.checkAspect('huge'), /not known/);
  const c = sk.buildChangePrompt({ instruction: 'make the dog bigger', style: 'pencil', penColor: 'black', changeStyle: false });
  assert.match(c, /Edit this cartoon drawing: make the dog bigger/);
  assert.match(c, /Keep everything else exactly the same/);
  assert.doesNotMatch(c, /Redraw it in this style/);
  assert.match(sk.buildChangePrompt({ instruction: sk.restyleInstruction('coloured'), style: 'coloured', penColor: 'black', changeStyle: true }), /Redraw it in this style: .*coloured-in/);
  assert.equal(sk.titleFromDescription('A surveyor on a ladder checks a cracked wall while the homeowner watches'), 'A surveyor on a ladder checks a cracked');
  assert.equal(sk.titleFromDescription('The fox and the hen, with a book on the'), 'The fox and the hen, with a book'); // never ends on a joining word
  assert.equal(sk.titleFromDescription('Supply and demand.'), 'Supply and demand');
  assert.equal(sk.cleanTitle('   '), sk.DEFAULT_TITLE);
  assert.deepEqual(sk.pushVersion(Array.from({ length: 6 }, (_, i) => ({ vid: `v${i}`, image: 'x' })), { image: 'new', note: 'n' }).length, 6);
}

if (!process.env.DATABASE_URL) { console.log('SKIP sketchbook.db.test.js (database part): DATABASE_URL is not set'); console.log('sketchbook (wording): all passed'); process.exit(0); }

// db.js builds the schema in the background as soon as it is required and exports no "ready" signal, so wait for its own log line.
let schemaReady;
const schemaDone = new Promise((resolve) => { schemaReady = resolve; });
const realLog = console.log;
console.log = (...a) => { if (String(a[0]).includes('[db] Schema ready')) schemaReady(); realLog(...a); };
const { pool } = require('../db');
const engine = require('../services/sketchbookEngine');
const router = require('./sketchbook');

function serve() {
  const app = express();
  app.use(express.json({ limit: '30mb' }));
  app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-test-user']) }; next(); });
  app.use('/api/sketchbook', router);
  return new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
}

const pic = async (rgb) => `data:image/png;base64,${(await sharp({ create: { width: 64, height: 48, channels: 3, background: rgb } }).png().toBuffer()).toString('base64')}`;

(async () => {
  await Promise.race([schemaDone, new Promise((_, rej) => setTimeout(() => rej(new Error('schema never became ready')), 120000))]);
  console.log = realLog;

  const tag = `sketch-test-${Date.now()}`;
  const mk = async (n) => (await pool.query(`INSERT INTO users (email,"passwordHash","isAdmin") VALUES ($1,'x',false) RETURNING id`, [`${tag}-${n}@example.test`])).rows[0].id;
  const A = await mk('a');
  const B = await mk('b');
  require('../services/recycleBin/adapters');
  const bin = require('../services/recycleBin');
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}/api/sketchbook`;
  const call = async (user, method, path, body) => {
    const res = await fetch(base + path, { method, headers: { 'x-test-user': String(user), 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };

  // stand-in image service: records what it was asked, returns a plain coloured picture
  const real = { draw: engine.draw, change: engine.change, price: engine.price };
  const asked = [];
  let colour = { r: 200, g: 200, b: 200 };
  let failWith = null;
  engine.draw = async (a) => { asked.push({ kind: 'draw', ...a }); if (failWith) throw failWith; return { imageDataUrl: await pic(colour), seed: 7, model: 'stand-in', costUsd: 0.025 }; };
  engine.change = async (a) => { asked.push({ kind: 'change', ...a }); if (failWith) throw failWith; return { imageDataUrl: await pic(colour), seed: 8, model: 'stand-in', costUsd: 0.03 }; };
  engine.price = async () => ({ usd: 0.025, estimate: true });

  try {
    // ---- options and cost ----
    let r = await call(A, 'GET', '/options');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.styles.map((s) => s.id), ['pencil', 'pen', 'coloured']);
    assert.ok(r.body.penColors.length >= 6 && r.body.aspects.length === 3);
    r = await call(A, 'GET', '/cost?kind=draw');
    assert.equal(r.status, 200);
    assert.equal(r.body.usd, 0.025);

    // ---- draw ----
    r = await call(A, 'POST', '/draw', { description: '   ' });
    assert.equal(r.status, 400);
    r = await call(A, 'POST', '/draw', { description: 'a dog', style: 'oil-paint' });
    assert.equal(r.status, 400);
    r = await call(A, 'POST', '/draw', { description: 'a dog', style: 'pen', penColor: 'neon' });
    assert.equal(r.status, 400);
    assert.equal(asked.length, 0, 'nothing is drawn (or paid for) when the request is wrong');

    colour = { r: 255, g: 0, b: 0 };
    r = await call(A, 'POST', '/draw', { description: 'A dog chases a ball in a park', style: 'pen', penColor: 'blue', aspect: 'portrait' });
    assert.equal(r.status, 201, JSON.stringify(r.body).slice(0, 300));
    const s1 = r.body.sketch;
    assert.equal(s1.title, 'A dog chases a ball in a park');
    assert.equal(s1.style, 'pen');
    assert.equal(s1.penColor, 'blue');
    assert.match(s1.image, /^data:image\/jpeg;base64,/);
    assert.ok(s1.thumbnail && s1.thumbnail.startsWith('data:image/jpeg'));
    assert.deepEqual(s1.versions, []);
    assert.equal(asked[0].width, 768); assert.equal(asked[0].height, 1024);
    assert.match(asked[0].prompt, /only in blue ink/);

    // ---- the list leaves out pictures; another person sees nothing and can touch nothing ----
    r = await call(A, 'GET', '/');
    assert.equal(r.body.sketches.length, 1);
    assert.equal(r.body.sketches[0].image, undefined);
    assert.equal(r.body.sketches[0].versions, undefined);
    assert.deepEqual((await call(B, 'GET', '/')).body.sketches, []);
    assert.equal((await call(B, 'GET', `/${s1.id}`)).status, 404);
    assert.equal((await call(B, 'PUT', `/${s1.id}`, { title: 'mine now' })).status, 404);
    assert.equal((await call(B, 'POST', `/${s1.id}/change`, { instruction: 'add a hat' })).status, 404);
    assert.equal((await call(B, 'POST', `/${s1.id}/duplicate`)).status, 404);
    assert.equal((await call(B, 'DELETE', `/${s1.id}`)).status, 404);
    assert.equal((await call(B, 'GET', `/${s1.id}/versions/abc`)).status, 404);
    assert.equal(asked.length, 1, 'a refused change on someone else\'s sketch draws nothing');

    // ---- change: the same sketch changes, the replaced picture is kept ----
    colour = { r: 0, g: 160, b: 0 };
    r = await call(A, 'POST', `/${s1.id}/change`, { instruction: 'make the dog bigger and add rain', baseUpdatedAt: s1.updatedAt });
    assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 300));
    let s = r.body.sketch;
    assert.equal(s.id, s1.id);
    assert.equal(s.changeCount, 1);
    assert.notEqual(s.image, s1.image);
    assert.equal(s.versions.length, 1);
    assert.equal(s.versions[0].note, 'make the dog bigger and add rain');
    assert.equal(s.versions[0].image, undefined, 'the summary carries no picture data');
    assert.match(asked[1].prompt, /Edit this cartoon drawing: make the dog bigger and add rain/);
    assert.equal(asked[1].imageDataUrl, s1.image, 'the current picture is what gets changed');
    assert.equal((await call(A, 'GET', '/')).body.sketches.length, 1, 'a change does not make a new sketch');

    // the earlier picture can be fetched whole
    r = await call(A, 'GET', `/${s1.id}/versions/${s.versions[0].vid}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.version.image, s1.image);

    // ---- nothing to change, nothing to pay for ----
    const before = asked.length;
    assert.equal((await call(A, 'POST', `/${s1.id}/change`, {})).status, 400);
    assert.equal((await call(A, 'POST', `/${s1.id}/change`, { instruction: '   ' })).status, 400);
    assert.equal((await call(A, 'POST', `/${s1.id}/change`, { instruction: 'x'.repeat(sk.MAX_INSTRUCTION + 1) })).status, 413);
    assert.equal(asked.length, before);

    // ---- colour it in: a new look, no words ----
    r = await call(A, 'POST', `/${s1.id}/change`, { style: 'coloured', baseUpdatedAt: s.updatedAt });
    assert.equal(r.status, 200);
    s = r.body.sketch;
    assert.equal(s.style, 'coloured');
    assert.equal(s.changeCount, 2);
    assert.match(asked[asked.length - 1].prompt, /Colour in the drawing/);
    assert.match(s.versions[0].note, /the look changed to coloured in/);

    // ---- a stale tab is refused and nothing is overwritten ----
    const stale = s1.updatedAt;
    r = await call(A, 'POST', `/${s1.id}/change`, { instruction: 'add a hat', baseUpdatedAt: stale });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'CHANGED');
    assert.equal((await call(A, 'GET', `/${s1.id}`)).body.sketch.changeCount, 2);

    // ---- earlier pictures: newest first, never more than 6 ----
    for (let i = 0; i < 7; i++) {
      colour = { r: 10 * i, g: 10 * i, b: 200 };
      r = await call(A, 'POST', `/${s1.id}/change`, { instruction: `step ${i}` });
      assert.equal(r.status, 200);
    }
    s = r.body.sketch;
    assert.equal(s.versions.length, sk.MAX_VERSIONS);
    assert.equal(s.versions[0].note, 'step 6');
    assert.equal(s.changeCount, 9);

    // ---- put an earlier picture back; the one replaced is kept, so this can be undone ----
    const target = s.versions[2];
    const currentImage = s.image;
    const targetImage = (await call(A, 'GET', `/${s1.id}/versions/${target.vid}`)).body.version.image;
    r = await call(A, 'POST', `/${s1.id}/versions/${target.vid}/restore`, {});
    assert.equal(r.status, 200);
    const restored = r.body.sketch;
    assert.equal(restored.image, targetImage);
    assert.equal(restored.versions.length, sk.MAX_VERSIONS);
    assert.ok(!restored.versions.some((v) => v.vid === target.vid), 'the picture put back leaves the list');
    assert.equal((await call(A, 'GET', `/${s1.id}/versions/${restored.versions[0].vid}`)).body.version.image, currentImage, 'the replaced picture is the newest earlier one');
    assert.equal((await call(A, 'POST', `/${s1.id}/versions/nope/restore`, {})).status, 404);

    // ---- putting a picture back puts its look back too ----
    r = await call(A, 'POST', '/draw', { description: 'A red fox reads a book', style: 'pen', penColor: 'red' });
    const s2 = r.body.sketch;
    r = await call(A, 'POST', `/${s2.id}/change`, { style: 'coloured' });
    assert.equal(r.body.sketch.style, 'coloured');
    r = await call(A, 'POST', `/${s2.id}/versions/${r.body.sketch.versions[0].vid}/restore`, {});
    assert.equal(r.status, 200);
    assert.equal(r.body.sketch.style, 'pen');
    assert.equal(r.body.sketch.penColor, 'red');
    assert.equal((await call(A, 'DELETE', `/${s2.id}`)).status, 200);

    // ---- rename and copy ----
    r = await call(A, 'PUT', `/${s1.id}`, { title: '  Dog   and ball  ' });
    assert.equal(r.body.sketch.title, 'Dog and ball');
    r = await call(A, 'POST', `/${s1.id}/duplicate`);
    assert.equal(r.status, 201);
    assert.equal(r.body.sketch.title, 'Dog and ball (copy)');
    const copyId = r.body.sketch.id;
    assert.deepEqual((await call(A, 'GET', `/${copyId}`)).body.sketch.versions, [], 'a copy starts with no history');

    // ---- the image service refuses or fails: plain words, nothing saved, nothing charged ----
    const count = (await call(A, 'GET', '/')).body.sketches.length;
    failWith = Object.assign(new Error('That idea is not allowed here.'), { status: 422, code: 'CONTENT_RESTRICTED', matches: ['gore'] });
    r = await call(A, 'POST', '/draw', { description: 'something gory' });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'CONTENT_RESTRICTED');
    failWith = new Error('FAL exploded: key=sk-secret-123');
    r = await call(A, 'POST', '/draw', { description: 'a dog' });
    assert.equal(r.status, 502);
    assert.doesNotMatch(JSON.stringify(r.body), /sk-secret|FAL exploded/, 'the provider\'s own message is not shown');
    assert.match(r.body.error, /No spend was recorded/);
    r = await call(A, 'POST', `/${s1.id}/change`, { instruction: 'add a hat' });
    assert.equal(r.status, 502);
    failWith = new Error('FAL_API_KEY is not configured');
    r = await call(A, 'POST', '/draw', { description: 'a dog' });
    assert.equal(r.status, 502);
    assert.match(r.body.error, /no FAL key/);
    failWith = new Error('Graphics provider request failed (404)');
    r = await call(A, 'POST', '/draw', { description: 'a dog' });
    assert.match(r.body.error, /does not recognise the graphics model set in Settings/);
    failWith = new Error('Exhausted balance. User is locked.');
    r = await call(A, 'POST', '/draw', { description: 'a dog' });
    assert.match(r.body.error, /out of credit or locked/);
    failWith = null;
    // the picture came back (and was paid for) but could not be saved: the person is told they may have been charged
    const realNormalise = engine.normalise;
    engine.normalise = async () => { throw new Error('sharp exploded'); };
    r = await call(A, 'POST', '/draw', { description: 'a dog' });
    assert.equal(r.status, 500);
    assert.equal(r.body.code, 'NOT_SAVED');
    assert.match(r.body.error, /may have been charged/);
    assert.doesNotMatch(r.body.error, /No spend was recorded/);
    engine.normalise = realNormalise;
    assert.equal((await call(A, 'GET', '/')).body.sketches.length, count);
    assert.equal((await call(A, 'GET', `/${s1.id}`)).body.sketch.changeCount, restored.changeCount);

    // ---- the limit is checked BEFORE a picture is paid for ----
    {
      const have = (await call(A, 'GET', '/')).body.sketches.length;
      await pool.query(
        `INSERT INTO sketches ("userId", title, image) SELECT $1, 'filler ' || g, 'data:image/png;base64,AAAA' FROM generate_series(1, $2::int) g`,
        [A, sk.MAX_SKETCHES_PER_USER - have]);
      const drawn = asked.length;
      r = await call(A, 'POST', '/draw', { description: 'one more dog' });
      assert.equal(r.status, 409);
      assert.equal(r.body.code, 'FULL');
      assert.equal(asked.length, drawn, 'no picture is drawn (or paid for) when there is no room to keep it');
      assert.equal((await call(A, 'POST', `/${s1.id}/duplicate`)).status, 409);
      await pool.query(`DELETE FROM sketches WHERE "userId" = $1 AND title LIKE 'filler %'`, [A]);
    }

    // ---- delete -> recycle bin -> Undo brings it back with its earlier pictures ----
    const keepVersions = (await call(A, 'GET', `/${s1.id}`)).body.sketch.versions.length;
    r = await call(A, 'DELETE', `/${s1.id}`);
    assert.equal(r.status, 200);
    assert.ok(r.body.binId);
    assert.equal((await call(A, 'GET', `/${s1.id}`)).status, 404);
    assert.equal((await bin.list(B)).filter((i) => i.entityType === 'sketch').length, 0, 'another person\'s recycle bin is empty');
    await bin.restoreItem(A, r.body.binId);
    r = await call(A, 'GET', `/${s1.id}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.sketch.title, 'Dog and ball');
    assert.equal(r.body.sketch.versions.length, keepVersions);
    assert.match(r.body.sketch.image, /^data:image\/jpeg/);
  } finally {
    engine.draw = real.draw; engine.change = real.change; engine.price = real.price;
    await new Promise((resolve) => server.close(resolve));
    await pool.query('DELETE FROM recycle_bin WHERE "userId" = ANY($1)', [[A, B]]).catch(() => {});
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[A, B]]).catch(() => {});
    await pool.end().catch(() => {});
  }
  console.log('sketchbook: all passed');
})().catch((err) => { console.error(err); process.exit(1); });
