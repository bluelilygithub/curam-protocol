'use strict';

// Sketchbook: cartoon pictures a person describes in words and the image model draws. This file is the rules and the SQL (and the
// wording sent to the image model); routes/sketchbook.js is the HTTP side, services/sketchbookEngine.js talks to the image provider and
// services/recycleBin/adapters/sketchbook.js puts a deleted picture back. See docs/sketchbook.md.
//
// Every function takes the database as its first argument (so a test can pass a small stand-in) and every query filters by "userId".

const crypto = require('crypto');

const MAX_SKETCHES_PER_USER = 200;
const MAX_VERSIONS = 6; // earlier pictures kept per sketch, so a change can be taken back
const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_INSTRUCTION = 800;
const MAX_IMAGE_CHARS = 6 * 1024 * 1024; // a data URL; a 1024px picture is about 0.3-1.5 MB
const MAX_THUMB_CHARS = 150 * 1024;
const DEFAULT_TITLE = 'Untitled sketch';

const STYLES = {
  pencil: {
    label: 'Pencil',
    tip: 'Black and grey pencil on white paper.',
    prompt: 'hand-drawn pencil sketch, graphite on white paper, loose confident linework with light cross-hatching for shading, black and grey only, no colour',
  },
  pen: {
    label: 'Pen',
    tip: 'Ink-pen linework in one colour of your choice.',
    prompt: 'hand-drawn ink pen cartoon on white paper, clean confident linework with simple hatching, no filled areas',
  },
  coloured: {
    label: 'Coloured in',
    tip: 'Pen outlines coloured in with a bright, friendly palette.',
    prompt: 'hand-drawn cartoon illustration, bold ink outlines with flat coloured-in fills, bright friendly palette, clean white background',
  },
};
const STYLE_IDS = Object.keys(STYLES);

// Pen colours: a short fixed list (never a free-text colour that would go into a prompt).
const PEN_COLORS = {
  black: { label: 'Black', hex: '#1f1f1f' },
  blue: { label: 'Blue', hex: '#1d4ed8' },
  red: { label: 'Red', hex: '#dc2626' },
  green: { label: 'Green', hex: '#15803d' },
  brown: { label: 'Brown', hex: '#78350f' },
  purple: { label: 'Purple', hex: '#7e22ce' },
  orange: { label: 'Orange', hex: '#ea580c' },
};
const PEN_COLOR_IDS = Object.keys(PEN_COLORS);

// Picture shapes; both sides are multiples of 64 (what the image providers expect).
const ASPECTS = {
  landscape: { width: 1024, height: 768, label: 'Wide' },
  square: { width: 768, height: 768, label: 'Square' },
  portrait: { width: 768, height: 1024, label: 'Tall' },
};

class SketchError extends Error {
  constructor(message, status = 400, code = null) { super(message); this.status = status; this.code = code; }
}

const stripControl = (v) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, ' ');

function cleanTitle(v, fallback = DEFAULT_TITLE) {
  const t = stripControl(v).replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  return t || fallback;
}

/** What the person typed, as plain text (line breaks kept). Throws when it is empty or too long. */
function cleanText(v, { max, what }) {
  const t = stripControl(v).replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!t) throw new SketchError(`Say ${what} first.`);
  if (t.length > max) throw new SketchError(`That is too long (${t.length} characters; the limit is ${max}). Shorten it and try again.`, 413);
  return t;
}
const cleanDescription = (v) => cleanText(v, { max: MAX_DESCRIPTION, what: 'what you want drawn' });
const cleanInstruction = (v) => cleanText(v, { max: MAX_INSTRUCTION, what: 'what you want changed' });

function checkStyle(v, fallback = 'pencil') {
  if (v == null || v === '') return fallback;
  if (!STYLE_IDS.includes(v)) throw new SketchError('That drawing style is not known. Choose pencil, pen or coloured in.');
  return v;
}
function checkPenColor(v, fallback = 'black') {
  if (v == null || v === '') return fallback;
  if (!PEN_COLOR_IDS.includes(v)) throw new SketchError('That pen colour is not known.');
  return v;
}
function checkAspect(v) {
  if (v == null || v === '') return 'landscape';
  if (!ASPECTS[v]) throw new SketchError('That picture shape is not known. Choose wide, square or tall.');
  return v;
}

