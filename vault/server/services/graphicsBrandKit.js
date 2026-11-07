'use strict';

// Keeping a brand read from a website (docs/brand-from-url.md, step 3).
//
// The Brand Kit itself is still one JSON value in `settings` (key graphics_brand_kit, per person) that the Graphics screen reads and
// writes. This adds optional fields to it and keeps the two font FILES in their own table, graphics_brand_fonts (one heading and one
// body font per person), because a font is up to a few hundred KB of bytes and the kit JSON is loaded by every Graphics tool.
//
// "Use this" (applyProposal) takes a proposal made by POST /brand-from-url and copies only the parts the person ticked into the kit,
// in one transaction, so the kit JSON and the font table never disagree. Fields it does not know about are left alone.
//
// Kit fields added (all optional; a kit without them behaves exactly as before):
//   roles { background, surface, text, mutedText, primary, onPrimary, accent, border }   palette [hex...]   dark { background, text, primary }
//   radius { px, label }   headingFont / bodyFont { family, weight, stored, renderFamily?, source? }   source { url, readAt }
// and, as before, logoDataUrl, colors (up to 3, swatches), fontFamily (the heading font's name).

const crypto = require('crypto');

const KIT_KEY = 'graphics_brand_kit';
const ROLES = ['heading', 'body'];
const MAX_FONT_BYTES = 4 * 1024 * 1024;
const SFNT_MAGIC = new Set(['00010000', '4f54544f', '74727565']); // TrueType, OpenType (CFF), old Apple TrueType
const HEX = /^#[0-9a-f]{6}$/;
const ROLE_KEYS = ['background', 'surface', 'text', 'mutedText', 'primary', 'onPrimary', 'accent', 'border'];

class BrandKitError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function parseKit(value) {
  try {
    const k = JSON.parse(value);
    return k && typeof k === 'object' && !Array.isArray(k) ? k : {};
  } catch { return {}; }
}

/** What the person ticked. Returns { colours, radius, logoIndex, fonts: { heading, body } } or throws BrandKitError. */
function sanitizeUse(input) {
  const u = input && typeof input === 'object' ? input : {};
  const logoIndex = Number.isInteger(u.logoIndex) && u.logoIndex >= 0 && u.logoIndex < 10 ? u.logoIndex : null;
  const out = {
    colours: u.colours === true,
    radius: u.radius === true,
    logoIndex,
    fonts: { heading: !!(u.fonts && u.fonts.heading === true), body: !!(u.fonts && u.fonts.body === true) },
  };
  if (!out.colours && !out.radius && out.logoIndex === null && !out.fonts.heading && !out.fonts.body) {
    throw new BrandKitError('Tick at least one thing to use.');
  }
  return out;
}

/** The font file of a proposal checked again before it is kept: the right kind of file, a sane size, and the bytes the reader recorded. */
function checkFontFile(file) {
  const buf = file && file.buffer;
  if (!Buffer.isBuffer(buf) || buf.length < 1000) throw new BrandKitError('That font file is not usable. Read the website again.');
  if (buf.length > MAX_FONT_BYTES) throw new BrandKitError('That font file is too large to keep.');
  if (!SFNT_MAGIC.has(buf.slice(0, 4).toString('hex'))) throw new BrandKitError('That font file is not a TrueType or OpenType font.');
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  if (file.sha256 && file.sha256 !== sha) throw new BrandKitError('That font file changed after it was read. Read the website again.');
  if (!/^BrandFont[0-9a-f]{8}$/.test(String(file.renderFamily || ''))) throw new BrandKitError('That font file has no usable name.');
  return sha;
}

/** Pure: the new kit JSON from the old one, a proposal and what was ticked. Returns { kit, changed }. */
function mergeKit(oldKit, proposal, use, now = new Date()) {
  const kit = { ...oldKit };
  const changed = [];

  if (use.colours) {
    const roles = {};
    for (const k of ROLE_KEYS) {
      const v = proposal.colours && proposal.colours[k];
      if (typeof v === 'string' && HEX.test(v)) roles[k] = v;
    }
    if (!roles.primary && !roles.background) throw new BrandKitError('No colours were found on that website.');
    kit.roles = roles;
    // the three swatches the tools already show: the brand colour, a second one, and the text colour
    kit.colors = [...new Set([roles.primary, roles.accent, roles.text].filter(Boolean))].slice(0, 3);
    kit.palette = (Array.isArray(proposal.palette) ? proposal.palette : []).filter((c) => typeof c === 'string' && HEX.test(c)).slice(0, 10);
    const d = proposal.dark;
    if (d && HEX.test(d.background) && HEX.test(d.text)) kit.dark = { background: d.background, text: d.text, ...(HEX.test(d.primary) ? { primary: d.primary } : {}) };
    else delete kit.dark;
    changed.push('colours');
  }

  if (use.radius) {
    const r = proposal.radius;
    if (!r || !Number.isFinite(r.px)) throw new BrandKitError('No corner style was found on that website.');
    kit.radius = { px: r.px, label: String(r.label || '').slice(0, 20) };
    changed.push('corners');
  }

  if (Number.isInteger(use.logoIndex)) {
    const logo = Array.isArray(proposal.logos) ? proposal.logos[use.logoIndex] : null;
    if (!logo || !/^data:image\/png;base64,/.test(String(logo.dataUrl || ''))) throw new BrandKitError('That logo is not available. Read the website again.');
    kit.logoDataUrl = logo.dataUrl;
    changed.push('logo');
  }

  for (const role of ROLES) {
    if (!(use.fonts && use.fonts[role])) continue;
    const f = proposal.fonts && proposal.fonts[role];
    if (!f || !f.family) throw new BrandKitError(`No ${role} font was found on that website.`);
    const stored = !!f.file;
    kit[`${role}Font`] = {
      family: String(f.family).slice(0, 80), weight: Number(f.weight) || 400, stored,
      ...(stored ? { renderFamily: f.file.renderFamily, source: f.source || null } : {}),
    };
    if (role === 'heading') kit.fontFamily = String(f.family).slice(0, 80); // the name field the kit already had
    changed.push(`${role} font`);
  }

  if (changed.length) kit.source = { url: String(proposal.finalUrl || proposal.sourceUrl || '').slice(0, 300), readAt: now.toISOString() };
  return { kit, changed };
}

