'use strict';

// Barre chord ladder bookkeeping, pure code (no database): what a hold may record and how the holds add up per rung.
// The client keeps the rungs in barreStages.mjs; a test fails if the ids drift.

const STAGE_IDS = ['two-strings', 'mini-f', 'full-f', 'b-flat', 'slide-it'];
const HOLD_SECONDS = 10;
const CLEAR_AT = 3;

/** Check a hold before it is saved. Returns { ok, error?, value? }. A hold is a full ten seconds; stopping early saves nothing. */
function checkHold({ stage, clean, seconds }) {
  if (!STAGE_IDS.includes(stage)) return { ok: false, error: 'Unknown step of the barre ladder' };
  if (typeof clean !== 'boolean') return { ok: false, error: 'Say whether every string rang clean' };
  const secs = seconds == null ? HOLD_SECONDS : Number(seconds);
  if (!(Number.isInteger(secs) && secs >= HOLD_SECONDS && secs <= 60)) return { ok: false, error: `A hold is at least ${HOLD_SECONDS} seconds` };
  return { ok: true, value: { stage, clean, seconds: secs } };
}

/** rows: [{ stage, clean, heldAt }] -> one entry per rung with the clean and total holds, whether it is cleared, and when it was last tried. */
function summarise(rows) {
  const out = {};
  for (const id of STAGE_IDS) out[id] = { clean: 0, total: 0, cleared: false, lastAt: null };
  for (const r of rows || []) {
    const s = out[r.stage];
    if (!s) continue;
    s.total += 1;
    if (r.clean) s.clean += 1;
    if (!s.lastAt || new Date(r.heldAt) > new Date(s.lastAt)) s.lastAt = r.heldAt;
  }
  for (const s of Object.values(out)) s.cleared = s.clean >= CLEAR_AT;
  return out;
}

module.exports = { STAGE_IDS, HOLD_SECONDS, CLEAR_AT, checkHold, summarise };