const IMAGE_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;
function checkImage(v) {
  const s = String(v || '');
  if (!IMAGE_RE.test(s)) throw new SketchError('The picture was not valid.');
  if (s.length > MAX_IMAGE_CHARS) throw new SketchError('The picture is too big to keep.', 413);
  return s;
}
function checkThumbnail(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (!IMAGE_RE.test(s) || s.length > MAX_THUMB_CHARS) return null; // a bad preview is dropped, never a reason to lose the picture
  return s;
}

// ── The words sent to the image model ────────────────────────────────────────────────────────────────────────────────────────────────

/** The look, as words. For the pen style the colour is named; for the others the pen colour is ignored. */
function styleWords(style, penColor) {
  const s = STYLES[checkStyle(style)];
  if (style === 'pen') {
    const c = PEN_COLORS[checkPenColor(penColor)].label.toLowerCase();
    return `${s.prompt}, drawn only in ${c} ink`;
  }
  return s.prompt;
}

/** A new picture. The person's words go in as the subject; nothing else of theirs is added. */
function buildDrawPrompt({ description, style, penColor }) {
  const subject = cleanDescription(description);
  return [
    'A single cartoon scene that illustrates the following idea. If the idea is abstract, show it through a clear visual metaphor with simple, expressive characters.',
    `Idea: ${subject}`,
    `Style: ${styleWords(style, penColor)}.`,
    'Simple readable composition, uncluttered background. No captions, no lettering, no watermark.',
  ].join('\n');
}

/** Changing a picture that already exists: keep it, apply the person's instruction (and the look, when the look is being changed). */
function buildChangePrompt({ instruction, style, penColor, changeStyle }) {
  const what = cleanInstruction(instruction);
  const parts = [
    `Edit this cartoon drawing: ${what}`,
    'Keep everything else exactly the same: the characters, their faces and clothes, the composition and the drawing style.',
  ];
  if (changeStyle) parts.push(`Redraw it in this style: ${styleWords(style, penColor)}.`);
  parts.push('No captions, no lettering, no watermark.');
  return parts.join('\n');
}

/** "Colour it in" and the look buttons: the same picture in another look. */
function restyleInstruction(style) {
  if (style === 'coloured') return 'Colour in the drawing with a bright friendly palette. Keep the outlines and every shape where it is.';
  if (style === 'pen') return 'Redraw the picture as ink pen linework with no filled areas. Keep every shape where it is.';
  return 'Redraw the picture as a pencil sketch with no colour. Keep every shape where it is.';
}

// ── Versions (earlier pictures) ──────────────────────────────────────────────────────────────────────────────────────────────────────

