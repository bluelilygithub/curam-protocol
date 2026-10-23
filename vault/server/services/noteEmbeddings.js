'use strict';

// Meaning-based search for notes. Each note gets one embedding (a list of numbers that stands for what it is about) kept in note_embeddings
// as bytes; a question is embedded the same way and the closest notes in the chosen scope are the ones that match by meaning, even when
// they share no words with the question ("money" finds a note about an invoice).
//
// Why bytes and not a pgvector column: a person has hundreds or a few thousand notes, so comparing them in code is fast, it works on a
// machine without pgvector, and it can be tested here. The scope filters (owner check, project, dates...) run in SQL first, so only the
// embeddings of notes in scope are ever loaded, and every query starts with n.user_id = the signed-in person.
//
// An embedding is stale when the note's title/text changed (content_hash) or it was made by a different embedding model (source).
// Staleness is found and mended lazily: a few notes at each question, the rest in the background, and a note a little after it is saved.
// Pure helpers are unit-tested: node server/services/noteEmbeddings.test.js

const MAX_EMBED_CHARS = 6000;        // title + tags + the start of the text; the embedding model has a limit well above this
const INDEX_PER_ASK = 15;            // notes embedded while the person waits (the rest follow in the background)
const BACKFILL_MAX = 400;            // notes one background run will do
const SAVE_DELAY_MS = 20000;         // a note is embedded this long after the last save
const CONCURRENCY = 4;
const MIN_SIMILARITY = 0.4;          // cosine similarity below which a note is not a meaning match at all
const BAND = 0.15;                   // ...and a match must be within this of the best one, so a loose question does not drag in everything
const RRF_K = 60;                    // rank fusion constant (the usual value)

/** The text that stands for a note when it is embedded. */
function noteText(note) {
  const tags = Array.isArray(note.tags) ? note.tags.join(' ') : String(note.tags || '');
  const text = [String(note.title || '').trim(), tags.trim(), String(note.body || '').replace(/\r\n/g, '\n').trim()].filter(Boolean).join('\n');
  return text.slice(0, MAX_EMBED_CHARS);
}

/** Scale to length 1, so that similarity between two vectors is just their dot product. null when it is not a usable vector. */
function normalize(vec) {
  if (!Array.isArray(vec) || !vec.length) return null;
  let sum = 0;
  for (const x of vec) { if (!Number.isFinite(x)) return null; sum += x * x; }
  if (sum === 0) return null;
  const len = Math.sqrt(sum);
  return vec.map((x) => x / len);
}

const toBlob = (vec) => Buffer.from(new Float32Array(vec).buffer);
function fromBlob(buf) {
  if (!buf || !buf.length || buf.length % 4) return null;
  // copy first: a Buffer from the database is not always aligned for a Float32Array
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
}

function dot(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += a[i] * b[i];
  return s;
}

/**
 * The notes closest in meaning to the question: [{ id, score }] best first, at most `limit`. `items` are { id, vector } (stored vectors
 * are already length 1); `query` is the normalised question vector. Drops anything under MIN_SIMILARITY or further than BAND from the best.
 */
function rankBySimilarity(query, items, limit = 12) {
  const scored = [];
  for (const it of Array.isArray(items) ? items : []) {
    const score = dot(query, it.vector);
    if (score >= MIN_SIMILARITY) scored.push({ id: it.id, score });
  }
  scored.sort((a, b) => b.score - a.score || a.id - b.id);
  if (!scored.length) return [];
  const floor = scored[0].score - BAND;
  return scored.filter((s) => s.score >= floor).slice(0, limit);
}

/** Reciprocal rank fusion: ids in several ranked lists, best overall first. A note both searches liked beats one only one liked. */
function fuseRanks(lists, limit = 12) {
  const score = new Map();
  for (const list of lists) {
    (Array.isArray(list) ? list : []).forEach((id, i) => score.set(id, (score.get(id) || 0) + 1 / (RRF_K + i + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, limit).map(([id]) => id);
}

// ---- database ---------------------------------------------------------------------------------------------------------------------

const HASH_SQL = "md5(coalesce(n.title,'') || E'\\n' || coalesce(n.body,''))";
const TAGS_SQL = "COALESCE((SELECT array_agg(nt.tag ORDER BY nt.tag) FROM note_tags nt WHERE nt.note_id = n.id), '{}')";

async function mapLimit(items, n, fn) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const at = i; i += 1; out[at] = await fn(items[at]); }
  }));
  return out;
}

