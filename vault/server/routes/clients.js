'use strict';

const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const { translateToGmailQuery } = require('../services/gmailNLP');
const { getModelsForUser } = require('../services/modelResolver');
const { getGmailClient, getHeader } = require('./gmail');

// ── Helpers ────────────────────────────────────────────────────────────────────

// Returns the dominant core_emotion across all mood check-ins linked to a
// client's projects, and the total check-in count.
async function getClientMoodSummary(clientId, userId) {
  const { rows } = await pool.query(`
    SELECT mc.core_emotion, COUNT(*)::int AS cnt
    FROM mood_checkins mc
    JOIN projects p ON p.id = mc.entity_id
      AND mc.entity_type = 'project'
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
          JOIN projects mp ON mp.id = mc.entity_id
            AND mc.entity_type = 'project'
          WHERE mp."clientId" = c.id
            AND mc.user_id = c."userId"
          GROUP BY mc.core_emotion
          ORDER BY COUNT(*) DESC
          LIMIT 1
        )                                                                        AS "dominantMood"
      FROM clients c
      LEFT JOIN client_contacts cc  ON cc."clientId" = c.id
      LEFT JOIN projects p          ON p."clientId"  = c.id AND p."userId" = c."userId"
      LEFT JOIN fin_invoices fi     ON fi."clientRef" = c.id AND fi."userId" = c."userId"
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

    // Touchpoints (newest first) with contact name joined in
    const { rows: touchpoints } = await pool.query(`
      SELECT tp.*, cc.name AS "contactName"
      FROM client_touchpoints tp
      LEFT JOIN client_contacts cc ON cc.id = tp."contactId"
      WHERE tp."clientId" = $1
      ORDER BY tp.date DESC, tp."createdAt" DESC
    `, [clientId]);

    // Linked projects
    const { rows: projects } = await pool.query(`
      SELECT id, name, goal, "archived_at", "updatedAt", "sortOrder"
      FROM projects
      WHERE "clientId"=$1 AND "userId"=$2
      ORDER BY "archived_at" ASC NULLS FIRST, "updatedAt" DESC
    `, [clientId, userId]);

    // Open tasks across active linked projects
    const activeProjectIds = projects.filter(p => !p.archived_at).map(p => p.id);
    let tasks = [];
    if (activeProjectIds.length > 0) {
      const { rows: taskRows } = await pool.query(
        `SELECT t.id, t.title, t.status, t.priority, t."dueDate", t."isUrgent",
                t."projectId", p.name AS "projectName"
         FROM tasks t
         JOIN projects p ON t."projectId" = p.id
         WHERE t."projectId" = ANY($1::int[]) AND t.status != 'done'
         ORDER BY
           CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
           t."dueDate" ASC NULLS LAST`,
        [activeProjectIds]
      );
      tasks = taskRows;
    }

    // Finance summary
    const { rows: [finSummary] } = await pool.query(`
      SELECT
        COALESCE(SUM(total) FILTER (WHERE status != 'void'), 0)  AS "invoicedYTD",
        COALESCE(SUM(total) FILTER (WHERE status = 'sent'),  0)  AS "outstanding",
        MAX("issueDate") FILTER (WHERE status != 'void')         AS "lastInvoiceDate",
        COUNT(*)         FILTER (WHERE status != 'void')::int    AS "invoiceCount"
      FROM fin_invoices
      WHERE "clientRef"=$1 AND "userId"=$2
        AND EXTRACT(year FROM "issueDate") = EXTRACT(year FROM NOW())
    `, [clientId, userId]);

    // Mood summary
    const moodSummary = await getClientMoodSummary(clientId, userId);

    res.json({
      client,
      contacts,
      touchpoints,
      projects,
      tasks,
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

    await pool.query(
      'DELETE FROM client_contacts WHERE id=$1 AND "clientId"=$2',
      [contactId, clientId]
    );
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

    res.json(rows);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// POST /api/clients/:id/touchpoints
router.post('/:id/touchpoints', async (req, res) => {
  const clientId = parseInt(req.params.id, 10);
  const { contactId, type, date, note } = req.body;

  if (!date) return res.status(400).json({ error: 'date is required' });
  if (!type) return res.status(400).json({ error: 'type is required' });

  try {
    await assertClientOwner(clientId, req.user.id, res);
    if (res.headersSent) return;

    const { rows } = await pool.query(`
      INSERT INTO client_touchpoints ("clientId", "contactId", type, date, note)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING *
    `, [clientId, contactId||null, type, date, note||null]);

    // Return with contact name
    const { rows: [tp] } = await pool.query(`
      SELECT tp.*, cc.name AS "contactName"
      FROM client_touchpoints tp
      LEFT JOIN client_contacts cc ON cc.id = tp."contactId"
      WHERE tp.id = $1
    `, [rows[0].id]);

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

    await pool.query(
      'DELETE FROM client_touchpoints WHERE id=$1 AND "clientId"=$2',
      [touchpointId, clientId]
    );
    res.json({ deleted: true });
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
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

module.exports = router;
