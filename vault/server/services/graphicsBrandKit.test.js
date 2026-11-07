'use strict';

// node server/services/graphicsBrandKit.test.js
// Part 1 is pure. Part 2 and 3 need a scratch Postgres and skip without one:
//   DATABASE_URL=postgresql://vault@127.0.0.1:15433/vault_xuser node server/services/graphicsBrandKit.test.js
// They work inside a throw-away schema (dropped at the end) with the REAL table definition read out of server/db.js, so the test cannot drift from it.

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const K = require('./graphicsBrandKit');

const png = 'data:image/png;base64,iVBORw0KGgo=';
const fontBytes = (extra = 0) => Buffer.concat([Buffer.from([0, 1, 0, 0]), crypto.randomBytes(2000 + extra)]);
function fontFile(renderFamily, buf = fontBytes()) {
  return { buffer: buf, bytes: buf.length, ext: 'ttf', renderFamily, internalFamily: 'X', weight: 600, variable: false, instanced: false, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}
function proposal(over = {}) {
  return {
    sourceUrl: 'https://example.com/', finalUrl: 'https://www.example.com/',
    colours: { background: '#0a1628', surface: '#192d49', text: '#ffffff', mutedText: null, primary: '#d4af37', onPrimary: '#111111', accent: null, border: 'not-a-colour' },
    palette: ['#0a1628', '#d4af37', 'bad'], dark: null, radius: { px: 8, label: 'rounded' },
    fonts: {
      heading: { family: 'Montserrat', weight: 600, system: false, source: 'page', file: fontFile('BrandFont17ff0821') },
      body: { family: 'Arial', weight: 400, system: true, source: null, file: null },
    },
    logos: [{ dataUrl: png, kind: 'img' }, { dataUrl: png, kind: 'svg' }],
    ...over,
  };
}
const ALL = { colours: true, radius: true, logoIndex: 0, fonts: { heading: true, body: true } };

// ---------------------------------------------------------------- part 1: pure
{
  assert.throws(() => K.sanitizeUse({}), /Tick at least one/);
  assert.throws(() => K.sanitizeUse(null), /Tick at least one/);
  assert.throws(() => K.sanitizeUse({ colours: 'yes' }), /Tick at least one/, 'only a real true counts');
  assert.strictEqual(K.sanitizeUse({ colours: true, logoIndex: 99 }).logoIndex, null, 'a silly index is ignored');
  assert.strictEqual(K.sanitizeUse({ logoIndex: 1 }).logoIndex, 1);

  const old = { logoDataUrl: 'data:image/png;base64,OLD', colors: ['#111111'], futureField: { keep: true } };
  const { kit, changed } = K.mergeKit(old, proposal(), ALL, new Date('2026-11-07T00:00:00Z'));
  assert.deepStrictEqual(kit.colors, ['#d4af37', '#ffffff'], 'primary, accent (none), text');
  assert.strictEqual(kit.roles.primary, '#d4af37');
  assert.strictEqual(kit.roles.border, undefined, 'a value that is not a hex colour is dropped');
  assert.deepStrictEqual(kit.palette, ['#0a1628', '#d4af37']);
  assert.strictEqual(kit.dark, undefined);
  assert.deepStrictEqual(kit.radius, { px: 8, label: 'rounded' });
  assert.strictEqual(kit.logoDataUrl, png);
  assert.deepStrictEqual(kit.headingFont, { family: 'Montserrat', weight: 600, stored: true, renderFamily: 'BrandFont17ff0821', source: 'page' });
  assert.deepStrictEqual(kit.bodyFont, { family: 'Arial', weight: 400, stored: false }, 'a name-only font says it has no file');
  assert.strictEqual(kit.fontFamily, 'Montserrat');
  assert.deepStrictEqual(kit.futureField, { keep: true }, 'fields it does not know are left alone');
  assert.strictEqual(kit.source.url, 'https://www.example.com/');
  assert.deepStrictEqual(changed, ['colours', 'corners', 'logo', 'heading font', 'body font']);

  // only what was ticked changes
  const only = K.mergeKit(old, proposal(), { colours: false, radius: false, logoIndex: null, fonts: { heading: false, body: true } }).kit;
  assert.strictEqual(only.logoDataUrl, 'data:image/png;base64,OLD');
  assert.deepStrictEqual(only.colors, ['#111111']);
  assert.strictEqual(only.headingFont, undefined);
  assert.ok(only.bodyFont);

  // dark mode is replaced, and removed when the new site has none
  const withDark = K.mergeKit({}, proposal({ dark: { background: '#000000', text: '#eeeeee', primary: '#d4af37' } }), { ...ALL, logoIndex: null }).kit;
  assert.deepStrictEqual(withDark.dark, { background: '#000000', text: '#eeeeee', primary: '#d4af37' });
  assert.strictEqual(K.mergeKit({ dark: { background: '#000000', text: '#ffffff' } }, proposal(), { colours: true, fonts: {} }).kit.dark, undefined);

  // refusals say why
  assert.throws(() => K.mergeKit({}, proposal({ radius: { px: null, label: 'unknown' } }), { radius: true, fonts: {} }), /corner style/);
  assert.throws(() => K.mergeKit({}, proposal({ colours: {} }), { colours: true, fonts: {} }), /No colours/);
  assert.throws(() => K.mergeKit({}, proposal(), { logoIndex: 5, fonts: {} }), /logo is not available/);
  assert.throws(() => K.mergeKit({}, proposal({ logos: [{ dataUrl: 'data:text/html;base64,AAAA' }] }), { logoIndex: 0, fonts: {} }), /logo is not available/, 'only a PNG is kept');
  assert.throws(() => K.mergeKit({}, proposal({ fonts: { heading: null, body: null } }), { fonts: { heading: true } }), /No heading font/);

  // a font file is checked again before it is kept
  const good = fontFile('BrandFont17ff0821');
  assert.strictEqual(K.checkFontFile(good).length, 64);
  assert.throws(() => K.checkFontFile({ ...good, buffer: Buffer.from('<html>not a font</html>'.repeat(100)) }), /not a TrueType/);
  assert.throws(() => K.checkFontFile({ ...good, buffer: Buffer.alloc(10) }), /not usable/);
  assert.throws(() => K.checkFontFile({ ...good, sha256: 'f'.repeat(64) }), /changed after/);
  assert.throws(() => K.checkFontFile({ ...good, renderFamily: 'Montserrat' }), /no usable name/);
  assert.throws(() => K.checkFontFile({ ...good, buffer: Buffer.concat([Buffer.from([0, 1, 0, 0]), Buffer.alloc(K.MAX_FONT_BYTES)]), sha256: undefined }), /too large/);
  assert.throws(() => K.checkFontFile(null), /not usable/);
  console.log('part 1 (merge and checks): ok');
}

// ---------------------------------------------------------------- parts 2 and 3: a real database
const url = process.env.DATABASE_URL;
if (!url) {
  console.log('parts 2 and 3 (database): skipped, DATABASE_URL not set');
  process.exit(0);
}

(async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: url });
  await client.connect();
  const schema = `bk_test_${crypto.randomBytes(4).toString('hex')}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  try {
    await client.query('CREATE TABLE users (id INTEGER PRIMARY KEY)');
    await client.query('CREATE TABLE settings ("userId" INTEGER REFERENCES users(id) ON DELETE CASCADE, key TEXT, value TEXT, PRIMARY KEY ("userId", key))');
    const dbjs = fs.readFileSync(path.join(__dirname, '..', 'db.js'), 'utf8');
    const start = dbjs.indexOf('CREATE TABLE IF NOT EXISTS graphics_brand_fonts');
    assert.ok(start > 0, 'the table is defined in db.js');
    await client.query(dbjs.slice(start, dbjs.indexOf('`', start)));
    await client.query('INSERT INTO users (id) VALUES (1), (2)');
    // one connection stands in for the pool; the transaction helpers only need connect()/query()/release()
    const pool = { query: (...a) => client.query(...a), connect: async () => ({ query: (...a) => client.query(...a), release() {} }) };
    const kitOf = async (uid) => { const r = await client.query('SELECT value FROM settings WHERE "userId"=$1 AND key=$2', [uid, K.KIT_KEY]); return r.rows[0] ? JSON.parse(r.rows[0].value) : null; };
    const fontRows = async (uid) => (await client.query('SELECT role, family, "renderFamily", bytes, data FROM graphics_brand_fonts WHERE "userId"=$1 ORDER BY role', [uid])).rows;

    // ---- part 2: the service ----
    await client.query('INSERT INTO settings ("userId", key, value) VALUES (1, $1, $2)', [K.KIT_KEY, JSON.stringify({ colors: ['#111111'], futureField: 7 })]);
    const p1 = proposal();
    const r1 = await K.applyProposal(pool, 1, p1, ALL);
    assert.deepStrictEqual(r1.changed, ['colours', 'corners', 'logo', 'heading font', 'body font']);
    assert.strictEqual(r1.kit.hasLogo, true);
    assert.strictEqual(r1.kit.logoDataUrl, undefined, 'the reply does not carry the logo picture');
    const k1 = await kitOf(1);
    assert.strictEqual(k1.futureField, 7);
    assert.strictEqual(k1.headingFont.stored, true);
    assert.strictEqual(k1.bodyFont.stored, false);
    let rows = await fontRows(1);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].role, 'heading');
    assert.ok(Buffer.compare(rows[0].data, p1.fonts.heading.file.buffer) === 0, 'the exact bytes are kept');
    assert.strictEqual(r1.fonts.length, 1);
    assert.strictEqual(r1.fonts[0].data, undefined, 'the list never carries bytes');

    // replacing keeps one row per role
    const p2 = proposal({ fonts: { heading: { family: 'Playfair Display', weight: 700, system: false, source: 'google-fonts', file: fontFile('BrandFontaaaa1111', fontBytes(500)) }, body: null } });
    await K.applyProposal(pool, 1, p2, { fonts: { heading: true } });
    rows = await fontRows(1);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].renderFamily, 'BrandFontaaaa1111');
    assert.strictEqual((await kitOf(1)).fontFamily, 'Playfair Display');
    assert.strictEqual((await kitOf(1)).colors[0], '#d4af37', 'an apply that did not tick colours left them');

    // a name-only heading font removes the old file (it no longer matches the kit)
    const p3 = proposal({ fonts: { heading: { family: 'sohne-var', weight: 300, system: false, source: null, file: null }, body: null } });
    await K.applyProposal(pool, 1, p3, { fonts: { heading: true } });
    assert.strictEqual((await fontRows(1)).length, 0);
    assert.strictEqual((await kitOf(1)).headingFont.stored, false);

    // refusals change nothing
    const before = JSON.stringify(await kitOf(1));
    await assert.rejects(() => K.applyProposal(pool, 1, p1, {}), /Tick at least one/);
    const bad = proposal(); bad.fonts.heading.file.sha256 = 'a'.repeat(64);
    await assert.rejects(() => K.applyProposal(pool, 1, bad, ALL), /changed after/);
    await assert.rejects(() => K.applyProposal(pool, 1, proposal(), { logoIndex: 7, fonts: { heading: true } }), /logo is not available/);
    assert.strictEqual(JSON.stringify(await kitOf(1)), before, 'the kit is unchanged after a refusal');
    assert.strictEqual((await fontRows(1)).length, 0, 'no font was stored by a refused apply');

    // a failure in the middle rolls the font back too
    await K.applyProposal(pool, 1, p1, { fonts: { heading: true } });
    const kitBeforeFail = JSON.stringify(await kitOf(1));
    const failing = { connect: async () => ({ query: async (sql, ...rest) => { if (/INSERT INTO settings/.test(sql)) throw new Error('disk full'); return client.query(sql, ...rest); }, release() {} }) };
    await assert.rejects(() => K.applyProposal(failing, 1, p2, { fonts: { heading: true } }), /disk full/);
    assert.strictEqual((await fontRows(1))[0].renderFamily, 'BrandFont17ff0821', 'the font row was rolled back with the kit');
    assert.strictEqual(JSON.stringify(await kitOf(1)), kitBeforeFail);

    // reading and removing: own rows only
    assert.strictEqual((await K.listFonts(pool, 2)).length, 0);
    assert.strictEqual(await K.getFontFile(pool, 2, 'heading'), null, 'another person gets nothing');
    assert.ok((await K.getFontFile(pool, 1, 'heading')).data.length > 1000);
    assert.strictEqual(await K.getFontFile(pool, 1, 'footer'), null);
    await K.applyProposal(pool, 2, proposal(), { fonts: { heading: true } });
    assert.strictEqual(await K.deleteFont(pool, 1, 'heading'), true);
    assert.strictEqual(await K.deleteFont(pool, 1, 'heading'), false, 'removing twice is harmless');
    assert.strictEqual((await kitOf(1)).headingFont.stored, false);
    assert.strictEqual((await kitOf(1)).headingFont.family, 'Montserrat', 'the name stays');
    assert.strictEqual((await fontRows(2)).length, 1, 'the other person was not touched');
    await assert.rejects(() => K.deleteFont(pool, 1, 'x'), /role must be/);

    // the column rules hold even if code is wrong
    await assert.rejects(() => client.query(`INSERT INTO graphics_brand_fonts ("userId", role, family, weight, "renderFamily", ext, bytes, sha256, data) VALUES (1,'footer','a',400,'b','ttf',1,'s','\\x00')`), /check/i);
    await client.query('DELETE FROM users WHERE id = 2');
    assert.strictEqual((await fontRows(2)).length, 0, 'fonts go when the person goes');
    console.log('part 2 (database): ok');

    // ---- part 3: the routes, over HTTP, with the database stub pointing at the same scratch schema ----
    const dbPath = require.resolve('../db');
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool } };
    await client.query('INSERT INTO users (id) VALUES (2)');
    const express = require('express');
    const brandFromUrl = require('../routes/graphics/brandFromUrl');
    const router = require('../routes/graphics/brandKit');
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => { req.user = { id: Number(req.headers['x-user'] || 1) }; next(); });
    app.use('/api/graphics', router);
    const server = await new Promise((r) => { const s = http.createServer(app).listen(0, () => r(s)); });
    const base = `http://127.0.0.1:${server.address().port}/api/graphics`;
    const call = async (method, p, body, user = 1) => {
      const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-user': String(user) }, body: body ? JSON.stringify(body) : undefined });
      const type = res.headers.get('content-type') || '';
      return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
    };
    try {
      const prop = proposal();
      const id = brandFromUrl.store.put(1, prop);

      assert.strictEqual((await call('POST', `/brand-from-url/${id}/apply`, { use: ALL }, 2)).status, 404, "another person's reading id is not found");
      assert.strictEqual((await call('POST', `/brand-from-url/${'0'.repeat(32)}/apply`, { use: ALL })).status, 404);
      assert.strictEqual((await call('POST', `/brand-from-url/${id}/apply`, { use: {} })).status, 400);
      assert.strictEqual((await call('POST', `/brand-from-url/${id}/apply`, {})).status, 400);
      assert.strictEqual((await fontRows(1)).length, 0);

      const ok = await call('POST', `/brand-from-url/${id}/apply`, { use: ALL });
      assert.strictEqual(ok.status, 200);
      assert.deepStrictEqual(ok.body.changed, ['colours', 'corners', 'logo', 'heading font', 'body font']);
      assert.strictEqual(ok.body.kit.roles.primary, '#d4af37');
      assert.strictEqual(ok.body.fonts.length, 1);
      assert.ok(!JSON.stringify(ok.body).includes('"data"'), 'no font bytes in the reply');

      const list = await call('GET', '/brand-kit/fonts');
      assert.deepStrictEqual(list.body.fonts.map((f) => f.role), ['heading']);
      assert.deepStrictEqual((await call('GET', '/brand-kit/fonts', null, 2)).body.fonts, []);

      const file = await call('GET', '/brand-kit/fonts/heading/file');
      assert.strictEqual(file.status, 200);
      assert.strictEqual(file.headers.get('content-type'), 'font/ttf');
      assert.ok(Buffer.compare(file.body, prop.fonts.heading.file.buffer) === 0);
      assert.ok(/^"[0-9a-f]{64}"$/.test(file.headers.get('etag')));
      assert.strictEqual((await call('GET', '/brand-kit/fonts/heading/file', null, 2)).status, 404);
      assert.strictEqual((await call('GET', '/brand-kit/fonts/body/file')).status, 404);

      assert.strictEqual((await call('DELETE', '/brand-kit/fonts/heading', null, 2)).status, 404, 'cannot remove what is not yours');
      assert.strictEqual((await call('DELETE', '/brand-kit/fonts/nope')).status, 400);
      assert.strictEqual((await call('DELETE', '/brand-kit/fonts/heading')).status, 200);
      assert.strictEqual((await call('DELETE', '/brand-kit/fonts/heading')).status, 404);
      assert.strictEqual((await kitOf(1)).headingFont.stored, false);
      console.log('part 3 (routes): ok');
    } finally {
      server.close();
    }
  } finally {
    await client.query(`DROP SCHEMA ${schema} CASCADE`).catch(() => {});
    await client.end();
  }
  console.log('graphicsBrandKit tests: done');
})().catch((e) => { console.error(e); process.exit(1); });
