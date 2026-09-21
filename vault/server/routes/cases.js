'use strict';

const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

// ── Cases ──────────────────────────────────────────────────────────────────────
// A Case is the "manage a multi-step process with a client" object —
// e.g. "Lodge software application" — that touchpoints/tasks/activity alone
// couldn't express as one thing. Steps are tasks tagged tasks.caseId; the
// update log is client_interactions rows tagged caseId. GET /:id returns
// both together as one view, which is the whole point of this file.

async function assertClientOwner(clientId, userId, res) {
  const { rows: [client] } = await pool.query(
    'SELECT id FROM clients WHERE id=$1 AND "userId"=$2',
    [clientId, userId]
  );
  if (!client) { res.status(404).json({ error: 'Client not found' }); return false; }
  return true;
}

async function loadCase(caseId, userId) {
  const { rows: [c] } = await pool.query(
    `SELECT cc.* FROM client_cases cc JOIN clients c ON c.id = cc."clientId" WHERE cc.id=$1 AND c."userId"=$2`,
    [caseId, userId]
  );
  return c || null;
}

// GET /api/cases?clientId=123 — list a client's cases with step progress
router.get('/', async (req, res) => {
  const clientId = parseInt(req.query.clientId, 10);
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  try {
    const ok = await assertClientOwner(clientId, req.user.id, res);
    if (!ok) return;

    const { rows } = await pool.query(`
      SELECT cc.*,
        COUNT(t.id)::int FILTER (WHERE t.id IS NOT NULL)                 AS "stepCount",
        COUNT(t.id)::int FILTER (WHERE t.status = 'done')                AS "stepsDone",
        COUNT(t.id)::int FILTER (WHERE t."activityStatus" = 'waiting')   AS "stepsWaiting"
      FROM client_cases cc
      LEFT JOIN tasks t ON t."caseId" = cc.id
      WHERE cc."clientId" = $1
      GROUP BY cc.id
      ORDER BY cc.status = 'closed', cc."updatedAt" DESC
    `, [clientId]);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases — { clientId, title }
router.post('/', async (req, res) => {
  const { clientId, title } = req.body;
  if (!clientId) return res.status(400).json({ error: 'clientId required' });
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  try {
    const ok = await assertClientOwner(clientId, req.user.id, res);
    if (!ok) return;

    const { rows } = await pool.query(
      `INSERT INTO client_cases ("clientId", "userId", title) VALUES ($1,$2,$3) RETURNING *`,
      [clientId, req.user.id, title.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/cases/:id — the case + its steps (tasks) + its update log
// (client_interactions), merged into one chronological log for display.
router.get('/:id', async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  try {
    const kase = await loadCase(caseId, req.user.id);
    if (!kase) return res.status(404).json({ error: 'Case not found' });

    const { rows: steps } = await pool.query(
      `SELECT id, title, status, "activityStatus", "dueDate", "createdAt", "updatedAt"
       FROM tasks WHERE "caseId"=$1 ORDER BY "createdAt" ASC`,
      [caseId]
    );
    const { rows: logRows } = await pool.query(
      `SELECT id, title, note, date, "createdAt" FROM client_interactions
       WHERE "caseId"=$1 ORDER BY "createdAt" DESC`,
      [caseId]
    );

    // One merged, newest-first log: manual updates + step create/complete —
    // this is the "one place" the case view exists to provide.
    const log = [
      ...logRows.map(r => ({ id: `log-${r.id}`, ts: r.createdAt, title: r.title || 'Update', detail: r.note })),
      ...steps.map(s => ({ id: `step-created-${s.id}`, ts: s.createdAt, title: `Step added: ${s.title}`, detail: null })),
      ...steps.filter(s => s.status === 'done').map(s => ({ id: `step-done-${s.id}`, ts: s.updatedAt, title: `Step done: ${s.title}`, detail: null })),
    ].sort((a, b) => new Date(b.ts) - new Date(a.ts));

    res.json({ ...kase, steps, log });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/cases/:id — { title?, status? }
router.put('/:id', async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  try {
    const kase = await loadCase(caseId, req.user.id);
    if (!kase) return res.status(404).json({ error: 'Case not found' });

    const title  = 'title' in req.body ? req.body.title : kase.title;
    const status = 'status' in req.body ? req.body.status : kase.status;
    if (!['open', 'waiting', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    const closedAt = status === 'closed' ? (kase.closedAt || new Date()) : null;

    const { rows } = await pool.query(
      `UPDATE client_cases SET title=$1, status=$2, "closedAt"=$3, "updatedAt"=NOW() WHERE id=$4 RETURNING *`,
      [title, status, closedAt, caseId]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid status' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/cases/:id — cascades to its steps (tasks.caseId) and log
// (client_interactions.caseId) via ON DELETE CASCADE.
router.delete('/:id', async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  try {
    const kase = await loadCase(caseId, req.user.id);
    if (!kase) return res.status(404).json({ error: 'Case not found' });

    await pool.query('DELETE FROM client_cases WHERE id=$1', [caseId]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:id/steps — { title, dueDate? } — a step is a task tagged
// to this case (and to the case's client, so it still shows up anywhere
// client-linked tasks already do).
router.post('/:id/steps', async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const { title, dueDate } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: 'title required' });
  try {
    const kase = await loadCase(caseId, req.user.id);
    if (!kase) return res.status(404).json({ error: 'Case not found' });

    const { rows } = await pool.query(
      `INSERT INTO tasks (title, "dueDate", "clientId", "caseId", "userId", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *`,
      [title.trim(), dueDate || null, kase.clientId, caseId, req.user.id]
    );
    await pool.query(`UPDATE client_cases SET "updatedAt"=NOW() WHERE id=$1`, [caseId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/cases/:id/log — { note } — a quick "here's what happened" entry
// in the case's own update log, without needing the full touchpoint form.
router.post('/:id/log', async (req, res) => {
  const caseId = parseInt(req.params.id, 10);
  const { note } = req.body;
  if (!note?.trim()) return res.status(400).json({ error: 'note required' });
  try {
    const kase = await loadCase(caseId, req.user.id);
    if (!kase) return res.status(404).json({ error: 'Case not found' });

    const { rows } = await pool.query(
      `INSERT INTO client_interactions ("clientId", "userId", type, title, note, "caseId")
       VALUES ($1,$2,'other',$3,$4,$5) RETURNING *`,
      [kase.clientId, req.user.id, 'Case update', note.trim(), caseId]
    );
    await pool.query(`UPDATE client_cases SET "updatedAt"=NOW() WHERE id=$1`, [caseId]);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
