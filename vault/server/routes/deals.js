'use strict';

const express = require('express');
const router  = express.Router();
const { pool } = require('../db');

// ── Helpers ────────────────────────────────────────────────────────────────────

// Verify the requesting user owns this client (deals are always scoped to a
// client they own); sends 404 if not. Returns false and sets the response
// if ownership fails. Mirrors clients.js's assertClientOwner.
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

// Verify the requesting user owns this deal; sends 404 if not.
async function assertDealOwner(dealId, userId, res) {
  const { rows: [deal] } = await pool.query(
    'SELECT id, "clientId" FROM client_deals WHERE id=$1 AND "userId"=$2',
    [dealId, userId]
  );
  if (!deal) {
    res.status(404).json({ error: 'Deal not found' });
    return null;
  }
  return deal;
}

// ── Deals ──────────────────────────────────────────────────────────────────────

// Whitelisted sort columns — never interpolate req.query directly into ORDER BY.
const SORT_COLUMNS = {
  closeDate: `COALESCE(d."actualCloseDate", d."expectedCloseDate")`,
  value: `d.value`,
  stage: `d.stage`,
};

// GET /api/deals?clientId=&stage=lead,qualified&open=true&sortBy=closeDate&order=asc
// clientId omitted = every deal across every client (workspace-wide Deals/
// Pipeline view), joined to client name so the caller can display it.
router.get('/', async (req, res) => {
  try {
    const { clientId, stage, open, sortBy, order } = req.query;
    const where = ['d."userId" = $1'];
    const params = [req.user.id];

    if (clientId) {
      params.push(parseInt(clientId, 10));
      where.push(`d."clientId" = $${params.length}`);
    }
    if (stage) {
      // Accepts one stage ("lead") or several ("lead,qualified") — the
      // workspace-wide view's multi-select filter uses the latter.
      const stages = stage.split(',').map(s => s.trim()).filter(Boolean);
      if (stages.length) {
        params.push(stages);
        where.push(`d.stage = ANY($${params.length})`);
      }
    }
    if (open === 'true') {
      where.push(`d.stage NOT IN ('won','lost')`);
    }

    const sortCol = SORT_COLUMNS[sortBy] || SORT_COLUMNS.closeDate;
    const sortDir = order === 'desc' ? 'DESC' : 'ASC';

    const { rows } = await pool.query(
      `SELECT d.*, c.name AS "clientName"
       FROM client_deals d
       JOIN clients c ON c.id = d."clientId"
       WHERE ${where.join(' AND ')}
       ORDER BY
         CASE d.stage WHEN 'won' THEN 1 WHEN 'lost' THEN 1 ELSE 0 END,
         ${sortCol} ${sortDir} NULLS LAST, d."updatedAt" DESC`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deals/pipeline — summary for a dashboard: value + count per open stage
router.get('/pipeline', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(value), 0) AS "totalValue"
       FROM client_deals
       WHERE "userId"=$1 AND stage NOT IN ('won','lost')
       GROUP BY stage`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/deals/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT d.*, c.name AS "clientName"
       FROM client_deals d
       JOIN clients c ON c.id = d."clientId"
       WHERE d.id=$1 AND d."userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Deal not found' });

    const { rows: contacts } = await pool.query(
      `SELECT cc.* FROM deal_contacts dc
       JOIN client_contacts cc ON cc.id = dc."contactId"
       WHERE dc."dealId"=$1`,
      [req.params.id]
    );
    const { rows: touchpoints } = await pool.query(
      `SELECT tp.*, cc.name AS "contactName"
       FROM client_touchpoints tp
       LEFT JOIN client_contacts cc ON cc.id = tp."contactId"
       WHERE tp."dealId"=$1
       ORDER BY tp.date DESC, tp."createdAt" DESC`,
      [req.params.id]
    );

    res.json({ ...rows[0], contacts, touchpoints });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/deals
router.post('/', async (req, res) => {
  try {
    const { clientId, title, stage, value, expectedCloseDate, notes } = req.body;
    if (!clientId) return res.status(400).json({ error: 'clientId required' });
    if (!title?.trim()) return res.status(400).json({ error: 'title required' });

    if (!(await assertClientOwner(clientId, req.user.id, res))) return;

    const { rows } = await pool.query(
      `INSERT INTO client_deals ("userId","clientId",title,stage,value,"expectedCloseDate",notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.user.id, clientId, title.trim(), stage || 'lead', value || null, expectedCloseDate || null, notes || null]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid stage' });
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/deals/:id
router.put('/:id', async (req, res) => {
  try {
    const deal = await assertDealOwner(req.params.id, req.user.id, res);
    if (!deal) return;

    const { title, stage, value, expectedCloseDate, actualCloseDate, lostReason, notes } = req.body;

    // Auto-set actualCloseDate on transition into won/lost if not explicitly provided
    const closingNow = (stage === 'won' || stage === 'lost');
    const resolvedActualCloseDate = actualCloseDate || (closingNow ? new Date().toISOString().slice(0, 10) : null);

    const { rows } = await pool.query(
      `UPDATE client_deals
       SET title=$1, stage=$2, value=$3, "expectedCloseDate"=$4, "actualCloseDate"=$5,
           "lostReason"=$6, notes=$7, "updatedAt"=NOW()
       WHERE id=$8 AND "userId"=$9 RETURNING *`,
      [title, stage, value || null, expectedCloseDate || null, resolvedActualCloseDate,
       stage === 'lost' ? (lostReason || null) : null, notes || null, req.params.id, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23514') return res.status(400).json({ error: 'Invalid stage' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/deals/:id
router.delete('/:id', async (req, res) => {
  try {
    if (!(await assertDealOwner(req.params.id, req.user.id, res))) return;
    // Cascades to deal_contacts; client_touchpoints."dealId" is ON DELETE SET NULL,
    // so past activity survives, just loses its deal tag.
    await pool.query(`DELETE FROM client_deals WHERE id=$1 AND "userId"=$2`, [req.params.id, req.user.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Deal contacts (stakeholders) ────────────────────────────────────────────────

// PUT /api/deals/:id/contacts — replace the full stakeholder list
router.put('/:id/contacts', async (req, res) => {
  const dbClient = await pool.connect();
  try {
    const deal = await assertDealOwner(req.params.id, req.user.id, res);
    if (!deal) return;

    const { contactIds } = req.body;
    if (!Array.isArray(contactIds)) return res.status(400).json({ error: 'contactIds must be an array' });

    // Every contact must belong to the deal's own client — no cross-client linking.
    if (contactIds.length > 0) {
      const { rows: valid } = await pool.query(
        `SELECT id FROM client_contacts WHERE id = ANY($1::int[]) AND "clientId"=$2`,
        [contactIds, deal.clientId]
      );
      if (valid.length !== contactIds.length) {
        return res.status(400).json({ error: 'One or more contactIds do not belong to this deal\'s client' });
      }
    }

    await dbClient.query('BEGIN');
    await dbClient.query(`DELETE FROM deal_contacts WHERE "dealId"=$1`, [req.params.id]);
    for (const contactId of contactIds) {
      await dbClient.query(
        `INSERT INTO deal_contacts ("dealId","contactId") VALUES ($1,$2)`,
        [req.params.id, contactId]
      );
    }
    await dbClient.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await dbClient.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    dbClient.release();
  }
});

module.exports = router;
