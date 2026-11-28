'use strict';

// Code Map "Context" tab, the server side (docs/code-map.md "Context"): build and keep briefings, the owner's notes, and the read-only
// CLAUDE.md view with the docs it can be copied with. `createBriefingService({ pool, jobs, root })` so the route test can swap them.

const { gatherSnapshot, NOTES_KEY } = require('./snapshot');
const { buildBriefing } = require('./buildBriefing');
const { VAULT_ROOT, DEFAULT_BRIEFING_DOCS, staleRuleSources } = require('./sources');
const { SETTINGS_KEY: DOCS_KEY, docCatalog, resolveSelection, copyBlock, tokensOf } = require('./docs');

const KEEP = 10;
const MAX_NOTES = 20000;

const meta = (r) => ({ id: r.id, generatedAt: r.generatedAt, commitHint: r.commitHint, runId: r.runId, chars: r.chars });

function createBriefingService({ pool, jobs, root = VAULT_ROOT } = {}) {
  const db = () => pool || require('../../../db').pool;
  const J = () => jobs || require('../jobs');

  /** Builds a briefing from the latest run, stores it, keeps the last 10. Returns { briefing: meta + markdown, sections, stats, rulesStale }. */
  async function build(userId) {
    const latestRun = await J().latest();
    const snap = await gatherSnapshot({ pool: db(), userId, latestRun, root });
    snap.docs = await briefingDocs(userId);
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

  /** Deletes the given briefings (own only). Hard delete: they are rebuildable snapshots, already pruned past 10 without the bin. */
  async function remove(userId, ids) {
    const { rowCount } = await db().query('DELETE FROM code_map_briefings WHERE "userId"=$1 AND id = ANY($2::int[])', [userId, ids]);
    return rowCount;
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

  // ── The docs that go to Claude with CLAUDE.md (docs.js): the saved choice per admin, else DEFAULT_BRIEFING_DOCS ──────────────────
  async function savedDocs(userId) {
    const { rows } = await db().query('SELECT value FROM settings WHERE "userId"=$1 AND key=$2', [userId, DOCS_KEY]);
    if (!rows[0]) return null;
    try { const v = JSON.parse(rows[0].value); return Array.isArray(v) ? v : null; } catch { return null; }
  }

  /** CLAUDE.md as text, every doc on offer (size, summary, default, note), the ticked paths, and allow-listed files that are missing. */
  async function claudeMd(userId) {
    const catalog = docCatalog(root);
    const saved = await savedDocs(userId);
    return {
      text: catalog.claude, chars: catalog.claudeChars, tokens: tokensOf(catalog.claudeChars),
      docs: catalog.docs, selected: resolveSelection(saved, catalog), customised: Array.isArray(saved),
      defaults: DEFAULT_BRIEFING_DOCS, missing: catalog.missing, rulesStale: staleRuleSources(root),
    };
  }

  /** Save the ticked paths (only paths on offer are kept). */
  async function saveDocs(userId, paths) {
    if (!Array.isArray(paths) || paths.length > 500) throw Object.assign(new Error('paths must be a list of doc paths.'), { status: 400 });
    const selected = resolveSelection(paths.map(String), docCatalog(root));
    await db().query(
      'INSERT INTO settings ("userId", key, value) VALUES ($1,$2,$3) ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value',
      [userId, DOCS_KEY, JSON.stringify(selected)]);
    return { selected, customised: true };
  }

  /** Back to the default set: the saved choice is removed. */
  async function resetDocs(userId) {
    await db().query('DELETE FROM settings WHERE "userId"=$1 AND key=$2', [userId, DOCS_KEY]);
    return { selected: resolveSelection(null, docCatalog(root)), customised: false };
  }

  /** CLAUDE.md + the ticked docs + the "Docs not included in this copy" list, built on the server from the allow-list only. */
  async function docsCopy(userId, paths) {
    const catalog = docCatalog(root);
    const selected = Array.isArray(paths) ? resolveSelection(paths.map(String), catalog) : resolveSelection(await savedDocs(userId), catalog);
    return copyBlock(selected, catalog, root);
  }

  /** For the briefing: which docs the CLAUDE.md copy holds, and the ones left out (path, size, summary; never contents). */
  async function briefingDocs(userId) {
    const catalog = docCatalog(root);
    const selected = resolveSelection(await savedDocs(userId), catalog);
    return { included: selected, leftOut: catalog.docs.filter((d) => !selected.includes(d.path)) };
  }

  return { build, list, get, remove, getNotes, saveNotes, claudeMd, saveDocs, resetDocs, docsCopy, briefingDocs };
}

module.exports = { createBriefingService, KEEP, MAX_NOTES };
