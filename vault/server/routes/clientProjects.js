'use strict';

/**
 * Client projects — a chat project with projectType = 'client', tied to one CRM client, plus
 * the things that hang off it (status, activity entries, notes, links to large files).
 *
 * Finance rules for this file:
 *  - It never writes to clients, client_contacts, client_billing_details or any fin_ table.
 *  - The only Finance table it touches is fin_invoices, read-only, through GET /:id/finance,
 *    using the same match the CRM client page uses ("clientRef" = the project's client).
 *
 * Mounted at /api/client-projects behind requireFeature('clients'). Every query is scoped
 * to req.user.id. Named routes come before /:id.
 */

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { getModelsForUser } = require('../services/modelResolver');
const { attachmentsForEntities } = require('../utils/attachments');

const STATUSES = ['active', 'waiting', 'done'];
const LINK_KINDS = ['raw', 'delivered', 'reference', 'other'];
const ACTIVITY_TYPES = ['note', 'call', 'email', 'meeting', 'decision', 'milestone', 'other'];

async function ownedClient(clientId, userId) {
  const id = Number(clientId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const { rows } = await pool.query('SELECT id, name FROM clients WHERE id=$1 AND "userId"=$2', [id, userId]);
  return rows[0] || null;
}

// Loads one of the caller's client projects, or sends 404 and returns null.
async function loadClientProject(req, res) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) { res.status(404).json({ error: 'Not found' }); return null; }
  const { rows } = await pool.query(
    `SELECT p.*, c.name AS "clientName"
       FROM projects p LEFT JOIN clients c ON c.id = p."clientId"
      WHERE p.id=$1 AND p."userId"=$2 AND p."projectType"='client'`,
    [id, req.user.id]
  );
  if (!rows[0]) { res.status(404).json({ error: 'Not found' }); return null; }
  return rows[0];
}

async function syncSearchIndex(project) {
  try {
    await pool.query(`DELETE FROM search_index WHERE type='project' AND "projectId"=$1`, [String(project.id)]);
    await pool.query(
      `INSERT INTO search_index(type, "projectId", title, body) VALUES ('project', $1, $2, $3)`,
      [String(project.id), project.name || '', [project.goal, project.problem, project.notes].filter(Boolean).join(' ')]
    );
  } catch { /* search is a convenience, never a reason to fail */ }
}

const fail = (res, err) => { if (!res.headersSent) res.status(500).json({ error: err.message }); };

// GET /api/client-projects — one list of every client project: client, status, next due task
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p."clientId", c.name AS "clientName", p."clientStatus",
              p."startDate", p."targetEndDate", p."updatedAt",
              (SELECT COUNT(*) FROM tasks t WHERE t."projectId"=p.id AND t."parentTaskId" IS NULL AND t.status <> 'done')::int AS "openTasks",
              nd.id AS "nextTaskId", nd.title AS "nextTaskTitle", nd."dueDate" AS "nextTaskDue"
         FROM projects p
         LEFT JOIN clients c ON c.id = p."clientId"
         LEFT JOIN LATERAL (
           SELECT t.id, t.title, t."dueDate" FROM tasks t
            WHERE t."projectId"=p.id AND t."parentTaskId" IS NULL AND t.status <> 'done' AND t."dueDate" IS NOT NULL
            ORDER BY t."dueDate" ASC LIMIT 1
         ) nd ON TRUE
        WHERE p."userId"=$1 AND p."projectType"='client' AND p."archived_at" IS NULL
        ORDER BY CASE p."clientStatus" WHEN 'active' THEN 0 WHEN 'waiting' THEN 1 ELSE 2 END,
                 c.name ASC NULLS LAST, p.name ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

// GET /api/client-projects/convertible — the caller's other projects, for "make this a client project"
router.get('/convertible', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p."clientId", c.name AS "clientName"
         FROM projects p LEFT JOIN clients c ON c.id = p."clientId"
        WHERE p."userId"=$1 AND p."archived_at" IS NULL AND COALESCE(p."projectType",'') <> 'client'
        ORDER BY p.name ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

// POST /api/client-projects — create a new client project
router.post('/', async (req, res) => {
  const { name, clientId, goal, startDate, targetEndDate } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: 'name is required' });
  try {
    const client = await ownedClient(clientId, req.user.id);
    if (!client) return res.status(400).json({ error: 'Choose one of your clients' });

    const { standard } = await getModelsForUser(req.user.id);
    if (!standard) return res.status(400).json({ error: 'No model configured. Ask an admin to configure models in Settings.' });

    const { rows } = await pool.query(
      `INSERT INTO projects (name, goal, problem, audience, "techStack", constraints, "successCriteria", tone, notes,
                             model, "projectType", "clientId", "clientStatus", "startDate", "targetEndDate", "userId")
       VALUES ($1,$2,'','','','','','','',$3,'client',$4,'active',$5,$6,$7) RETURNING *`,
      [String(name).trim(), goal || '', standard, client.id, startDate || null, targetEndDate || null, req.user.id]
    );
    await syncSearchIndex(rows[0]);
    res.status(201).json({ ...rows[0], clientName: client.name });
  } catch (err) { fail(res, err); }
});

