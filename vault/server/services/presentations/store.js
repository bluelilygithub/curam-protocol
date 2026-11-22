'use strict';

// Saved decks and custom themes. The canonical deck JSON is the single source of truth: the browser edits it, the server stores
// it, and every renderer/export reads it back. See docs/presentations.md.

const { pool } = require('../../db');
const { normalizeDeck, sanitizeCustomTheme, resolveTheme, PresentationError } = require('./schema');
const { loadKit } = require('../graphicsBrandKit');

const MAX_DECKS_PER_USER = 200;
const MAX_THEMES_PER_USER = 50;
const HEX = /^#[0-9a-fA-F]{6}$/;

const rowToDeck = (r) => ({
  id: r.id,
  title: r.title,
  themeId: r['themeId'],
  sourceType: r['sourceType'] || null,
  data: r.data,
  createdAt: r['createdAt'],
  updatedAt: r['updatedAt'],
});

const rowToTheme = (r) => ({
  id: r.id,
  name: r.name,
  theme: r.theme,
  source: r.source,
  createdAt: r['createdAt'],
  updatedAt: r['updatedAt'],
});

async function listDecks(db = pool, userId) {
  const { rows } = await db.query(
    `SELECT id, title, "themeId", "sourceType", data, "createdAt", "updatedAt" FROM presentation_decks
      WHERE "userId" = $1 ORDER BY "updatedAt" DESC LIMIT $2`,
    [userId, MAX_DECKS_PER_USER]);
  return rows.map(rowToDeck);
}

async function getDeck(db = pool, userId, id) {
  const { rows } = await db.query(
    `SELECT id, title, "themeId", "sourceType", data, "createdAt", "updatedAt" FROM presentation_decks
      WHERE id = $1 AND "userId" = $2`,
    [Number(id) || 0, userId]);
  return rows[0] ? rowToDeck(rows[0]) : null;
}

/** Create or update a saved deck. A valid id in `input` updates only a deck owned by this person. */
async function saveDeck(db = pool, userId, input = {}) {
  const id = Number(input.id) || 0;
  const existing = id ? await getDeck(db, userId, id) : null;
  if (id && !existing) throw new PresentationError('That deck was not found.', 404);
  if (!existing) {
    const { rows: count } = await db.query('SELECT COUNT(*) AS n FROM presentation_decks WHERE "userId" = $1', [userId]);
    if (Number(count[0]?.n || 0) >= MAX_DECKS_PER_USER) throw new PresentationError('Your deck library is full. Delete a deck first.', 409);
  }
  const data = normalizeDeck(input.deck);
  const title = String(input.title || '').trim().slice(0, 160) || data.title;
  const sourceType = String(input.sourceType || (existing && existing.sourceType) || '').trim().slice(0, 40) || null;
  const sql = existing
    ? `UPDATE presentation_decks SET title = $1, "themeId" = $2, "sourceType" = $3, data = $4::jsonb, "updatedAt" = NOW()
        WHERE id = $5 AND "userId" = $6 RETURNING id, title, "themeId", "sourceType", data, "createdAt", "updatedAt"`
    : `INSERT INTO presentation_decks ("userId", title, "themeId", "sourceType", data)
        VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING id, title, "themeId", "sourceType", data, "createdAt", "updatedAt"`;
  const params = existing
    ? [title, data.themeId, sourceType, JSON.stringify(data), existing.id, userId]
    : [userId, title, data.themeId, sourceType, JSON.stringify(data)];
  const { rows } = await db.query(sql, params);
  return rowToDeck(rows[0]);
}

async function duplicateDeck(db = pool, userId, id) {
  const source = await getDeck(db, userId, id);
  if (!source) throw new PresentationError('That deck was not found.', 404);
  return saveDeck(db, userId, {
    title: `${source.title} (copy)`.slice(0, 160),
    sourceType: source.sourceType,
    deck: { ...source.data, title: `${source.data.title} (copy)`.slice(0, 160) },
  });
}

