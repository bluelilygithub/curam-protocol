'use strict';

// Colour-managed CMYK for Print Ready. sharp/libvips converts through an ICC profile and embeds it in the file, which is what a print shop's
// workflow expects. Two profiles can be used:
//   - the built-in 'cmyk' profile that ships with sharp ("Chemical proof", public domain): a generic proof profile, fine for a rough check, but NOT a
//     press standard such as FOGRA39 or GRACoL;
//   - the printer's OWN profile, uploaded once by an admin (kept in workspace_settings key graphics_cmyk_profile). The press standards are licensed
//     by their owners, so Vault does not bundle any: the person's printer supplies theirs.
// Pure helpers here are tested in graphicsColour.test.js.

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const SETTINGS_KEY = 'graphics_cmyk_profile';
const MAX_PROFILE_BYTES = 8 * 1024 * 1024; // press profiles are 0.5 to 3 MB
const BUILTIN_NAME = 'Generic CMYK proof profile (built in)';

/** Checks an uploaded file really is a CMYK printer ICC profile. Returns { ok: true, name } or { ok: false, error }. */
function checkIccProfile(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 132) return { ok: false, error: 'That does not look like an ICC colour profile (the file is too small).' };
  if (buf.length > MAX_PROFILE_BYTES) return { ok: false, error: 'That profile is larger than 8 MB, which is not a normal printer profile.' };
  if (buf.toString('ascii', 36, 40) !== 'acsp') return { ok: false, error: 'That is not an ICC colour profile file (.icc or .icm).' };
  if (buf.readUInt32BE(0) > buf.length) return { ok: false, error: 'That profile file is cut short. Download it again.' };
  if (buf[8] > 4) return { ok: false, error: 'That profile is a newer ICC version than Vault can read.' };
  if (buf.toString('ascii', 16, 20) !== 'CMYK') return { ok: false, error: 'That is not a CMYK profile. Ask your printer for their CMYK profile (for example FOGRA39 or GRACoL).' };
  if (buf.toString('ascii', 12, 16) !== 'prtr') return { ok: false, error: 'That CMYK profile is not a printer profile.' };
  return { ok: true, name: profileName(buf) };
}

/** The profile's own description ("Coated FOGRA39"), or a plain fallback. Handles the two ways profiles store it. */
function profileName(buf) {
  try {
    const count = buf.readUInt32BE(128);
    for (let i = 0; i < Math.min(count, 200); i += 1) {
      const at = 132 + i * 12;
      if (buf.toString('ascii', at, at + 4) !== 'desc') continue;
      const off = buf.readUInt32BE(at + 4);
      const len = buf.readUInt32BE(at + 8);
      const type = buf.toString('ascii', off, off + 4);
      let text = '';
      if (type === 'desc') { // version 2: ASCII
        const n = buf.readUInt32BE(off + 8);
        text = buf.toString('latin1', off + 12, off + 12 + Math.max(0, n - 1));
      } else if (type === 'mluc') { // version 4: UTF-16 records
        const strLen = buf.readUInt32BE(off + 20);
        const strOff = buf.readUInt32BE(off + 24);
        text = Buffer.from(buf.subarray(off + strOff, off + strOff + strLen)).swap16().toString('utf16le');
      } else if (len > 0) {
        text = '';
      }
      text = text.replace(/[^\x20-\x7e]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (text) return text.slice(0, 80);
    }
  } catch { /* fall through */ }
  return 'Printer profile';
}

/** sharp reads a custom profile from a file path: write it once to the temp folder, named by its content. */
function profileFile(buf) {
  const file = path.join(os.tmpdir(), `vault-icc-${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16)}.icc`);
  if (!fs.existsSync(file)) fs.writeFileSync(file, buf);
  return file;
}

/** The workspace's own CMYK profile, or null (then the built-in one is used). */
async function loadCustomProfile(pool) {
  try {
    const { rows } = await pool.query('SELECT value, "updatedAt" FROM workspace_settings WHERE key=$1 LIMIT 1', [SETTINGS_KEY]);
    if (!rows[0]?.value) return null;
    const saved = JSON.parse(rows[0].value);
    const buf = Buffer.from(String(saved.data || ''), 'base64');
    const check = checkIccProfile(buf);
    return check.ok ? { buf, name: saved.name || check.name, bytes: buf.length, updatedAt: rows[0].updatedAt || null } : null;
  } catch {
    return null;
  }
}

async function saveCustomProfile(pool, buf) {
  const check = checkIccProfile(buf);
  if (!check.ok) { const err = new Error(check.error); err.status = 400; throw err; }
  await pool.query(
    `INSERT INTO workspace_settings (key, value, "updatedAt") VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()`,
    [SETTINGS_KEY, JSON.stringify({ name: check.name, data: buf.toString('base64') })]);
  return { name: check.name, bytes: buf.length };
}

async function removeCustomProfile(pool) {
  await pool.query('DELETE FROM workspace_settings WHERE key=$1', [SETTINGS_KEY]);
}

/**
 * How much of a picture changes when it goes to print and comes back: the share of pixels where any colour channel moved by more than `tolerance`
 * (out of 255). Both buffers are raw pixels of the same size with `channels` per pixel.
 */
function gamutReport(before, after, channels = 3, tolerance = 24) {
  const pixels = Math.floor(Math.min(before.length, after.length) / channels);
  if (!pixels) return { changedPct: 0 };
  let changed = 0;
  for (let p = 0; p < pixels; p += 1) {
    for (let c = 0; c < 3; c += 1) {
      if (Math.abs(before[p * channels + c] - after[p * channels + c]) > tolerance) { changed += 1; break; }
    }
  }
  return { changedPct: Math.round((changed / pixels) * 1000) / 10 };
}

module.exports = { checkIccProfile, profileName, profileFile, loadCustomProfile, saveCustomProfile, removeCustomProfile, gamutReport, BUILTIN_NAME, MAX_PROFILE_BYTES, SETTINGS_KEY };
