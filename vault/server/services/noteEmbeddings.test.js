'use strict';
const assert = require('assert');
const E = require('./noteEmbeddings');

(async () => {
  // ---- what is embedded
  assert.strictEqual(E.noteText({ title: ' Acme call ', tags: ['q3', 'budget'], body: 'Agreed\r\n$4,000.' }), 'Acme call\nq3 budget\nAgreed\n$4,000.');
  assert.strictEqual(E.noteText({ title: '', body: 'only text' }), 'only text');
  assert.strictEqual(E.noteText({ title: 'T', body: 'x'.repeat(20000) }).length, E.MAX_EMBED_CHARS, 'long notes are cut');

  // ---- vectors
  assert.deepStrictEqual(E.normalize([3, 4]), [0.6, 0.8]);
  for (const bad of [null, [], [0, 0], [1, NaN], [1, Infinity], 'x']) assert.strictEqual(E.normalize(bad), null, JSON.stringify(bad));
  const v = E.normalize([0.2, -0.5, 0.7, 0.1]);
  const back = E.fromBlob(E.toBlob(v));
  assert.strictEqual(back.length, 4);
  assert.ok(v.every((x, i) => Math.abs(x - back[i]) < 1e-6), 'stored as bytes and read back');
  // a Buffer that sits at an odd offset (as one from the database may) is still read correctly
  const padded = Buffer.concat([Buffer.from([9]), E.toBlob(v)]).subarray(1);
  assert.ok(v.every((x, i) => Math.abs(x - E.fromBlob(padded)[i]) < 1e-6));
  assert.strictEqual(E.fromBlob(Buffer.alloc(7)), null);
  assert.strictEqual(E.fromBlob(null), null);
  assert.ok(Math.abs(E.dot(E.normalize([1, 1]), E.normalize([1, 1])) - 1) < 1e-9);
  assert.strictEqual(E.dot([1, 0], [1, 0, 0]), 0, 'vectors of different sizes never match');

  // ---- ranking by meaning
  const q = E.normalize([1, 0, 0.1]);
  const items = [
    { id: 1, vector: E.normalize([1, 0.1, 0.1]) },   // very close
    { id: 2, vector: E.normalize([1, 0.5, 0.1]) },   // fairly close
    { id: 3, vector: E.normalize([0, 1, 0]) },       // unrelated
    { id: 4, vector: E.normalize([1, 0, 0.2]) },     // very close, a hair behind id 1 or ahead
  ];
  const ranked = E.rankBySimilarity(q, items, 10);
  assert.ok(!ranked.some((r) => r.id === 3), 'an unrelated note is not a match, however few notes there are');
  assert.ok(ranked[0].score >= ranked[1].score, 'best first');
  assert.ok(ranked.every((r) => r.score >= ranked[0].score - E.BAND), 'and nothing far behind the best');
  assert.strictEqual(E.rankBySimilarity(q, items, 1).length, 1, 'bounded');
  assert.deepStrictEqual(E.rankBySimilarity(q, [{ id: 9, vector: E.normalize([0, 0, 1]) }].slice(0, 0)), []);
  assert.deepStrictEqual(E.rankBySimilarity(E.normalize([0, 1]), [{ id: 1, vector: E.normalize([1, 0]) }]), [], 'nothing close enough: no matches (not "the least bad")');
  assert.deepStrictEqual(E.rankBySimilarity(q, null), []);
  // a loose question does not drag in everything: the 0.5-ish note falls outside the band of a near-perfect match
  const loose = E.rankBySimilarity(E.normalize([1, 0]), [{ id: 1, vector: E.normalize([1, 0.05]) }, { id: 2, vector: E.normalize([1, 1]) }]);
  assert.deepStrictEqual(loose.map((r) => r.id), [1]);

  // ---- merging the word search and the meaning search
  assert.deepStrictEqual(E.fuseRanks([[1, 2, 3], [3, 4]], 10), [3, 1, 2, 4], 'a note both searches liked comes first');
  assert.deepStrictEqual(E.fuseRanks([[5, 6], []], 10), [5, 6], 'one list alone keeps its order');
  assert.deepStrictEqual(E.fuseRanks([[1, 2, 3, 4]], 2), [1, 2], 'bounded');
  assert.deepStrictEqual(E.fuseRanks([null, undefined]), []);

  // ---- indexing, with a fake database and a fake embedding model
  const stored = new Map();
  const stale = [
    { id: 11, title: 'Invoice', body: 'payment due', tags: ['money'], hash: 'h1' },
    { id: 12, title: 'Holiday', body: 'flights', tags: [], hash: 'h2' },
    { id: 13, title: 'Bad', body: 'embedding fails', tags: [], hash: 'h3' },
  ];
  const seenSql = [];
  const pool = {
    async query(sql, params) {
      seenSql.push({ sql, params });
      if (/SELECT COUNT\(\*\)/.test(sql)) return { rows: [{ count: stale.length }] };
      if (/FROM notes n LEFT JOIN note_embeddings/.test(sql)) return { rows: stale };
      if (/INSERT INTO note_embeddings/.test(sql)) { stored.set(params[0], { user: params[1], source: params[2], hash: params[3], blob: params[4] }); return { rows: [] }; }
      throw new Error(`unexpected: ${sql.slice(0, 60)}`);
    },
  };
  const embed = async (text) => (text.includes('fails') ? { vector: null } : { vector: [text.length, 1, 2], sourceKey: 'fake:1' });
  const filters = { where: ['n.user_id=$1'], params: [7] };
  const res = await E.indexStale(pool, 7, filters, 'fake:1', embed, 15);
  assert.deepStrictEqual(res, { stale: 3, done: 2 }, 'a note the model fails on is skipped, the others are stored');
  assert.deepStrictEqual([...stored.keys()].sort(), [11, 12]);
  assert.strictEqual(stored.get(11).user, 7, 'stored under the person');
  assert.strictEqual(stored.get(11).source, 'fake:1');
  assert.strictEqual(stored.get(11).hash, 'h1');
  assert.ok(Buffer.isBuffer(stored.get(11).blob));
  const listSql = seenSql.find((s) => /ORDER BY n\.updated_at DESC/.test(s.sql)).sql;
  assert.match(listSql, /n\.user_id=\$1/, 'always scoped to the owner');
  assert.match(listSql, /ne\.source IS DISTINCT FROM \$2/, 'an embedding from another model counts as out of date');
  assert.match(listSql, /ne\.content_hash IS DISTINCT FROM md5/, 'and so does one made from older text');
  assert.match(listSql, /LIMIT 15/);
  assert.deepStrictEqual(await E.indexStale(pool, 7, filters, 'fake:1', embed, 0), { stale: 3, done: 0 }, 'a limit of 0 only counts');

  // vectors for notes in scope come back readable
  const blob = E.toBlob(E.normalize([1, 2, 3]));
  const loadPool = { async query(sql, params) { assert.match(sql, /ne\.source = \$2/); assert.deepStrictEqual(params, [7, 'fake:1']); return { rows: [{ id: 5, embedding: blob }, { id: 6, embedding: Buffer.alloc(3) }] }; } };
  const loaded = await E.loadVectors(loadPool, filters, 'fake:1');
  assert.deepStrictEqual(loaded.map((l) => l.id), [5], 'an unreadable vector is dropped');

  // ---- background work can be switched off, and does nothing when off
  E.control.enabled = false;
  E.queueEmbed(7, 1, { pool: { query: () => { throw new Error('must not run'); } } });
  E.backfill(7, 'fake:1', { pool: { query: () => { throw new Error('must not run'); } } });
  E.control.enabled = true;

  console.log('noteEmbeddings tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
