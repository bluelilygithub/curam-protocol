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

module.exports = router;