/** Embed and store these note rows ({ id, title, body, tags, hash }). Returns how many were stored; a note the model fails on is skipped. */
async function storeEmbeddings(pool, userId, rows, source, embed) {
  let stored = 0;
  await mapLimit(rows, CONCURRENCY, async (r) => {
    try {
      const { vector } = await embed(noteText(r), { userId });
      const v = normalize(vector);
      if (!v) return;
      await pool.query(
        `INSERT INTO note_embeddings (note_id, user_id, source, content_hash, embedding, updated_at) VALUES ($1,$2,$3,$4,$5,NOW())
         ON CONFLICT (note_id) DO UPDATE SET source=EXCLUDED.source, content_hash=EXCLUDED.content_hash, embedding=EXCLUDED.embedding, updated_at=NOW()`,
        [r.id, userId, source, r.hash, toBlob(v)]);
      stored += 1;
    } catch { /* one note failing must not stop the others; it is tried again next time */ }
  });
  return stored;
}

/**
 * Make sure the notes in `filters` ({ where, params, add } from noteQuery.buildFilters) have an up-to-date embedding, up to `limit`
 * of them now (newest edited first). Returns { stale, done }: how many were out of date, and how many of those were mended.
 */
async function indexStale(pool, userId, filters, source, embed, limit = INDEX_PER_ASK) {
  const params = [...filters.params, source];
  const src = `$${params.length}`;
  const base = `FROM notes n LEFT JOIN note_embeddings ne ON ne.note_id = n.id
     WHERE ${filters.where.join(' AND ')} AND (ne.note_id IS NULL OR ne.source IS DISTINCT FROM ${src} OR ne.content_hash IS DISTINCT FROM ${HASH_SQL})`;
  const stale = Number((await pool.query(`SELECT COUNT(*) ${base}`, params)).rows[0].count);
  if (!stale || limit <= 0) return { stale, done: 0 };
  const rows = (await pool.query(
    `SELECT n.id, n.title, n.body, ${TAGS_SQL} AS tags, ${HASH_SQL} AS hash ${base} ORDER BY n.updated_at DESC, n.id DESC LIMIT ${Number(limit)}`, params)).rows;
  return { stale, done: await storeEmbeddings(pool, userId, rows, source, embed) };
}

/** [{ id, vector }] for the notes in `filters` that have an embedding made by `source`. */
async function loadVectors(pool, filters, source) {
  const params = [...filters.params, source];
  const rows = (await pool.query(
    `SELECT n.id, ne.embedding FROM notes n JOIN note_embeddings ne ON ne.note_id = n.id AND ne.source = $${params.length}
      WHERE ${filters.where.join(' AND ')}`, params)).rows;
  return rows.map((r) => ({ id: r.id, vector: fromBlob(r.embedding) })).filter((r) => r.vector);
}

// ---- keeping up with edits ---------------------------------------------------------------------------------------------------------

const timers = new Map();
const running = new Set();
const control = { enabled: true }; // tests switch background work off

/** Embed this note a little after the last save (saves come every few seconds while typing). Never throws, never blocks. */
function queueEmbed(userId, noteId, deps = {}) {
  if (!control.enabled) return;
  const key = `${userId}:${noteId}`;
  clearTimeout(timers.get(key));
  const t = setTimeout(async () => {
    timers.delete(key);
    try {
      const pool = deps.pool || require('../db').pool;
      const embed = deps.embed || require('./embeddings').embedText;
      const config = await (deps.resolve || require('./embeddingResolver').resolveEmbeddingConfig)(userId);
      if (!config.available) return; // no embedding model set up: nothing to do
      const rows = (await pool.query(
        `SELECT n.id, n.title, n.body, ${TAGS_SQL} AS tags, ${HASH_SQL} AS hash FROM notes n WHERE n.id=$1 AND n.user_id=$2`, [noteId, userId])).rows;
      if (rows.length) await storeEmbeddings(pool, userId, rows, config.sourceKey, embed);
    } catch { /* best effort */ }
  }, SAVE_DELAY_MS);
  if (t.unref) t.unref();
  timers.set(key, t);
}

/** Embed the rest of a person's out-of-date notes after a question, one run per person at a time. Never throws, never blocks. */
function backfill(userId, source, deps = {}) {
  if (!control.enabled || running.has(userId)) return;
  running.add(userId);
  (async () => {
    try {
      const pool = deps.pool || require('../db').pool;
      const embed = deps.embed || require('./embeddings').embedText;
      const filters = { where: ['n.user_id=$1'], params: [userId] };
      await indexStale(pool, userId, filters, source, embed, BACKFILL_MAX);
    } catch { /* best effort */ } finally { running.delete(userId); }
  })();
}

module.exports = {
  MAX_EMBED_CHARS, INDEX_PER_ASK, MIN_SIMILARITY, BAND, control,
  noteText, normalize, toBlob, fromBlob, dot, rankBySimilarity, fuseRanks,
  indexStale, loadVectors, storeEmbeddings, queueEmbed, backfill,
};
