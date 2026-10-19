'use strict';

// GET /api/dashboard/attention — one call for Home's "Needs attention" tile.
// Each item is { key, label, count, path, detail? }. Items with a zero count are omitted and
// items for a feature the person cannot use are never queried, so the tile only shows real work.

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { loadFeatureAccess } = require('../middleware/auth');
const { getLogger } = require('../middleware/requestContext');

router.get('/attention', async (req, res) => {
  try {
    const userId = req.user.id;
    const flags = await loadFeatureAccess(userId);
    const can = (key) => req.user.isAdmin || flags[key] !== false;
    const today = new Date().toISOString().slice(0, 10);
    const items = [];

    const { rows: sug } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM agent_suggestions WHERE "userId"=$1 AND status='new'`,
      [userId]
    );
    if (sug[0].count > 0) {
      items.push({ key: 'suggestions', label: 'New suggestions', count: sug[0].count, path: '/suggestions' });
    }

    const { rows: tasks } = await pool.query(
      `SELECT COUNT(*) FILTER (WHERE "dueDate" < $2)::int AS overdue,
              COUNT(*) FILTER (WHERE "dueDate" = $2)::int AS today
         FROM tasks
        WHERE "userId"=$1 AND "parentTaskId" IS NULL
          AND status IN ('todo','in-progress') AND "dueDate" IS NOT NULL`,
      [userId, today]
    );
    if (tasks[0].overdue > 0) {
      items.push({ key: 'tasksOverdue', label: 'Overdue tasks', count: tasks[0].overdue, path: '/tasks', urgent: true });
    }
    if (tasks[0].today > 0) {
      items.push({ key: 'tasksToday', label: 'Tasks due today', count: tasks[0].today, path: '/tasks' });
    }

    if (can('gmailIntel')) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM expense_review_queue WHERE "userId"=$1 AND "reviewStatus"='pending'`,
        [userId]
      );
      if (rows[0].count > 0) {
        items.push({ key: 'invoiceReview', label: 'Invoices to review', count: rows[0].count, path: '/expense-review' });
      }
    }

    if (can('finance')) {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0) AS total
           FROM fin_invoices
          WHERE "userId"=$1 AND status='sent' AND COALESCE("docType",'invoice')='invoice'
            AND "dueDate" IS NOT NULL AND "dueDate"::date < $2::date`,
        [userId, today]
      );
      if (rows[0].count > 0) {
        items.push({
          key: 'invoicesOverdue',
          label: 'Overdue invoices',
          count: rows[0].count,
          detail: Number(rows[0].total),
          path: '/finance',
          urgent: true,
        });
      }
    }

    res.json({ items });
  } catch (err) {
    getLogger().error({ err }, 'dashboard attention failed');
    res.status(500).json({ error: 'Could not load dashboard' });
  }
});

// GET /api/dashboard/overview - Home's Money and Pipeline tiles. Stored data only: no live
// quote or Gmail calls, so Home stays fast. A section is left out when the person cannot use
// that feature.
router.get('/overview', async (req, res) => {
  try {
    const userId = req.user.id;
    const flags = await loadFeatureAccess(userId);
    const can = (key) => req.user.isAdmin || flags[key] !== false;
    const today = new Date().toISOString().slice(0, 10);
    const out = {};

    if (can('finance')) {
      const { rows: inv } = await pool.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(total),0) AS total
           FROM fin_invoices
          WHERE "userId"=$1 AND status='sent' AND COALESCE("docType",'invoice')='invoice'`,
        [userId]
      );
      // No BAS line once GST registration is switched off (Finance settings), and only a
      // recent unpaid quarter otherwise: old quarters that were never closed off are
      // housekeeping, not something to show as a live deadline. The ATO due date is 28 days
      // after quarter end; shown as a guide.
      const { rows: reg } = await pool.query(
        `SELECT value FROM settings WHERE "userId"=$1 AND key='fin_gst_registered'`, [userId]);
      const gstRegistered = reg[0]?.value !== 'false';
      const { rows: bas } = gstRegistered ? await pool.query(
        `SELECT to_char(from_date,'YYYY-MM-DD') AS "from", to_char(to_date,'YYYY-MM-DD') AS "to",
                to_char(to_date + 28,'YYYY-MM-DD') AS due, status
           FROM fin_bas_quarters
          WHERE "userId"=$1 AND status <> 'paid' AND to_date >= ($2::date - 120)
          ORDER BY to_date ASC LIMIT 1`,
        [userId, today]
      ) : { rows: [] };
      out.money = {
        outstandingCount: inv[0].count,
        outstandingTotal: Number(inv[0].total),
        bas: bas[0] || null,
      };
    }

    if (can('shares')) {
      // Latest snapshot against the last one recorded before the latest snapshot's calendar day.
      const { rows } = await pool.query(
        `WITH latest AS (
           SELECT "totalValueAud", "recordedAt" FROM share_portfolio_snapshots
            WHERE "userId"=$1 ORDER BY "recordedAt" DESC LIMIT 1)
         SELECT l."totalValueAud" AS now, l."recordedAt" AS "at",
                (SELECT p."totalValueAud" FROM share_portfolio_snapshots p
                  WHERE p."userId"=$1 AND p."recordedAt" < date_trunc('day', l."recordedAt")
                  ORDER BY p."recordedAt" DESC LIMIT 1) AS before
           FROM latest l`,
        [userId]
      );
      if (rows[0]) {
        const now = Number(rows[0].now);
        const before = rows[0].before == null ? null : Number(rows[0].before);
        out.shares = {
          value: now,
          change: before == null ? null : now - before,
          changePct: before ? ((now - before) / before) * 100 : null,
          at: rows[0].at,
        };
      }
    }

    if (can('clients')) {
      const { rows: stages } = await pool.query(
        `SELECT stage, COUNT(*)::int AS count, COALESCE(SUM(value),0) AS "totalValue"
           FROM client_deals
          WHERE "userId"=$1 AND stage NOT IN ('won','lost')
          GROUP BY stage`,
        [userId]
      );
      const { rows: closing } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM client_deals
          WHERE "userId"=$1 AND stage NOT IN ('won','lost') AND "expectedCloseDate" IS NOT NULL
            AND "expectedCloseDate" <= ($2::date + 14)`,
        [userId, today]
      );
      // Follow-ups = open tasks linked straight to a client (the CRM "+ Follow up" button).
      const { rows: follow } = await pool.query(
        `SELECT COUNT(*)::int AS count FROM tasks
          WHERE "userId"=$1 AND "clientId" IS NOT NULL AND "parentTaskId" IS NULL
            AND status IN ('todo','in-progress') AND "dueDate" IS NOT NULL AND "dueDate" <= to_char($2::date + 7,'YYYY-MM-DD')`,
        [userId, today]
      );
      const order = ['lead', 'qualified', 'proposal', 'negotiation'];
      out.pipeline = {
        stages: order
          .map((stage) => stages.find((r) => r.stage === stage))
          .filter(Boolean)
          .map((r) => ({ stage: r.stage, count: r.count, totalValue: Number(r.totalValue) })),
        closingSoon: closing[0].count,
        followUpsDue: follow[0].count,
      };
    }

    res.json(out);
  } catch (err) {
    getLogger().error({ err }, 'dashboard overview failed');
    res.status(500).json({ error: 'Could not load dashboard' });
  }
});

module.exports = router;