// POST /api/client-projects/:id/convert — turn one of the caller's existing projects into a client project
router.post('/:id/convert', async (req, res) => {
  try {
    const { rows: [p] } = await pool.query('SELECT * FROM projects WHERE id=$1 AND "userId"=$2', [req.params.id, req.user.id]);
    if (!p) return res.status(404).json({ error: 'Not found' });
    const client = await ownedClient(req.body.clientId ?? p.clientId, req.user.id);
    if (!client) return res.status(400).json({ error: 'A client project needs one of your clients' });
    // The previous type and client are returned so a mistaken conversion can be put back by hand.
    await pool.query(
      `UPDATE projects SET "projectType"='client', "clientId"=$1, "clientStatus"=COALESCE("clientStatus",'active'), "updatedAt"=NOW() WHERE id=$2`,
      [client.id, p.id]
    );
    res.json({ ok: true, id: p.id, previous: { projectType: p.projectType, clientId: p.clientId, typeConfig: p.typeConfig } });
  } catch (err) { fail(res, err); }
});

// GET /api/client-projects/:id — the header block for the project page
router.get('/:id', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows: [counts] } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM tasks t WHERE t."projectId"=$1 AND t."parentTaskId" IS NULL AND t.status <> 'done')::int AS "openTasks",
         (SELECT COUNT(*) FROM notes n WHERE n.project_id=$1 AND n.user_id=$2)::int AS notes,
         (SELECT COUNT(*) FROM client_interactions ci WHERE ci."projectId"=$1)::int AS activity,
         (SELECT COUNT(*) FROM project_links l WHERE l."projectId"=$1 AND l."userId"=$2)::int AS links`,
      [p.id, req.user.id]
    );
    const { rows: [next] } = await pool.query(
      `SELECT id, title, "dueDate" FROM tasks
        WHERE "projectId"=$1 AND "parentTaskId" IS NULL AND status <> 'done' AND "dueDate" IS NOT NULL
        ORDER BY "dueDate" ASC LIMIT 1`,
      [p.id]
    );
    res.json({ project: p, counts, nextTask: next || null });
  } catch (err) { fail(res, err); }
});

// PATCH /api/client-projects/:id/status
router.patch('/:id/status', async (req, res) => {
  const { clientStatus } = req.body;
  if (!STATUSES.includes(clientStatus)) return res.status(400).json({ error: `clientStatus must be one of ${STATUSES.join(', ')}` });
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    await pool.query('UPDATE projects SET "clientStatus"=$1, "updatedAt"=NOW() WHERE id=$2', [clientStatus, p.id]);
    res.json({ ok: true, clientStatus });
  } catch (err) { fail(res, err); }
});

// ── Activity (the client's log, filtered to this project) ─────────────────────

router.get('/:id/activity', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows } = await pool.query(
      `SELECT ci.id, ci.type, ci.date, ci.note, ci.title, ci."needsFollowUp", ci."createdAt", cc.name AS "contactName"
         FROM client_interactions ci LEFT JOIN client_contacts cc ON cc.id = ci."contactId"
        WHERE ci."projectId"=$1 AND ci."clientId"=$2
        ORDER BY ci.date DESC, ci."createdAt" DESC LIMIT 200`,
      [p.id, p.clientId]
    );
    // Files attached to an entry (entityType 'touchpoint' is the existing name for any activity row).
    const byEntry = await attachmentsForEntities('touchpoint', rows.map(r => r.id));
    res.json(rows.map(r => ({ ...r, attachments: byEntry.get(r.id) || [] })));
  } catch (err) { fail(res, err); }
});

// POST — the entry inherits this project and its client. Same rules as the client page's log:
// a real past date, a note, optional follow-up flag. Files are attached afterwards through the
// existing /api/clients/:clientId/touchpoints/:id/attachments route.
router.post('/:id/activity', async (req, res) => {
  const { note, type, date, needsFollowUp } = req.body;
  if (!note || !String(note).trim()) return res.status(400).json({ error: 'note is required' });
  if (type != null && !ACTIVITY_TYPES.includes(type)) return res.status(400).json({ error: `type must be one of ${ACTIVITY_TYPES.join(', ')}` });
  if (date != null && date !== '') {
    const when = new Date(date);
    if (Number.isNaN(when.getTime())) return res.status(400).json({ error: 'date is not a valid date/time' });
    if (when.getTime() > Date.now() + 5 * 60 * 1000) {
      return res.status(400).json({ error: 'date cannot be in the future — the activity log records things that already happened (use a task for something upcoming)' });
    }
  }
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    if (!p.clientId) return res.status(400).json({ error: 'This project has no client' });
    const { rows } = await pool.query(
      `INSERT INTO client_interactions ("clientId","userId","projectId",type,date,note,"needsFollowUp")
       VALUES ($1,$2,$3,$4,COALESCE($5,NOW()),$6,$7) RETURNING *`,
      [p.clientId, req.user.id, p.id, type || 'note', date || null, String(note).trim(), !!needsFollowUp]
    );
    res.status(201).json(rows[0]);
  } catch (err) { fail(res, err); }
});

// ── Notes (list/add here; edit and delete use the existing /api/notes/:id) ─────

router.get('/:id/notes', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows } = await pool.query(
      'SELECT * FROM notes WHERE user_id=$1 AND project_id=$2 ORDER BY updated_at DESC',
      [req.user.id, p.id]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.post('/:id/notes', async (req, res) => {
  const { title = 'Untitled', body = '' } = req.body;
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows } = await pool.query(
      'INSERT INTO notes (user_id, project_id, client_id, title, body) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [req.user.id, p.id, p.clientId || null, String(title).trim() || 'Untitled', body]
    );
    res.status(201).json(rows[0]);
  } catch (err) { fail(res, err); }
});

// ── Files already uploaded to the project (list only; uploading stays on the project page) ──

router.get('/:id/files', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows } = await pool.query(
      'SELECT id, name, size, mimetype, "uploadedAt" FROM files WHERE "projectId"=$1 ORDER BY "uploadedAt" DESC',
      [p.id]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

// ── Chats in this project (same data the sidebar shows) ───────────────────────

router.get('/:id/chats', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows } = await pool.query(
      `SELECT s."sessionId", s.title, s."updatedAt",
              (SELECT content FROM messages m WHERE m."sessionId"=s."sessionId" AND m.role='user' ORDER BY m."createdAt" ASC LIMIT 1) AS "firstUserMsg"
         FROM sessions s
        WHERE s."projectId"=$1 AND s."deletedAt" IS NULL
          AND EXISTS (SELECT 1 FROM messages m2 WHERE m2."sessionId"=s."sessionId")
        ORDER BY s."updatedAt" DESC LIMIT 100`,
      [p.id]
    );
    res.json(rows.map(r => ({ ...r, firstUserMsg: r.firstUserMsg ? String(r.firstUserMsg).slice(0, 140) : null })));
  } catch (err) { fail(res, err); }
});

// ── Links to large files (kept where they really live, never uploaded) ─────────

router.get('/:id/links', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows } = await pool.query(
      'SELECT * FROM project_links WHERE "projectId"=$1 AND "userId"=$2 ORDER BY "createdAt" DESC',
      [p.id, req.user.id]
    );
    res.json(rows);
  } catch (err) { fail(res, err); }
});

router.post('/:id/links', async (req, res) => {
  const { label, location, kind = 'other', note } = req.body;
  if (!label || !String(label).trim()) return res.status(400).json({ error: 'label is required' });
  if (!location || !String(location).trim()) return res.status(400).json({ error: 'location is required' });
  if (!LINK_KINDS.includes(kind)) return res.status(400).json({ error: `kind must be one of ${LINK_KINDS.join(', ')}` });
  if (String(location).length > 2000 || String(label).length > 200) return res.status(400).json({ error: 'label or location is too long' });
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const { rows } = await pool.query(
      `INSERT INTO project_links ("userId","projectId",label,location,kind,note) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [req.user.id, p.id, String(label).trim(), String(location).trim(), kind, note ? String(note).trim() : null]
    );
    res.status(201).json(rows[0]);
  } catch (err) { fail(res, err); }
});

router.delete('/:id/links/:linkId', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    const r = await pool.query('DELETE FROM project_links WHERE id=$1 AND "projectId"=$2 AND "userId"=$3', [req.params.linkId, p.id, req.user.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { fail(res, err); }
});

// ── Quotes and invoices (READ-ONLY, client-wide) ──────────────────────────────
// Finance has no project link and none is added. This lists the client's documents the same
// way the CRM client page finds them: fin_invoices."clientRef" = the project's client.

router.get('/:id/finance', async (req, res) => {
  try {
    const p = await loadClientProject(req, res);
    if (!p) return;
    if (!p.clientId) return res.json({ scope: 'client', clientName: null, documents: [] });
    const { rows } = await pool.query(
      `SELECT id, number, "docType", status, "issueDate"::date::text AS "issueDate", "dueDate"::date::text AS "dueDate", total
         FROM fin_invoices
        WHERE "clientRef"=$1 AND "userId"=$2
        ORDER BY "issueDate" DESC, id DESC`,
      [p.clientId, req.user.id]
    );
    res.json({ scope: 'client', clientName: p.clientName, documents: rows });
  } catch (err) { fail(res, err); }
});

module.exports = router;
