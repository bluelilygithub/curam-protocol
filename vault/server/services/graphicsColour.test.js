'use strict';

// node server/services/graphicsColour.test.js   (npm run test:graphics-colour)
const assert = require('assert');
const fs = require('fs');
const sharp = require('sharp');
const c = require('./graphicsColour');

(async () => {
  // A real CMYK printer profile and a real RGB one, both taken from what sharp already ships.
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).png().toBuffer();
  const cmykIcc = (await sharp(await sharp(tiny).withMetadata({ icc: 'cmyk' }).tiff().toBuffer()).metadata()).icc;
  const rgbIcc = (await sharp(await sharp(tiny).withMetadata({ icc: 'srgb' }).tiff().toBuffer()).metadata()).icc;

  // ── checking an uploaded profile ─────────────────────────────────────────────────────
  const ok = c.checkIccProfile(cmykIcc);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.name, 'Chemical proof');
  assert.strictEqual(c.checkIccProfile(rgbIcc).ok, false);
  assert.match(c.checkIccProfile(rgbIcc).error, /not a CMYK profile/);
  assert.match(c.checkIccProfile(Buffer.from('this is a text file, not a profile '.repeat(10))).error, /not an ICC/);
  assert.match(c.checkIccProfile(Buffer.alloc(40)).error, /too small/);
  assert.match(c.checkIccProfile(cmykIcc.subarray(0, 5000)).error, /cut short/);
  assert.match(c.checkIccProfile(Buffer.concat([cmykIcc, Buffer.alloc(c.MAX_PROFILE_BYTES)])).error, /larger than 8 MB/);
  const notPrinter = Buffer.from(cmykIcc); notPrinter.write('mntr', 12, 'ascii');
  assert.match(c.checkIccProfile(notPrinter).error, /not a printer profile/);
  const newer = Buffer.from(cmykIcc); newer[8] = 9;
  assert.match(c.checkIccProfile(newer).error, /newer/);
  assert.strictEqual(c.checkIccProfile('nope').ok, false);

  // A version 4 profile stores its name as UTF-16 ('mluc'); build the smallest one that passes the checks.
  const v4 = (() => {
    const name = Buffer.from('Coated FOGRA39 (ISO 12647-2)', 'utf16le').swap16();
    const tagData = Buffer.concat([Buffer.from('mluc'), Buffer.alloc(4), Buffer.from([0, 0, 0, 1, 0, 0, 0, 12]), Buffer.from('enUS'), (() => { const b = Buffer.alloc(8); b.writeUInt32BE(name.length, 0); b.writeUInt32BE(28, 4); return b; })(), name]);
    const head = Buffer.alloc(128);
    head.write('acsp', 36, 'ascii'); head.write('CMYK', 16, 'ascii'); head.write('prtr', 12, 'ascii'); head[8] = 4;
    const table = Buffer.alloc(4 + 12); table.writeUInt32BE(1, 0); table.write('desc', 4, 'ascii'); table.writeUInt32BE(128 + table.length, 8); table.writeUInt32BE(tagData.length, 12);
    const all = Buffer.concat([head, table, tagData]);
    all.writeUInt32BE(all.length, 0);
    return all;
  })();
  assert.deepStrictEqual(c.checkIccProfile(v4), { ok: true, name: 'Coated FOGRA39 (ISO 12647-2)' });

  // ── the file sharp reads a custom profile from: one file per profile, reused ─────────
  const f1 = c.profileFile(cmykIcc);
  const f2 = c.profileFile(Buffer.from(cmykIcc));
  assert.strictEqual(f1, f2);
  assert.ok(fs.readFileSync(f1).equals(cmykIcc));
  // and sharp really converts through it: a CMYK TIFF with the profile embedded
  const viaFile = await sharp(tiny).withMetadata({ icc: f1 }).tiff().toBuffer();
  const meta = await sharp(viaFile).metadata();
  assert.strictEqual(meta.space, 'cmyk');
  assert.ok(meta.icc && meta.icc.length === cmykIcc.length, 'the profile travels with the file');

  // ── saving / loading / removing, against a tiny fake settings table ──────────────────
  const store = new Map();
  const pool = {
    query: async (sql, p) => {
      if (/^\s*SELECT/i.test(sql)) return { rows: store.has(p[0]) ? [{ value: store.get(p[0]), updatedAt: new Date() }] : [] };
      if (/^\s*INSERT/i.test(sql)) { store.set(p[0], p[1]); return { rows: [] }; }
      if (/^\s*DELETE/i.test(sql)) { store.delete(p[0]); return { rows: [] }; }
      throw new Error(`unexpected sql ${sql}`);
    },
  };
  assert.strictEqual(await c.loadCustomProfile(pool), null);
  await assert.rejects(c.saveCustomProfile(pool, rgbIcc), (e) => e.status === 400 && /not a CMYK/.test(e.message));
  assert.strictEqual(store.size, 0, 'a rejected profile is not stored');
  const saved = await c.saveCustomProfile(pool, cmykIcc);
  assert.deepStrictEqual([saved.name, saved.bytes], ['Chemical proof', cmykIcc.length]);
  const loaded = await c.loadCustomProfile(pool);
  assert.ok(loaded.buf.equals(cmykIcc));
  assert.strictEqual(loaded.name, 'Chemical proof');
  store.set(c.SETTINGS_KEY, '{ not json');
  assert.strictEqual(await c.loadCustomProfile(pool), null, 'a damaged stored profile falls back to the built-in one');
  await c.removeCustomProfile(pool);
  assert.strictEqual(await c.loadCustomProfile(pool), null);

  // ── how much of the picture changes in print ─────────────────────────────────────────
  const a = Buffer.from([255, 0, 0, 10, 10, 10, 200, 200, 200, 0, 0, 255]); // 4 pixels
  const b = Buffer.from([233, 53, 46, 12, 11, 10, 200, 200, 201, 0, 0, 255]);
  assert.deepStrictEqual(c.gamutReport(a, b), { changedPct: 25 }, 'only the red moved by a lot: 1 of 4');
  assert.deepStrictEqual(c.gamutReport(a, a), { changedPct: 0 });
  assert.deepStrictEqual(c.gamutReport(Buffer.alloc(0), Buffer.alloc(0)), { changedPct: 0 });
  assert.deepStrictEqual(c.gamutReport(Buffer.from([255, 0, 0, 255, 9, 9, 9, 255]), Buffer.from([0, 255, 0, 255, 9, 9, 9, 255]), 4), { changedPct: 50 }, 'works with an alpha channel too');

  console.log('graphicsColour: ok');
})().catch((err) => { console.error(err); process.exit(1); });
