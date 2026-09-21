'use strict';

const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { translateToGmailQuery } = require('../services/gmailNLP');
const { getModelsForUser } = require('../services/modelResolver');
const { getGmailClient, getHeader } = require('./gmail');
const { callModel } = require('../services/callModel');
const {
  createAttachmentUpload, rejectIfDisguisedExecutable, assertWithinQuota,
  insertAttachment, attachmentsForEntities, deleteAttachmentsForEntityIds,
} = require('../utils/attachments');
const { logCrmAudit } = require('../utils/crmAudit');

// ── Attachments on touchpoints (docs/crm-deals-schema.md §10) ──────────────
// Policy (allowlist, size cap, quota, disguised-executable check) lives in
// server/utils/attachments.js, shared with tasks (server/routes/tasks.js).
const uploadAttachment = createAttachmentUpload(req => String(req.params.id));

// Bulk-join touchpoints' attachments in one query, not a per-row loop —
// mirrors the existing pattern in this file (contacts/deals/projects are
// each one query, joined in JS).
async function withAttachments(touchpoints) {
  if (!touchpoints.length) return touchpoints;
  const byTouchpoint = await attachmentsForEntities('touchpoint', touchpoints.map(tp => tp.id));
  return touchpoints.map(tp => ({ ...tp, attachments: byTouchpoint.get(tp.id) || [] }));
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Returns the dominant core_emotion across all mood check-ins linked to a
// client's projects, and the total check-in count.
async function getClientMoodSummary(clientId, userId) {
  const { rows } = await pool.query(`
    SELECT mc.core_emotion, COUNT(*)::int AS cnt
    FROM mood_checkins mc
    JOIN projects p ON p.id = (CASE WHEN mc.entity_type = 'project' AND mc.entity_id ~ '^[0-9]+$' THEN mc.entity_id::int END)
    WHERE p."clientId" = $1
      AND mc.user_id = $2
    GROUP BY mc.core_emotion
    ORDER BY cnt DESC
    LIMIT 5
  `, [clientId, userId]);

  if (!rows.length) return { dominantEmotion: null, checkinCount: 0 };
  const total = rows.reduce((s, r) => s + r.cnt, 0);
  return { dominantEmotion: rows[0].core_emotion, checkinCount: total };
}

// ── Client CRUD ────────────────────────────────────────────────────────────────

// GET /api/clients
// Query: ?status=active&search=name
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const { status, search } = req.query;

  try {
    let whereClause = `WHERE c."userId" = $1`;
    const params = [userId];

    if (status) {
      params.push(status);
      whereClause += ` AND c.status = $${params.length}`;
    }
    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      whereClause += ` AND (LOWER(c.name) LIKE $${params.length} OR LOWER(c.company) LIKE $${params.length})`;
    }

    const { rows } = await pool.query(`
      SELECT
        c.*,
        COUNT(DISTINCT cc.id)::int                                              AS "contactCount",
        COUNT(DISTINCT p.id) FILTER (WHERE p."archived_at" IS NULL)::int       AS "projectCount",
        COALESCE(
          SUM(fi.total) FILTER (WHERE fi.status != 'void'), 0
        )                                                                        AS "totalInvoiced",
        COALESCE(
          SUM(fi.total) FILTER (WHERE fi.status = 'sent'), 0
        )                                                                        AS "outstanding",
        (
          SELECT mc.core_emotion
          FROM mood_checkins mc
          JOIN projects mp ON mp.id = (CASE WHEN mc.entity_type = 'project' AND mc.entity_id ~ '^[0-9]+$' THEN mc.entity_id::int END)
          WHERE mp."clientId" = c.id
            AND mc.user_id = c."userId"
          GROUP BY mc.core_emotion
          ORDER BY COUNT(*) DESC
          LIMIT 1
        )                                                                        AS "dominantMood"
      FROM clients c
      LEFT JOIN client_contacts cc  ON cc."clientId" = c.id
      LEFT JOIN projects p          ON p."clientId"  = c.id AND p."userId" = c."userId"
      LEFT JOIN fin_invoices fi     ON fi."clientRef" = c.id AND fi."userId" = c."userId" AND fi."docType" != 'quote'
      ${whereClause}
      GROUP BY c.id
      ORDER BY
        CASE c.status
          WHEN 'active'   THEN 0
          WHEN 'prospect' THEN 1
          WHEN 'paused'   THEN 2
          ELSE 3
        END,
        c.name ASC
    `, params);

    res.json(rows);
  } catch (err) {
    console.error('[clients] list error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/clients
router.post('/', async (req, res) => {
  const {
    name, company, status, communicationPref,
    howTheyWork, startDate, tags, notes, clientType,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const safeType = (clientType === 'individual') ? 'individual' : 'company';

  try {
    const { rows } = await pool.query(`
      INSERT INTO clients
        ("userId", name, company, status, "communicationPref", "howTheyWork", "startDate", tags, notes, "clientType")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      req.user.id,
      name.trim(),
      safeType === 'individual' ? null : (company || null),
      status   || 'active',
      communicationPref || null,
      howTheyWork       || null,
      startDate         || null,
      tags ? JSON.stringify(tags) : null,
      notes || null,
      safeType,
    ]);

    const client = rows[0];

    // Auto-create primary contact for individual clients
    if (safeType === 'individual') {
      await pool.query(
        `INSERT INTO client_contacts ("clientId", name, "isPrimary") VALUES ($1,$2,TRUE)`,
        [client.id, name.trim()]
      );
    }

    res.status(201).json(client);
  } catch (err) {
    console.error('[clients] create error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/clients/:id
router.get('/:id', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const userId   = req.user.id;

  try {
    const { rows: [client] } = await pool.query(
      'SELECT * FROM clients WHERE id=$1 AND "userId"=$2',
      [clientId, userId]
    );
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Contacts
    const { rows: contacts } = await pool.query(
      `SELECT * FROM client_contacts WHERE "clientId"=$1 ORDER BY "isPrimary" DESC, name ASC`,
      [clientId]
    );

    // Touchpoints (newest first) with contact name + deal title joined in
    const { rows: touchpointRows } = await pool.query(`
      SELECT tp.*, cc.name AS "contactName", cd.title AS "dealTitle"
      FROM client_touchpoints tp
      LEFT JOIN client_contacts cc ON cc.id = tp."contactId"
      LEFT JOIN client_deals cd ON cd.id = tp."dealId"
      WHERE tp."clientId" = $1
      ORDER BY tp.date DESC, tp."createdAt" DESC
    `, [clientId]);
    const touchpoints = await withAttachments(touchpointRows);

    // Linked projects
    const { rows: projects } = await pool.query(`
      SELECT id, name, goal, "archived_at", "updatedAt", "sortOrder"
      FROM projects
      WHERE "clientId"=$1 AND "userId"=$2
      ORDER BY "archived_at" ASC NULLS FIRST, "updatedAt" DESC
    `, [clientId, userId]);

    // Open tasks: across active linked projects, OR directly linked to this
    // client/a deal on it (a task doesn't need a project wrapper — see
    // docs/crm-deals-schema.md §5). LEFT JOIN projects since a directly
    // linked task may have no project at all.
    const activeProjectIds = projects.filter(p => !p.archived_at).map(p => p.id);
    const { rows: tasks } = await pool.query(
      `SELECT t.id, t.title, t.notes, t.status, t.priority, t.category, t."dueDate", t."isUrgent",
              t."projectId", p.name AS "projectName", t."clientId", t."dealId",
              t."parentTaskId", t."activityStatus"
       FROM tasks t
       LEFT JOIN projects p ON t."projectId" = p.id
       WHERE t.status != 'done'
         AND (t."projectId" = ANY($1::int[]) OR t."clientId" = $2)
       ORDER BY
         CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
         t."dueDate" ASC NULLS LAST`,
      [activeProjectIds, clientId]
    );

    // Finance summary
    const { rows: [finSummary] } = await pool.query(`
      SELECT
        COALESCE(SUM(total) FILTER (WHERE status != 'void'), 0)  AS "invoicedYTD",
        COALESCE(SUM(total) FILTER (WHERE status = 'sent'),  0)  AS "outstanding",
        MAX("issueDate") FILTER (WHERE status != 'void')         AS "lastInvoiceDate",
        COUNT(*)         FILTER (WHERE status != 'void')::int    AS "invoiceCount"
      FROM fin_invoices
      WHERE "clientRef"=$1 AND "userId"=$2 AND "docType" != 'quote'
        AND EXTRACT(year FROM "issueDate") = EXTRACT(year FROM NOW())
    `, [clientId, userId]);

    // Mood summary
    const moodSummary = await getClientMoodSummary(clientId, userId);

    // Deals
    const { rows: deals } = await pool.query(
      `SELECT * FROM client_deals WHERE "clientId"=$1 ORDER BY
         CASE stage WHEN 'won' THEN 1 WHEN 'lost' THEN 1 ELSE 0 END,
         "expectedCloseDate" ASC NULLS LAST, "updatedAt" DESC`,
      [clientId]
    );

    res.json({
      client,
      contacts,
      touchpoints,
      projects,
      tasks,
      deals,
      finance: finSummary,
      mood: moodSummary,
    });
  } catch (err) {
    console.error('[clients] get error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id
router.put('/:id', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const {
    name, company, status, communicationPref,
    howTheyWork, startDate, tags, notes, clientType,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  const safeType = (clientType === 'individual') ? 'individual' : 'company';

  try {
    const { rows } = await pool.query(`
      UPDATE clients
      SET
        name               = $1,
        company            = $2,
        status             = $3,
        "communicationPref"= $4,
        "howTheyWork"      = $5,
        "startDate"        = $6,
        tags               = $7,
        notes              = $8,
        "clientType"       = $9,
        "updatedAt"        = NOW()
      WHERE id=$10 AND "userId"=$11
      RETURNING *
    `, [
      name.trim(),
      safeType === 'individual' ? null : (company || null),
      status            || 'active',
      communicationPref || null,
      howTheyWork       || null,
      startDate         || null,
      tags ? JSON.stringify(tags) : null,
      notes || null,
      safeType,
      clientId,
      req.user.id,
    ]);

    if (!rows.length) return res.status(404).json({ error: 'Client not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[clients] update error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/clients/:id — partial update (e.g. status toggle)
router.patch('/:id', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const { status } = req.body;
  const allowed = ['prospect', 'active', 'paused', 'archived'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  try {
    const { rows } = await pool.query(
      `UPDATE clients SET status=$1 WHERE id=$2 AND "userId"=$3 RETURNING *`,
      [status, clientId, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error('[clients] patch error:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id
router.delete('/:id', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const userId   = req.user.id;

  try {
    const { rows: [client] } = await pool.query(
      'SELECT id FROM clients WHERE id=$1 AND "userId"=$2',
      [clientId, userId]
    );
    if (!client) return res.status(404).json({ error: 'Client not found' });

    // Unlink projects before deleting (ON DELETE SET NULL handles it, but be explicit)
    await pool.query(
      `UPDATE projects SET "clientId"=NULL WHERE "clientId"=$1`,
      [clientId]
    );

    // client_touchpoints cascades from clients (ON DELETE CASCADE) with no
    // app hook, and attachments have no FK to ride that cascade — so their
    // files would be silently orphaned on disk if not cleaned up here first.
    const { rows: tps } = await pool.query(
      `SELECT id FROM client_touchpoints WHERE "clientId"=$1`, [clientId]
    );
    await deleteAttachmentsForEntityIds('touchpoint', tps.map(t => t.id));

    await pool.query('DELETE FROM clients WHERE id=$1', [clientId]);
    res.json({ deleted: true });
  } catch (err) {
    console.error('[clients] delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Contacts ──────────────────────────────────────────────────────────────────

// GET /api/clients/:id/contacts
router.get('/:id/contacts', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  try {
    await assertClientOwner(clientId, req.user.id, res);
    const { rows } = await pool.query(
      `SELECT * FROM client_contacts WHERE "clientId"=$1 ORDER BY "isPrimary" DESC, name ASC`,
      [clientId]
    );
    res.json(rows);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/contacts
router.post('/:id/contacts', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const { name, role, email, phone, isPrimary } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    if (isPrimary) {
      await pool.query(
        `UPDATE client_contacts SET "isPrimary"=FALSE WHERE "clientId"=$1`,
        [clientId]
      );
    }

    const { rows } = await pool.query(`
      INSERT INTO client_contacts ("clientId", name, role, email, phone, "isPrimary")
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [clientId, name.trim(), role||null, email||null, phone||null, !!isPrimary]);

    logCrmAudit({ userId: req.user.id, clientId, entityType: 'contact', entityId: rows[0].id, action: 'create', after: rows[0] });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// PUT /api/clients/:id/contacts/:contactId
router.put('/:id/contacts/:contactId', async (req, res) => {
  const clientId   = parseInt(req.params.id, 10);
  const contactId  = parseInt(req.params.contactId, 10);
  const { name, role, email, phone, isPrimary } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    const { rows: beforeRows } = await pool.query(
      `SELECT * FROM client_contacts WHERE id=$1 AND "clientId"=$2`,
      [contactId, clientId]
    );

    if (isPrimary) {
      await pool.query(
        `UPDATE client_contacts SET "isPrimary"=FALSE WHERE "clientId"=$1 AND id != $2`,
        [clientId, contactId]
      );
    }

    const { rows } = await pool.query(`
      UPDATE client_contacts
      SET name=$1, role=$2, email=$3, phone=$4, "isPrimary"=$5
      WHERE id=$6 AND "clientId"=$7
      RETURNING *
    `, [name.trim(), role||null, email||null, phone||null, !!isPrimary, contactId, clientId]);

    if (!rows.length) return res.status(404).json({ error: 'Contact not found' });

    logCrmAudit({ userId: req.user.id, clientId, entityType: 'contact', entityId: contactId, action: 'update', before: beforeRows[0] || null, after: rows[0] });

    res.json(rows[0]);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id/contacts/:contactId
router.delete('/:id/contacts/:contactId', async (req, res) => {
  const clientId  = parseInt(req.params.id, 10);
  const contactId = parseInt(req.params.contactId, 10);
  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    const { rows: beforeRows } = await pool.query(
      `SELECT * FROM client_contacts WHERE id=$1 AND "clientId"=$2`,
      [contactId, clientId]
    );

    await pool.query(
      'DELETE FROM client_contacts WHERE id=$1 AND "clientId"=$2',
      [contactId, clientId]
    );

    if (beforeRows.length) {
      logCrmAudit({ userId: req.user.id, clientId, entityType: 'contact', entityId: contactId, action: 'delete', before: beforeRows[0] });
    }

    res.json({ deleted: true });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── Touchpoints ───────────────────────────────────────────────────────────────

// GET /api/clients/:id/touchpoints
router.get('/:id/touchpoints', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    const { rows } = await pool.query(`
      SELECT tp.*, cc.name AS "contactName"
      FROM client_touchpoints tp
      LEFT JOIN client_contacts cc ON cc.id = tp."contactId"
      WHERE tp."clientId" = $1
      ORDER BY tp.date DESC, tp."createdAt" DESC
    `, [clientId]);

    res.json(await withAttachments(rows));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/touchpoints
router.post('/:id/touchpoints', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const { contactId, dealId, type, date, note } = req.body;

  if (!date) return res.status(400).json({ error: 'date is required' });
  if (!type) return res.status(400).json({ error: 'type is required' });

  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    // A dealId must belong to this same client — no cross-client tagging.
    if (dealId) {
      const { rows: [deal] } = await pool.query(
        `SELECT id FROM client_deals WHERE id=$1 AND "clientId"=$2`, [dealId, clientId]
      );
      if (!deal) return res.status(400).json({ error: 'dealId does not belong to this client' });
    }

    const { rows } = await pool.query(`
      INSERT INTO client_touchpoints ("clientId", "contactId", "dealId", type, date, note)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [clientId, contactId||null, dealId||null, type, date, note||null]);

    // Return with contact name + deal title
    const { rows: [tp] } = await pool.query(`
      SELECT tp.*, cc.name AS "contactName", cd.title AS "dealTitle"
      FROM client_touchpoints tp
      LEFT JOIN client_contacts cc ON cc.id = tp."contactId"
      LEFT JOIN client_deals cd ON cd.id = tp."dealId"
      WHERE tp.id = $1
    `, [rows[0].id]);

    logCrmAudit({ userId: req.user.id, clientId, entityType: 'touchpoint', entityId: rows[0].id, action: 'create', after: tp });

    res.status(201).json(tp);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// DELETE /api/clients/:id/touchpoints/:touchpointId
router.delete('/:id/touchpoints/:touchpointId', async (req, res) => {
  const clientId      = parseInt(req.params.id, 10);
  const touchpointId  = parseInt(req.params.touchpointId, 10);
  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    const { rows: beforeRows } = await pool.query(
      `SELECT * FROM client_touchpoints WHERE id=$1 AND "clientId"=$2`,
      [touchpointId, clientId]
    );

    await deleteAttachmentsForEntityIds('touchpoint', [touchpointId]);

    await pool.query(
      'DELETE FROM client_touchpoints WHERE id=$1 AND "clientId"=$2',
      [touchpointId, clientId]
    );

    if (beforeRows.length) {
      logCrmAudit({ userId: req.user.id, clientId, entityType: 'touchpoint', entityId: touchpointId, action: 'delete', before: beforeRows[0] });
    }

    res.json({ deleted: true });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/touchpoints/:touchpointId/attachments
// Delete/download live at the generic /api/attachments/:id (server/routes/attachments.js)
// — only upload is entity-specific, since the destination folder and the
// touchpoint-ownership check at creation time differ per entity.
router.post('/:id/touchpoints/:touchpointId/attachments', uploadAttachment.single('file'), async (req, res) => {
  const clientId     = parseInt(req.params.id, 10);
  const touchpointId = parseInt(req.params.touchpointId, 10);
  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    const { rows: [tp] } = await pool.query(
      `SELECT id FROM client_touchpoints WHERE id=$1 AND "clientId"=$2`, [touchpointId, clientId]
    );
    if (!tp) return res.status(404).json({ error: 'Touchpoint not found' });
    if (!req.file) return res.status(400).json({ error: 'file is required' });

    await assertWithinQuota(req.user.id, req.file.size);
    await rejectIfDisguisedExecutable(req.file.path);

    const attachment = await insertAttachment({
      userId: req.user.id, entityType: 'touchpoint', entityId: touchpointId, file: req.file,
    });
    res.status(201).json(attachment);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ── AI activity summary ──────────────────────────────────────────────────────
// MVP of the CRM agent layer (docs/crm-deals-schema.md, AI agent layer /
// "summarize a client's activity history on demand"). On-demand only, not
// cached — later phases (suggest next action, draft follow-up) build on
// this same assembled-context pattern.

// POST /api/clients/:id/summary
router.post('/:id/summary', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const userId = req.user.id;

  try {
    const { rows: [client] } = await pool.query(
      `SELECT * FROM clients WHERE id=$1 AND "userId"=$2`, [clientId, userId]
    );
    if (!client) return res.status(404).json({ error: 'Client not found' });

    const { rows: contacts } = await pool.query(
      `SELECT name, role, "isPrimary" FROM client_contacts WHERE "clientId"=$1 ORDER BY "isPrimary" DESC`,
      [clientId]
    );
    const { rows: deals } = await pool.query(
      `SELECT title, stage, value, "expectedCloseDate", "actualCloseDate", "lostReason"
       FROM client_deals WHERE "clientId"=$1 ORDER BY "updatedAt" DESC LIMIT 15`,
      [clientId]
    );
    const { rows: touchpoints } = await pool.query(
      `SELECT type, date, note FROM client_touchpoints WHERE "clientId"=$1 ORDER BY date DESC, "createdAt" DESC LIMIT 10`,
      [clientId]
    );
    const { rows: [finance] } = await pool.query(
      `SELECT
         COALESCE(SUM(total) FILTER (WHERE status != 'void'), 0) AS "invoicedYTD",
         COALESCE(SUM(total) FILTER (WHERE status = 'sent'), 0)  AS "outstanding",
         MAX("issueDate") FILTER (WHERE status != 'void')        AS "lastInvoiceDate"
       FROM fin_invoices
       WHERE "clientRef"=$1 AND "userId"=$2 AND "docType" != 'quote'
         AND EXTRACT(year FROM "issueDate") = EXTRACT(year FROM NOW())`,
      [clientId, userId]
    );

    if (!deals.length && !touchpoints.length && Number(finance?.invoicedYTD || 0) === 0) {
      return res.json({ summary: 'Not enough activity yet to summarize — no deals, touchpoints, or invoices logged for this client.' });
    }

    const lines = [];
    lines.push(`Client: ${client.name}${client.company ? ` (${client.company})` : ''} — status: ${client.status}`);
    if (contacts.length) {
      lines.push(`Contacts: ${contacts.map(c => `${c.name}${c.role ? ` (${c.role})` : ''}${c.isPrimary ? ' [primary]' : ''}`).join(', ')}`);
    }
    if (deals.length) {
      lines.push('Deals:');
      for (const d of deals) {
        const close = d.actualCloseDate || d.expectedCloseDate;
        lines.push(`- ${d.title} [${d.stage}]${d.value ? ` $${d.value}` : ''}${close ? ` (${String(close).slice(0, 10)})` : ''}${d.lostReason ? ` — lost: ${d.lostReason}` : ''}`);
      }
    }
    if (touchpoints.length) {
      lines.push('Recent touchpoints (newest first):');
      for (const t of touchpoints) {
        lines.push(`- ${String(t.date).slice(0, 10)} [${t.type}]${t.note ? `: ${t.note}` : ''}`);
      }
    }
    lines.push(`Finance (this year): invoiced $${finance.invoicedYTD}, outstanding $${finance.outstanding}${finance.lastInvoiceDate ? `, last invoice ${String(finance.lastInvoiceDate).slice(0, 10)}` : ''}`);

    const { light: lightModel } = await getModelsForUser(userId);
    const summary = await callModel(
      lightModel,
      lines.join('\n'),
      {
        system: 'You summarize CRM client activity for a busy account owner. Write a tight 3-5 sentence brief: overall relationship health, what\'s active (deals/pipeline), anything overdue or needing attention (outstanding invoices, stale deals, no recent contact), and one suggested next step if obvious. Plain prose, no headers or bullet points, no preamble.',
        maxTokens: 300,
      }
    );

    res.json({ summary: summary.trim(), generatedAt: new Date().toISOString() });
  } catch (err) {
    console.error('[clients] summary error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Gmail search scoped to client contacts ────────────────────────────────────

// GET /api/clients/:id/gmail-search?q=
router.get('/:id/gmail-search', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const userId   = req.user.id;
  const { q }    = req.query;

  try {
    await assertClientOwner(clientId, userId, res);
    if (res.headersSent) return;

    // Get contact emails
    const { rows: contacts } = await pool.query(
      `SELECT email FROM client_contacts WHERE "clientId"=$1 AND email IS NOT NULL AND email != ''`,
      [clientId]
    );

    if (!contacts.length) {
      return res.json({ error: 'no_contacts', results: [] });
    }

    // Build contacts email filter (Gmail syntax)
    const emailParts = contacts.flatMap(c => [`from:${c.email}`, `to:${c.email}`]);
    const contactFilter = `(${emailParts.join(' OR ')})`;

    // Get authenticated Gmail client
    let gmail;
    try {
      gmail = await getGmailClient(userId);
    } catch (err) {
      if (err.message === 'Gmail not connected') {
        return res.json({ error: 'gmail_not_connected', results: [] });
      }
      throw err;
    }

    // Optionally incorporate NLP-translated q terms
    let finalQuery = contactFilter;
    if (q && q.trim()) {
      const today = new Date().toISOString().slice(0, 10);
      const { light: lightModel } = await getModelsForUser(req.user?.id);
      const { gmailQuery: translatedQ } = await translateToGmailQuery(q.trim(), today, lightModel, {
        userId: req.user?.id,
        feature: 'clients',
      });
      finalQuery = `${contactFilter} ${translatedQ}`;
    }

    const listRes = await gmail.users.messages.list({
      userId: 'me',
      q: finalQuery,
      maxResults: 20,
    });

    const msgs = listRes.data.messages || [];
    if (!msgs.length) {
      return res.json({ results: [], translatedQuery: finalQuery });
    }

    const results = await Promise.all(
      msgs.slice(0, 10).map(async (msg) => {
        const detail = await gmail.users.messages.get({
          userId: 'me',
          id: msg.id,
          format: 'metadata',
          metadataHeaders: ['Subject', 'From', 'Date'],
        });
        const headers = detail.data.payload?.headers || [];
        return {
          id:       msg.id,
          threadId: detail.data.threadId,
          subject:  getHeader(headers, 'Subject') || '(no subject)',
          from:     getHeader(headers, 'From'),
          date:     getHeader(headers, 'Date'),
          snippet:  detail.data.snippet || '',
        };
      })
    );

    res.json({ results, translatedQuery: finalQuery });
  } catch (err) {
    console.error('[clients] gmail-search error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── Internal helpers ──────────────────────────────────────────────────────────

// Verify the requesting user owns this client; sends 404 if not.
// Returns false and sets the response if ownership fails.
async function assertClientOwner(clientId, userId, res) {
  const { rows: [client] } = await pool.query(
    'SELECT id FROM clients WHERE id=$1 AND "userId"=$2',
    [clientId, userId]
  );
  if (!client) {
    res.status(404).json({ error: 'Client not found' });
    return false;
  }
  return true;
}

// ── Activity feed ────────────────────────────────────────────────────────────
// Merges touchpoints, deal stage-changes (from crm_audit_log), contact
// create/remove, and client-linked task create/complete into one
// chronological feed. Built in JS (three cheap queries + a sort) rather than
// one gnarly UNION, matching this file's existing "one query per source,
// joined in JS" pattern (see withAttachments/touchpoints above).
const DEAL_STAGE_LABELS = {
  lead: 'Lead', qualified: 'Qualified', proposal: 'Proposal',
  negotiation: 'Negotiation', won: 'Won', lost: 'Lost',
};
const TOUCHPOINT_TYPE_LABELS = {
  call: 'Call', email: 'Email', meeting: 'Meeting',
  decision: 'Decision', milestone: 'Milestone', other: 'Touchpoint',
};

function parseMaybeJson(v) {
  if (v == null) return null;
  return typeof v === 'string' ? JSON.parse(v) : v;
}

// GET /api/clients/:id/activity
router.get('/:id/activity', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  try {
    const ok = await assertClientOwner(clientId, req.user.id, res);
    if (!ok) return;

    const [{ rows: touchpoints }, { rows: auditRows }, { rows: tasks }] = await Promise.all([
      pool.query(`
        SELECT tp.*, cc.name AS "contactName", cd.title AS "dealTitle"
        FROM client_touchpoints tp
        LEFT JOIN client_contacts cc ON cc.id = tp."contactId"
        LEFT JOIN client_deals cd ON cd.id = tp."dealId"
        WHERE tp."clientId"=$1
      `, [clientId]),
      pool.query(`
        SELECT * FROM crm_audit_log
        WHERE "clientId"=$1 AND "entityType" IN ('deal','contact')
        ORDER BY "createdAt" DESC
        LIMIT 200
      `, [clientId]),
      pool.query(`
        SELECT id, title, status, "createdAt", "updatedAt", "dueDate"
        FROM tasks WHERE "clientId"=$1
      `, [clientId]),
    ]);

    const items = [];

    for (const tp of touchpoints) {
      const label = TOUCHPOINT_TYPE_LABELS[tp.type] || tp.type;
      items.push({
        id: `touchpoint-${tp.id}`,
        kind: 'touchpoint',
        ts: tp.date,
        title: `${label}${tp.contactName ? ` with ${tp.contactName}` : ''}`,
        detail: tp.note || null,
        meta: { dealTitle: tp.dealTitle || null, touchpointType: tp.type },
      });
    }

    for (const row of auditRows) {
      const before = parseMaybeJson(row.before);
      const after  = parseMaybeJson(row.after);

      if (row.entityType === 'deal') {
        if (row.action === 'create') {
          items.push({ id: `audit-${row.id}`, kind: 'deal', ts: row.createdAt, title: `Deal created: ${after?.title || ''}`, detail: null, meta: { stage: after?.stage } });
        } else if (row.action === 'delete') {
          items.push({ id: `audit-${row.id}`, kind: 'deal', ts: row.createdAt, title: `Deal deleted: ${before?.title || ''}`, detail: null, meta: {} });
        } else if (row.action === 'update' && before?.stage !== after?.stage) {
          const fromLabel = DEAL_STAGE_LABELS[before?.stage] || before?.stage;
          const toLabel   = DEAL_STAGE_LABELS[after?.stage]  || after?.stage;
          items.push({ id: `audit-${row.id}`, kind: 'deal', ts: row.createdAt, title: `${after?.title || 'Deal'}: ${fromLabel} → ${toLabel}`, detail: null, meta: { stage: after?.stage } });
        }
        // Non-stage updates (value/notes edits) are noise for a relationship
        // feed — skipped on purpose.
      } else if (row.entityType === 'contact') {
        if (row.action === 'create') {
          items.push({ id: `audit-${row.id}`, kind: 'contact', ts: row.createdAt, title: `Contact added: ${after?.name || ''}`, detail: null, meta: {} });
        } else if (row.action === 'delete') {
          items.push({ id: `audit-${row.id}`, kind: 'contact', ts: row.createdAt, title: `Contact removed: ${before?.name || ''}`, detail: null, meta: {} });
        }
        // Contact edits (role/email/phone) are reference-data maintenance,
        // not relationship activity — skipped on purpose.
      }
    }

    for (const t of tasks) {
      items.push({ id: `task-created-${t.id}`, kind: 'task', ts: t.createdAt, title: `Task created: ${t.title}`, detail: t.dueDate ? `Due ${String(t.dueDate).slice(0, 10)}` : null, meta: { status: t.status } });
      if (t.status === 'done') {
        items.push({ id: `task-done-${t.id}`, kind: 'task', ts: t.updatedAt, title: `Task completed: ${t.title}`, detail: null, meta: { status: 'done' } });
      }
    }

    items.sort((a, b) => new Date(b.ts) - new Date(a.ts));

    res.json(items.slice(0, 150));
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
