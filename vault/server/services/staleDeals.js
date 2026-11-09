'use strict';

// Stale deals: an open deal (not won or lost) with no sign of life for STALE_DAYS is raised to the Suggestions inbox, so a quiet deal
// is noticed instead of sitting in the Pipeline. "Sign of life" is the later of the deal's own last edit and the client's latest
// logged call, email or note (deal-stage and contact-added entries are system rows and do not count). Archived clients are skipped.
// One suggestion per deal: the fingerprint is the deal id, so a later run updates the same card (its age) rather than adding another,
// and a card marked Ignore stays quiet. Nothing is sent outside Vault and no paid service is called. See docs/crm-deals-schema.md.

const { capture, makeFingerprint } = require('./SuggestionService');

const STALE_DAYS = 21;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days between two dates, never negative. */
function daysSince(then, now = new Date()) {
  return Math.max(0, Math.floor((now.getTime() - new Date(then).getTime()) / DAY_MS));
}

/** The suggestion for one deal row, or null when the deal is not stale (or has no usable date). Pure. */
function staleSuggestion(row, now = new Date(), days = STALE_DAYS) {
  if (!row || !row.lastActivity) return null;
  const quiet = daysSince(row.lastActivity, now);
  if (quiet < days) return null;
  const value = row.value != null && row.value !== '' && Number(row.value) > 0 ? ` ($${Number(row.value).toLocaleString('en-AU')})` : '';
  return {
    userId: row.userId,
    source: 'staleDeals',
    category: 'alert',
    fingerprint: makeFingerprint('staleDeals', `deal:${row.id}`),
    title: `No activity on "${row.title}" for ${quiet} days`,
    body: `The open deal "${row.title}"${value} for ${row.clientName} is at the ${row.stage} stage and nothing has been logged or changed for ${quiet} days. Follow up, move it on, or mark it lost.`,
    context: `/clients/${row.clientId}`,
  };
}

const SQL = `
  SELECT d.id, d."userId", d."clientId", d.title, d.stage, d.value, c.name AS "clientName",
         GREATEST(
           d."updatedAt"::timestamptz,
           COALESCE((SELECT MAX(ci.date) FROM client_interactions ci
                      WHERE ci."clientId" = d."clientId" AND ci.type NOT IN ('deal_stage', 'contact')), d."updatedAt"::timestamptz)
         ) AS "lastActivity"
    FROM client_deals d
    JOIN clients c ON c.id = d."clientId" AND c."userId" = d."userId"
   WHERE d.stage NOT IN ('won', 'lost') AND c.status <> 'archived'`;

/** Look at every open deal and raise a suggestion for each stale one. Returns { checked, stale }. */
async function runStaleDealCheck({ pool = require('../db').pool, now = new Date(), days = STALE_DAYS, captureFn = capture } = {}) {
  const { rows } = await pool.query(SQL);
  let stale = 0;
  for (const row of rows) {
    const s = staleSuggestion(row, now, days);
    if (!s) continue;
    stale += 1;
    await captureFn(s);
  }
  return { checked: rows.length, stale };
}

module.exports = { STALE_DAYS, daysSince, staleSuggestion, runStaleDealCheck };
