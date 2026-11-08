'use strict';

// Drawings: saved Excalidraw scenes, one person's own. This file is the rules and the SQL; routes/drawings.js is the HTTP side and
// services/recycleBin/adapters/drawings.js puts a deleted drawing back. See docs/drawings.md.
//
// Every function takes the database as its first argument (so a test can pass a small stand-in) and every query filters by "userId".

const MAX_SCENE_BYTES = 6 * 1024 * 1024; // a scene with a few pasted pictures; bigger than this is refused with a plain message
const MAX_THUMB_BYTES = 150 * 1024;
const MAX_ELEMENTS = 20000;
const MAX_DRAWINGS_PER_USER = 300;
const MAX_TITLE = 120;
const DEFAULT_TITLE = 'Untitled drawing';
const LOOKS = ['sketch', 'clean'];
const EMPTY_SCENE = JSON.stringify({ type: 'excalidraw', version: 2, source: 'vault', elements: [], appState: {}, files: {} });

class DrawingError extends Error {
  constructor(message, status = 400, code = null) { super(message); this.status = status; this.code = code; }
}

function cleanTitle(v, fallback = DEFAULT_TITLE) {
  const t = String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  return t || fallback;
}

/** The scene as JSON text plus how many drawn things it holds. Accepts the text or the parsed object. Throws DrawingError (plain words). */
function checkScene(input) {
  let text;
  let obj;
  if (typeof input === 'string') {
    text = input;
  } else if (input && typeof input === 'object') {
    text = JSON.stringify(input);
  } else {
    throw new DrawingError('There is no drawing to save.');
  }
  if (Buffer.byteLength(text) > MAX_SCENE_BYTES) {
    throw new DrawingError(`This drawing is too big to save (the limit is ${Math.round(MAX_SCENE_BYTES / 1048576)} MB, usually because of large pictures pasted into it). Remove or shrink a picture and try again.`, 413, 'TOO_BIG');
  }
  try { obj = typeof input === 'object' ? input : JSON.parse(text); } catch { throw new DrawingError('That is not a drawing file.'); }
  if (!obj || obj.type !== 'excalidraw' || !Array.isArray(obj.elements)) throw new DrawingError('That is not a drawing file.');
  if (obj.elements.length > MAX_ELEMENTS) throw new DrawingError(`This drawing has too many pieces (more than ${MAX_ELEMENTS}). Split it into two drawings.`, 413, 'TOO_MANY');
  return { text, elementCount: obj.elements.filter((e) => e && !e.isDeleted).length, bytes: Buffer.byteLength(text) };
}

/** 'sketch' or 'clean'. Anything else is refused (undefined means "not given"). */
function checkLook(v) {
  if (v === undefined) return undefined;
  if (!LOOKS.includes(v)) throw new DrawingError('That look is not known. Choose sketch or clean.');
  return v;
}

/** A small picture for the list: a JPEG, PNG or WebP data URL, or nothing. */
function checkThumbnail(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)) throw new DrawingError('The preview picture was not valid.');
  if (Buffer.byteLength(s) > MAX_THUMB_BYTES) throw new DrawingError('The preview picture was too big.');
  return s;
}

const LIST_COLS = 'id, title, thumbnail, look, "elementCount", "sceneBytes", "createdAt", "updatedAt"';

async function list(db, userId) {
  const { rows } = await db.query(`SELECT ${LIST_COLS} FROM drawings WHERE "userId" = $1 ORDER BY "updatedAt" DESC, id DESC LIMIT 500`, [userId]);
  return rows;
}

async function get(db, userId, id) {
  const { rows } = await db.query(`SELECT ${LIST_COLS}, scene FROM drawings WHERE id = $1 AND "userId" = $2`, [id, userId]);
  if (!rows[0]) throw new DrawingError('That drawing was not found.', 404);
  return rows[0];
}

async function assertRoom(db, userId) {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM drawings WHERE "userId" = $1', [userId]);
  if (Number(rows[0]?.n ?? 0) >= MAX_DRAWINGS_PER_USER) throw new DrawingError(`You already have ${MAX_DRAWINGS_PER_USER} drawings. Delete some to make a new one.`, 409, 'FULL');
}

async function create(db, userId, { title, scene, thumbnail, look } = {}) {
  const checked = checkScene(scene == null ? EMPTY_SCENE : scene);
  const thumb = checkThumbnail(thumbnail);
  const lk = checkLook(look) || 'sketch';
  await assertRoom(db, userId);
  const { rows } = await db.query(
    `INSERT INTO drawings ("userId", title, scene, thumbnail, look, "elementCount", "sceneBytes") VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING ${LIST_COLS}`,
    [userId, cleanTitle(title), checked.text, thumb, lk, checked.elementCount, checked.bytes]);
  return rows[0];
}

/**
 * Change a drawing: any of title, scene, thumbnail, look. `baseUpdatedAt` is the "updatedAt" the page last saw: if the drawing changed since
 * (saved from another tab), nothing is overwritten and a 409 says so.
 */
async function update(db, userId, id, patch = {}) {
  const sets = [];
  const vals = [];
  const add = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length + 3}`); };
  if (patch.title !== undefined) add('title', cleanTitle(patch.title));
  if (patch.scene !== undefined) {
    const c = checkScene(patch.scene);
    add('scene', c.text); add('"elementCount"', c.elementCount); add('"sceneBytes"', c.bytes);
  }
  if (patch.thumbnail !== undefined) add('thumbnail', checkThumbnail(patch.thumbnail));
  if (patch.look !== undefined) add('look', checkLook(patch.look));
  if (!sets.length) throw new DrawingError('Nothing to save.');
  const base = patch.baseUpdatedAt ? new Date(patch.baseUpdatedAt) : null;
  if (base && Number.isNaN(base.getTime())) throw new DrawingError('That save time was not valid.');
  const { rows } = await db.query(
    `UPDATE drawings SET ${sets.join(', ')}, "updatedAt" = NOW()
      WHERE id = $1 AND "userId" = $2 AND ($3::timestamptz IS NULL OR date_trunc('milliseconds', "updatedAt") <= $3::timestamptz)
      RETURNING ${LIST_COLS}`,
    [id, userId, base ? base.toISOString() : null, ...vals]);
  if (rows[0]) return rows[0];
  const { rows: exists } = await db.query('SELECT 1 FROM drawings WHERE id = $1 AND "userId" = $2', [id, userId]);
  if (!exists[0]) throw new DrawingError('That drawing was not found.', 404);
  throw new DrawingError('This drawing was changed somewhere else (another tab?) since you opened it. Reload to see the newer version.', 409, 'CHANGED');
}

async function duplicate(db, userId, id) {
  const src = await get(db, userId, id);
  await assertRoom(db, userId);
  const { rows } = await db.query(
    `INSERT INTO drawings ("userId", title, scene, thumbnail, look, "elementCount", "sceneBytes")
     SELECT "userId", $3, scene, thumbnail, look, "elementCount", "sceneBytes" FROM drawings WHERE id = $2 AND "userId" = $1 RETURNING ${LIST_COLS}`,
    [userId, id, cleanTitle(`${src.title} (copy)`)]);
  return rows[0];
}

module.exports = {
  list, get, create, update, duplicate, checkScene, checkThumbnail, checkLook, cleanTitle, DrawingError, LOOKS,
  MAX_SCENE_BYTES, MAX_THUMB_BYTES, MAX_ELEMENTS, MAX_DRAWINGS_PER_USER, MAX_TITLE, DEFAULT_TITLE, EMPTY_SCENE,
};