async function loadKit(db, userId) {
  const { rows } = await db.query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2 LIMIT 1', [userId, KIT_KEY]);
  return rows[0] ? parseKit(rows[0].value) : {};
}

/** The stored fonts of this person, without the bytes. */
async function listFonts(db, userId) {
  const { rows } = await db.query(
    `SELECT role, family, weight, "renderFamily", ext, bytes, source, "sourceUrl", "updatedAt" FROM graphics_brand_fonts WHERE "userId" = $1 ORDER BY role`,
    [userId]);
  return rows;
}

/** One stored font with its bytes, only if it belongs to this person; null otherwise. */
async function getFontFile(db, userId, role) {
  if (!ROLES.includes(role)) return null;
  const { rows } = await db.query(
    `SELECT role, family, weight, "renderFamily", ext, bytes, sha256, data FROM graphics_brand_fonts WHERE "userId" = $1 AND role = $2`,
    [userId, role]);
  return rows[0] || null;
}

async function withTransaction(pool, fn) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const out = await fn(db);
    await db.query('COMMIT');
    return out;
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

async function saveKit(db, userId, kit) {
  await db.query(
    'INSERT INTO settings ("userId", key, value) VALUES ($1, $2, $3) ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value',
    [userId, KIT_KEY, JSON.stringify(kit)]);
}

/**
 * "Use this": copy the ticked parts of a proposal into the person's Brand Kit and font table, all or nothing.
 * `proposal` is the in-memory proposal (with font buffers). Returns { kit, changed, fonts } (kit without the logo picture).
 */
async function applyProposal(pool, userId, proposal, useInput, now = new Date()) {
  const use = sanitizeUse(useInput);
  // check everything that can be refused BEFORE touching the database
  const checked = {};
  for (const role of ROLES) {
    const f = use.fonts[role] && proposal.fonts && proposal.fonts[role];
    if (f && f.file) checked[role] = checkFontFile(f.file);
  }
  return withTransaction(pool, async (db) => {
    const cur = await db.query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2 FOR UPDATE', [userId, KIT_KEY]);
    const { kit, changed } = mergeKit(cur.rows[0] ? parseKit(cur.rows[0].value) : {}, proposal, use, now);
    for (const role of ROLES) {
      if (!use.fonts[role]) continue;
      const f = proposal.fonts[role];
      if (f.file) {
        await db.query(
          `INSERT INTO graphics_brand_fonts ("userId", role, family, weight, "renderFamily", ext, bytes, sha256, source, "sourceUrl", data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           ON CONFLICT ("userId", role) DO UPDATE SET family = EXCLUDED.family, weight = EXCLUDED.weight, "renderFamily" = EXCLUDED."renderFamily",
             ext = EXCLUDED.ext, bytes = EXCLUDED.bytes, sha256 = EXCLUDED.sha256, source = EXCLUDED.source, "sourceUrl" = EXCLUDED."sourceUrl",
             data = EXCLUDED.data, "updatedAt" = NOW()`,
          [userId, role, String(f.family).slice(0, 80), Number(f.file.weight) || Number(f.weight) || 400, f.file.renderFamily, f.file.ext === 'otf' ? 'otf' : 'ttf',
            f.file.buffer.length, checked[role], f.source || null, String(proposal.finalUrl || '').slice(0, 300) || null, f.file.buffer]);
      } else {
        // the new heading/body font is a name only: an old stored file for that role would no longer match the kit
        await db.query('DELETE FROM graphics_brand_fonts WHERE "userId" = $1 AND role = $2', [userId, role]);
      }
    }
    await saveKit(db, userId, kit);
    const fonts = await listFonts(db, userId);
    const { logoDataUrl, ...rest } = kit;
    return { kit: { ...rest, hasLogo: !!logoDataUrl }, changed, fonts };
  });
}

/** Remove one stored font file; the kit keeps the font's name but says it has no file. Returns true when there was one. */
async function deleteFont(pool, userId, role) {
  if (!ROLES.includes(role)) throw new BrandKitError('role must be heading or body');
  return withTransaction(pool, async (db) => {
    const del = await db.query('DELETE FROM graphics_brand_fonts WHERE "userId" = $1 AND role = $2', [userId, role]);
    const cur = await db.query('SELECT value FROM settings WHERE "userId" = $1 AND key = $2 FOR UPDATE', [userId, KIT_KEY]);
    if (cur.rows[0]) {
      const kit = parseKit(cur.rows[0].value);
      const ref = kit[`${role}Font`];
      if (ref && ref.stored) {
        kit[`${role}Font`] = { family: ref.family, weight: ref.weight, stored: false };
        await saveKit(db, userId, kit);
      }
    }
    return del.rowCount > 0;
  });
}

module.exports = {
  applyProposal, mergeKit, sanitizeUse, checkFontFile, loadKit, listFonts, getFontFile, deleteFont, BrandKitError, KIT_KEY, ROLES, MAX_FONT_BYTES,
};
