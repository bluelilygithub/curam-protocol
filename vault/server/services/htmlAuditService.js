'use strict';

const { pool } = require('../db');
const { runLighthousePair } = require('./htmlLighthouse');
const { captureIf, makeFingerprint } = require('./SuggestionService');

function parseJson(val) {
  if (val == null) return {};
  if (typeof val === 'string') {
    try { return JSON.parse(val); } catch { return {}; }
  }
  return val;
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function rowToAudit(row) {
  const report = parseJson(row.report);
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    hostname: hostnameOf(row.url),
    score: Number(row.score),
    summary: row.summary || report.summary || '',
    strategy: row.strategy || report.strategy || 'both',
    report,
    actionsDone: parseJson(row.actionsDone),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function listAudits(userId) {
  const { rows } = await pool.query(
    `SELECT id, name, url, score, summary, strategy, "createdAt", "updatedAt"
       FROM html_audits
      WHERE "userId"=$1
      ORDER BY "updatedAt" DESC
      LIMIT 80`,
    [userId]
  );
  return rows.map((r) => rowToAudit(r));
}

async function getAudit(userId, id) {
  const { rows } = await pool.query(
    `SELECT * FROM html_audits WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  if (!rows[0]) return null;
  return rowToAudit(rows[0]);
}

async function deleteAudit(userId, id) {
  const { rowCount } = await pool.query(
    `DELETE FROM html_audits WHERE id=$1 AND "userId"=$2`,
    [id, userId]
  );
  return rowCount > 0;
}

async function createAudit(userId, { url, name } = {}) {
  const report = await runLighthousePair(url);
  const host = hostnameOf(report.finalUrl || url);
  const projectName = String(name || '').trim() || host;

  const { rows } = await pool.query(
    `INSERT INTO html_audits ("userId", name, url, score, summary, strategy, report)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      userId,
      projectName.slice(0, 80),
      report.finalUrl || url,
      report.score,
      report.summary,
      'both',
      JSON.stringify(report),
    ]
  );
  const audit = rowToAudit(rows[0]);
  await captureIf(audit.score < 50, {
    userId,
    source: 'html',
    category: 'alert',
    fingerprint: makeFingerprint('html', `weak-lighthouse:${audit.id}`),
    title: `HTML Lighthouse scored ${audit.score} for ${host}`,
    body: audit.summary,
    context: `/html/${audit.id}`,
  });
  return audit;
}

const ACTION_VIEWS = new Set(['mobile', 'desktop']);
const MAX_ACTIONS_PER_VIEW = 300;

/**
 * Tick / untick one action on the Actions tab, with an optional note of what was done. Pure: returns the new actionsDone object.
 * An entry that is not done and has no note is removed. Throws (status 400) on bad input.
 */
function applyActionUpdate(current, { view, key, done, note }, now = new Date()) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!ACTION_VIEWS.has(view)) throw bad('view must be mobile or desktop');
  const k = String(key || '').trim();
  if (!k || k.length > 160) throw bad('action key is required (max 160 characters)');
  const cleanNote = note == null ? null : String(note).slice(0, 1000);
  const next = { ...(current && typeof current === 'object' ? current : {}) };
  const bag = { ...(next[view] && typeof next[view] === 'object' ? next[view] : {}) };
  const prev = bag[k] || {};
  const isDone = done == null ? !!prev.done : !!done;
  const entry = {
    done: isDone,
    doneAt: isDone ? (prev.done && prev.doneAt ? prev.doneAt : now.toISOString()) : null,
    note: cleanNote == null ? (prev.note || '') : cleanNote.trim(),
  };
  if (!entry.done && !entry.note) delete bag[k];
  else bag[k] = entry;
  if (Object.keys(bag).length > MAX_ACTIONS_PER_VIEW) throw bad('too many actions');
  next[view] = bag;
  return next;
}

async function setActionDone(userId, id, update) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT "actionsDone" FROM html_audits WHERE id=$1 AND "userId"=$2 FOR UPDATE`,
      [id, userId]
    );
    if (!rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const next = applyActionUpdate(parseJson(rows[0].actionsDone), update);
    // "updatedAt" is left alone on purpose: the run list is ordered by it and ticking should not reorder it.
    await client.query(
      `UPDATE html_audits SET "actionsDone"=$1 WHERE id=$2 AND "userId"=$3`,
      [JSON.stringify(next), id, userId]
    );
    await client.query('COMMIT');
    return next;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { listAudits, getAudit, createAudit, deleteAudit, setActionDone, applyActionUpdate };