function parseVersions(text) {
  try {
    const v = JSON.parse(text || '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.vid === 'string' && typeof x.image === 'string') : [];
  } catch { return []; }
}

/** What the page is told about earlier pictures: no picture data, only the small preview. */
const summariseVersions = (list) => list.map((v) => ({ vid: v.vid, at: v.at, note: v.note || '', thumb: v.thumb || null }));

/** The earlier pictures after one more is added (newest first, at most MAX_VERSIONS). */
function pushVersion(list, { image, thumb, note, style, penColor }) {
  // the look the picture had is kept with it, so putting it back puts the look back too
  const entry = { vid: crypto.randomBytes(6).toString('hex'), at: new Date().toISOString(), note: String(note || '').slice(0, 200), thumb: thumb || null, image, style: style || null, penColor: penColor || null };
  return [entry, ...list].slice(0, MAX_VERSIONS);
}

// ── SQL ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const LIST_COLS = 'id, title, description, style, "penColor", thumbnail, width, height, "changeCount", "createdAt", "updatedAt"';

/**
 * How many of the person's notes link back to each sketch, as { [sketchId]: count }. One pass over the notes that mention "/sketchbook/" at
 * all. The note's own text is the record (To Notes writes "[Title](/sketchbook/12)" into it), so a deleted note or a removed link stops
 * counting, and a note the person linked by hand counts too.
 */
async function noteCounts(db, userId) {
  const { rows } = await db.query(
    `SELECT (m.hit)[1]::int AS id, COUNT(DISTINCT n.id)::int AS n
       FROM notes n, LATERAL regexp_matches(n.body, '\\]\\(/sketchbook/([0-9]+)\\)', 'g') AS m(hit)
      WHERE n.user_id = $1 AND n.body LIKE '%](/sketchbook/%'
      GROUP BY 1`, [userId]);
  return Object.fromEntries(rows.map((r) => [r.id, r.n]));
}

async function list(db, userId) {
  const { rows } = await db.query(`SELECT ${LIST_COLS} FROM sketches WHERE "userId" = $1 ORDER BY "updatedAt" DESC, id DESC LIMIT 500`, [userId]);
  const counts = await noteCounts(db, userId);
  return rows.map((r) => ({ ...r, noteCount: counts[r.id] || 0 }));
}

/** The person's notes that link back to this sketch, newest change first, at most 20. Another person's sketch is "not found". */
async function linkedNotes(db, userId, id) {
  await getRow(db, userId, id);
  const { rows } = await db.query(
    `SELECT id, title, updated_at AS "updatedAt" FROM notes WHERE user_id = $1 AND body LIKE $2 ESCAPE '\\' ORDER BY updated_at DESC, id DESC LIMIT 20`,
    [userId, `%](/sketchbook/${Number(id)})%`]);
  return rows;
}

async function getRow(db, userId, id) {
  const { rows } = await db.query(`SELECT ${LIST_COLS}, image, versions FROM sketches WHERE id = $1 AND "userId" = $2`, [id, userId]);
  if (!rows[0]) throw new SketchError('That sketch was not found.', 404);
  return rows[0];
}

/** One sketch with its picture and a summary of its earlier pictures (no picture data in that summary). */
async function get(db, userId, id) {
  const r = await getRow(db, userId, id);
  const { versions, ...rest } = r;
  return { ...rest, versions: summariseVersions(parseVersions(versions)) };
}

/** The full picture of one earlier version. */
async function getVersion(db, userId, id, vid) {
  const r = await getRow(db, userId, id);
  const v = parseVersions(r.versions).find((x) => x.vid === vid);
  if (!v) throw new SketchError('That earlier picture was not found.', 404);
  return { vid: v.vid, at: v.at, note: v.note || '', image: v.image };
}

async function assertRoom(db, userId) {
  const { rows } = await db.query('SELECT COUNT(*) AS n FROM sketches WHERE "userId" = $1', [userId]);
  if (Number(rows[0]?.n ?? 0) >= MAX_SKETCHES_PER_USER) throw new SketchError(`You already have ${MAX_SKETCHES_PER_USER} sketches. Delete some to make a new one.`, 409, 'FULL');
}

/** The count check, run BEFORE paying for a picture (create runs it again, so the cap holds even if two jobs race). */
const checkRoom = assertRoom;

async function create(db, userId, { title, description, style, penColor, image, thumbnail, width, height, seed, model }) {
  const img = checkImage(image);
  await assertRoom(db, userId);
  const { rows } = await db.query(
    `INSERT INTO sketches ("userId", title, description, style, "penColor", image, thumbnail, width, height, seed, model)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ${LIST_COLS}`,
    [userId, cleanTitle(title), String(description || '').slice(0, MAX_DESCRIPTION), checkStyle(style), checkPenColor(penColor), img, checkThumbnail(thumbnail),
      Math.max(0, Math.round(Number(width) || 0)), Math.max(0, Math.round(Number(height) || 0)),
      Number.isFinite(Number(seed)) ? Math.round(Number(seed)) : null, model ? String(model).slice(0, 200) : null]);
  return rows[0];
}

/**
 * A new picture for an existing sketch (a change or a new look). The picture it replaces is kept as the newest earlier version.
 * `baseUpdatedAt` is the "updatedAt" the page last saw: if the sketch changed since (another tab), nothing is overwritten and a 409 says so.
 */
async function applyChange(db, userId, id, { image, thumbnail, note, style, penColor, seed, model, baseUpdatedAt }) {
  const img = checkImage(image);
  const base = baseUpdatedAt ? new Date(baseUpdatedAt) : null;
  if (base && Number.isNaN(base.getTime())) throw new SketchError('That save time was not valid.');
  const cur = await getRow(db, userId, id);
  const versions = pushVersion(parseVersions(cur.versions), { image: cur.image, thumb: cur.thumbnail, note, style: cur.style, penColor: cur.penColor });
  const { rows } = await db.query(
    `UPDATE sketches SET image = $3, thumbnail = $4, style = $5, "penColor" = $6, seed = COALESCE($7, seed), model = COALESCE($8, model),
            versions = $9, "changeCount" = "changeCount" + 1, "updatedAt" = NOW()
      WHERE id = $1 AND "userId" = $2 AND ($10::timestamptz IS NULL OR date_trunc('milliseconds', "updatedAt") <= $10::timestamptz)
      RETURNING ${LIST_COLS}`,
    [id, userId, img, checkThumbnail(thumbnail), checkStyle(style, cur.style), checkPenColor(penColor, cur.penColor),
      Number.isFinite(Number(seed)) ? Math.round(Number(seed)) : null, model ? String(model).slice(0, 200) : null,
      JSON.stringify(versions), base ? base.toISOString() : null]);
  if (rows[0]) return rows[0];
  throw new SketchError('This sketch was changed somewhere else (another tab?) since you opened it. Reload to see the newer version.', 409, 'CHANGED');
}

/** Put an earlier picture back. The picture being replaced becomes the newest earlier version, so this can be taken back too. */
async function restoreVersion(db, userId, id, vid, { baseUpdatedAt } = {}) {
  const cur = await getRow(db, userId, id);
  const all = parseVersions(cur.versions);
  const v = all.find((x) => x.vid === vid);
  if (!v) throw new SketchError('That earlier picture was not found.', 404);
  const rest = all.filter((x) => x.vid !== vid);
  const versions = pushVersion(rest, { image: cur.image, thumb: cur.thumbnail, note: 'an earlier picture was put back', style: cur.style, penColor: cur.penColor });
  const base = baseUpdatedAt ? new Date(baseUpdatedAt) : null;
  if (base && Number.isNaN(base.getTime())) throw new SketchError('That save time was not valid.');
  const { rows } = await db.query(
    `UPDATE sketches SET image = $3, thumbnail = $4, versions = $5, style = $7, "penColor" = $8, "changeCount" = "changeCount" + 1, "updatedAt" = NOW()
      WHERE id = $1 AND "userId" = $2 AND ($6::timestamptz IS NULL OR date_trunc('milliseconds', "updatedAt") <= $6::timestamptz)
      RETURNING ${LIST_COLS}`,
    [id, userId, v.image, v.thumb || null, JSON.stringify(versions), base ? base.toISOString() : null,
      STYLE_IDS.includes(v.style) ? v.style : cur.style, PEN_COLOR_IDS.includes(v.penColor) ? v.penColor : cur.penColor]);
  if (rows[0]) return rows[0];
  throw new SketchError('This sketch was changed somewhere else (another tab?) since you opened it. Reload to see the newer version.', 409, 'CHANGED');
}

async function rename(db, userId, id, title) {
  const { rows } = await db.query(`UPDATE sketches SET title = $3, "updatedAt" = NOW() WHERE id = $1 AND "userId" = $2 RETURNING ${LIST_COLS}`, [id, userId, cleanTitle(title)]);
  if (!rows[0]) throw new SketchError('That sketch was not found.', 404);
  return rows[0];
}

async function duplicate(db, userId, id) {
  const src = await getRow(db, userId, id);
  await assertRoom(db, userId);
  const { rows } = await db.query(
    `INSERT INTO sketches ("userId", title, description, style, "penColor", image, thumbnail, width, height, seed, model)
     SELECT "userId", $3, description, style, "penColor", image, thumbnail, width, height, seed, model FROM sketches WHERE id = $2 AND "userId" = $1
     RETURNING ${LIST_COLS}`,
    [userId, id, cleanTitle(`${src.title} (copy)`)]);
  return rows[0];
}

/** A title from the first words of the description, for a new sketch the person did not name. */
function titleFromDescription(description) {
  const all = stripControl(description).replace(/\s+/g, ' ').trim().split(' ');
  let words = all.slice(0, 8);
  // do not stop on a joining word ("... checks a")
  while (words.length > 1 && /^(a|an|the|of|on|in|at|to|and|or|with|while|as|by|for|from|that|who)$/i.test(words[words.length - 1].replace(/[^\w]/g, ''))) words = words.slice(0, -1);
  const t = words.join(' ').replace(/[,;:.\s]+$/, '');
  return cleanTitle(t.length > 60 ? `${t.slice(0, 57)}...` : t);
}

module.exports = {
  list, linkedNotes, get, getVersion, create, applyChange, restoreVersion, rename, duplicate, checkRoom,
  buildDrawPrompt, buildChangePrompt, restyleInstruction, styleWords, titleFromDescription,
  cleanTitle, cleanDescription, cleanInstruction, checkStyle, checkPenColor, checkAspect, checkImage, checkThumbnail,
  parseVersions, summariseVersions, pushVersion,
  SketchError, STYLES, STYLE_IDS, PEN_COLORS, PEN_COLOR_IDS, ASPECTS,
  MAX_SKETCHES_PER_USER, MAX_VERSIONS, MAX_TITLE, MAX_DESCRIPTION, MAX_INSTRUCTION, MAX_IMAGE_CHARS, DEFAULT_TITLE,
};
