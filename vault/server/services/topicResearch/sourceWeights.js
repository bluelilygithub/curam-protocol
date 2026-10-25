'use strict';

// Topic Research: the owner's own opinion of each outlet, a weight from 0 (ignore its standing) to 1 (the most trusted), by site name.
// A site that is not in the list counts as 0.5. One list per person, replaced as a whole when saved. See score.js (the "outlet" signal).

const MAX_ENTRIES = 200;
const MAX_NOTE = 100;

/** "https://www.ABC.net.au/news" -> "abc.net.au"; null when it is not a site name. */
function cleanDomain(raw) {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split(/[/?#]/)[0].replace(/:\d+$/, '').replace(/^www\./, '');
  if (s.length > 253 || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null;
  return s;
}

/** Returns { error } or { value: [{ domain, weight, note }] } (cleaned, de-duplicated, the last entry for a site wins, sorted by site). */
function validateSourceWeights(list) {
  if (!Array.isArray(list)) return { error: 'The outlet list must be a list.' };
  if (list.length > MAX_ENTRIES) return { error: `Keep the outlet list to ${MAX_ENTRIES} sites or fewer.` };
  const byDomain = new Map();
  for (const e of list) {
    const domain = cleanDomain(e?.domain);
    if (!domain) return { error: `"${String(e?.domain ?? '').slice(0, 60)}" is not a site name such as abc.net.au.` };
    const n = Number(e?.weight);
    if (typeof e?.weight === 'boolean' || e?.weight === null || e?.weight === '' || e?.weight === undefined || !Number.isFinite(n) || n < 0 || n > 1) return { error: `The weight for ${domain} must be a number from 0 to 1.` };
    byDomain.set(domain, { domain, weight: n, note: typeof e?.note === 'string' ? e.note.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE) : '' });
  }
  return { value: [...byDomain.values()].sort((a, b) => (a.domain < b.domain ? -1 : 1)) };
}

async function loadSourceWeights(pool, userId) {
  const { rows } = await pool.query('SELECT domain, weight, note FROM topic_research_source_weights WHERE "userId" = $1 ORDER BY domain', [userId]);
  return rows.map((r) => ({ domain: r.domain, weight: Number(r.weight), note: r.note || '' }));
}

/** Replace the person's whole list in one transaction. */
async function saveSourceWeights(pool, userId, list) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('DELETE FROM topic_research_source_weights WHERE "userId" = $1', [userId]);
    for (const e of list) {
      // eslint-disable-next-line no-await-in-loop
      await db.query('INSERT INTO topic_research_source_weights ("userId", domain, weight, note) VALUES ($1, $2, $3, $4)', [userId, e.domain, e.weight, e.note || '']);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally { db.release(); }
}

const toMap = (list) => new Map(list.map((e) => [e.domain, e.weight]));

module.exports = { cleanDomain, validateSourceWeights, loadSourceWeights, saveSourceWeights, toMap, MAX_ENTRIES };