/** Delete into the shared recycle bin. Uses a transaction so the snapshot and the delete succeed or fail together. */
async function deleteDeck(userId, id) {
  const bin = require('../recycleBin');
  bin.loadAdapters();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM presentation_decks WHERE id = $1 AND "userId" = $2 FOR UPDATE', [Number(id) || 0, userId]);
    const row = rows[0];
    if (!row) { await db.query('ROLLBACK'); return null; }
    const binId = await bin.moveToBin(db, {
      userId, type: 'presentation-deck', id: row.id, title: row.title,
      detail: `${Array.isArray(row.data?.slides) ? row.data.slides.length : 0} slides`,
      payload: { deck: row }, maxBytes: 120 * 1024 * 1024,
    });
    await db.query('DELETE FROM presentation_decks WHERE id = $1 AND "userId" = $2', [row.id, userId]);
    await db.query('COMMIT');
    return binId;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

async function listThemes(db = pool, userId) {
  const { rows } = await db.query(
    `SELECT id, name, theme, source, "createdAt", "updatedAt" FROM presentation_templates
      WHERE "userId" = $1 ORDER BY "updatedAt" DESC LIMIT $2`,
    [userId, MAX_THEMES_PER_USER]);
  return rows.map(rowToTheme);
}

async function saveTheme(db = pool, userId, input = {}) {
  const { rows: count } = await db.query('SELECT COUNT(*) AS n FROM presentation_templates WHERE "userId" = $1', [userId]);
  if (Number(count[0]?.n || 0) >= MAX_THEMES_PER_USER) throw new PresentationError('You already have 50 saved themes. Delete one first.', 409);
  const theme = sanitizeCustomTheme(input.theme || input);
  const name = String(input.name || '').trim().slice(0, 80) || theme.label;
  const source = ['saved', 'import'].includes(input.source) ? input.source : 'saved';
  const { rows } = await db.query(
    `INSERT INTO presentation_templates ("userId", name, theme, source) VALUES ($1, $2, $3::jsonb, $4)
      RETURNING id, name, theme, source, "createdAt", "updatedAt"`,
    [userId, name, JSON.stringify(theme), source]);
  return rowToTheme(rows[0]);
}

async function deleteTheme(userId, id) {
  const bin = require('../recycleBin');
  bin.loadAdapters();
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query('SELECT * FROM presentation_templates WHERE id = $1 AND "userId" = $2 FOR UPDATE', [Number(id) || 0, userId]);
    const row = rows[0];
    if (!row) { await db.query('ROLLBACK'); return null; }
    const binId = await bin.moveToBin(db, {
      userId, type: 'presentation-template', id: row.id, title: row.name,
      detail: row.source || 'saved theme', payload: { theme: row }, maxBytes: 2 * 1024 * 1024,
    });
    await db.query('DELETE FROM presentation_templates WHERE id = $1 AND "userId" = $2', [row.id, userId]);
    await db.query('COMMIT');
    return binId;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

/** Only the small, useful parts of the Graphics Brand Kit: colours, font name and logo. Values are always optional. */
async function getBrand(db = pool, userId) {
  const kit = await loadKit(db, userId);
  const roles = kit.roles || {};
  const colours = Array.isArray(kit.colors) ? kit.colors.filter((c) => HEX.test(c)) : [];
  const font = String(kit.fontFamily || kit.headingFont?.family || '').slice(0, 120);
  const logoDataUrl = String(kit.logoDataUrl || '').startsWith('data:image/') ? String(kit.logoDataUrl).slice(0, 6 * 1024 * 1024) : '';
  const available = Boolean(HEX.test(roles.primary) || HEX.test(roles.background) || HEX.test(roles.text) || colours.length || font || logoDataUrl);
  return {
    available,
    label: font || (colours[0] && `${colours[0]} Brand Kit`) || 'Graphics Brand Kit',
    bg: HEX.test(roles.background) ? roles.background : null,
    text: HEX.test(roles.text) ? roles.text : null,
    primary: HEX.test(roles.primary) ? roles.primary : (colours[0] || null),
    muted: HEX.test(roles.mutedText) ? roles.mutedText : null,
    font,
    logoDataUrl,
  };
}

/** Apply a Brand Kit as an override on top of a built-in or saved theme. Never mutates the stored theme. */
/** Resolve a built-in id, a saved custom id or a full theme object, then apply the Brand Kit override. */
async function resolveThemeForUser(db, userId, themeOrId, brand, { applyBrand = false } = {}) {
  let value = themeOrId;
  if (typeof themeOrId === 'string' && themeOrId.startsWith('custom-')) {
    const { rows } = await db.query(
      `SELECT theme FROM presentation_templates WHERE "userId" = $1 AND theme->>'id' = $2 LIMIT 1`,
      [userId, themeOrId]);
    value = rows[0]?.theme || themeOrId;
  }
  return themeWithBrand(value, brand, { applyBrand });
}

function themeWithBrand(themeOrId, brand, { applyBrand = false } = {}) {
  const theme = { ...resolveTheme(themeOrId) };
  if (!applyBrand || !brand?.available) return theme;
  for (const key of ['bg', 'text', 'primary', 'muted', 'font']) {
    if (brand[key]) theme[key] = brand[key];
  }
  if (brand.logoDataUrl) {
    theme.showLogo = true;
    theme.logoDataUrl = brand.logoDataUrl;
  }
  return theme;
}

module.exports = {
  MAX_DECKS_PER_USER, MAX_THEMES_PER_USER,
  listDecks, getDeck, saveDeck, duplicateDeck, deleteDeck,
  listThemes, saveTheme, deleteTheme,
  getBrand, themeWithBrand, resolveThemeForUser, rowToDeck, rowToTheme,
};
