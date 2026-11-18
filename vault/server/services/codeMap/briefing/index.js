'use strict';

// Code Map "Context" tab, the server side (docs/code-map.md "Context"): build and keep briefings, the owner's notes, and the read-only
// CLAUDE.md view with the docs it can be copied with. `createBriefingService({ pool, jobs, root })` so the route test can swap them.

const fs = require('fs');
const path = require('path');
const { gatherSnapshot, NOTES_KEY } = require('./snapshot');
const { buildBriefing } = require('./buildBriefing');
const { VAULT_ROOT, staleRuleSources } = require('./sources');

const KEEP = 10;
const MAX_NOTES = 20000;
const DOC_NAME_RX = /^[a-z0-9][a-z0-9-]*\.md$/;
const LINKED_RX = /docs\/([a-z0-9][a-z0-9-]*\.md)/g;

const meta = (r) => ({ id: r.id, generatedAt: r.generatedAt, commitHint: r.commitHint, runId: r.runId, chars: r.chars });

function createBriefingService({ pool, jobs, root = VAULT_ROOT } = {}) {
  const db = () => pool || require('../../../db').pool;
  const J = () => jobs || require('../jobs');

  /** Builds a briefing from the latest run, stores it, keeps the last 10. Returns { briefing: meta + markdown, sections, stats, rulesStale }. */
  async function build(userId) {
    const latestRun = await J().latest();
    const snap = await gatherSnapshot({ pool: db(), userId, latestRun, root });
    const out = buildBriefing(snap);
    const { rows } = await db().query(
      `INSERT INTO code_map_briefings ("userId", "commitHint", "runId", markdown, chars) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, "generatedAt", "commitHint", "runId", chars`,
      [userId, snap.commitHint, latestRun?.id || null, out.markdown, out.markdown.length]);
    await db().query(
      `DELETE FROM code_map_briefings WHERE "userId" = $1 AND id NOT IN
         (SELECT id FROM code_map_briefings WHERE "userId" = $1 ORDER BY "generatedAt" DESC, id DESC LIMIT ${KEEP})`, [userId]);
    return {
      briefing: { ...meta(rows[0]), markdown: out.markdown }, sections: out.sections, stats: out.stats,
      rulesStale: snap.rulesStale, hasRun: !!latestRun, runFinishedAt: snap.runFinishedAt,
    };
  }

  async function list(userId) {
    const { rows } = await db().query(
      `SELECT id, "generatedAt", "commitHint", "runId", chars FROM code_map_briefings WHERE "userId"=$1 ORDER BY "generatedAt" DESC, id DESC LIMIT ${KEEP}`, [userId]);
    return rows.map(meta);
  }

  async function get(userId, id) {
    const { rows } = await db().query('SELECT id, "generatedAt", "commitHint", "runId", chars, markdown FROM code_map_briefings WHERE id=$1 AND "userId"=$2', [id, userId]);
    return rows[0] ? { ...meta(rows[0]), markdown: rows[0].markdown } : null;
  }

  async function getNotes(userId) {
    const { rows } = await db().query('SELECT value FROM settings WHERE "userId"=$1 AND key=$2', [userId, NOTES_KEY]);
    return rows[0]?.value || '';
  }

  async function saveNotes(userId, text) {
    const value = String(text ?? '').replace(/\u0000/g, '');
    if (value.length > MAX_NOTES) throw Object.assign(new Error(`Notes can be up to ${MAX_NOTES.toLocaleString('en-AU')} characters.`), { status: 400 });
    if (!value.trim()) await db().query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [userId, NOTES_KEY]);
    else {
      await db().query(
        'INSERT INTO settings ("userId", key, value) VALUES ($1,$2,$3) ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value',
        [userId, NOTES_KEY, value]);
    }
    return value.trim() ? value : '';
  }

  /** The docs that exist, by name only (a listing of docs/, never a path from the request). */
  const docNames = () => {
    try { return fs.readdirSync(path.join(root, 'docs')).filter((f) => DOC_NAME_RX.test(f)).sort(); } catch { return []; }
  };

  /** CLAUDE.md as text, which docs it links to, and every other doc that can be added to the copied block. */
  function claudeMd() {
    const text = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8').replace(/\r\n?/g, '\n');
    const names = new Set(docNames());
    const linked = [...new Set([...text.matchAll(LINKED_RX)].map((m) => m[1]))].filter((n) => names.has(n));
    return { text, linked, others: [...names].filter((n) => !linked.includes(n)), rulesStale: staleRuleSources(root) };
  }

  /** One doc by name, only if it is in the listing of docs/. */
  function doc(name) {
    const n = String(name || '');
    if (!DOC_NAME_RX.test(n) || !docNames().includes(n)) throw Object.assign(new Error('There is no doc with that name.'), { status: 404 });
    return { name: n, text: fs.readFileSync(path.join(root, 'docs', n), 'utf8').replace(/\r\n?/g, '\n') };
  }

  return { build, list, get, getNotes, saveNotes, claudeMd, doc };
}

module.exports = { createBriefingService, KEEP, MAX_NOTES };
