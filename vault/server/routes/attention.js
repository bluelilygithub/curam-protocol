'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { loadFeatureAccess } = require('../middleware/auth');
const { buildAttentionItems } = require('../services/attention');
const { unseenSummary: youtubeUnseen } = require('../services/youtubeFollows');

// GET /api/attention — the short "needs attention" list for the signed-in person (see services/attention.js for ranking and wording).
// Every source is its own query, filtered by the caller's own id and (where there is one) their feature switch, and a source that fails is
// simply left out so the list never blocks the page it sits on.

async function workspaceToday() {
  let tz = 'Australia/Sydney';
  try {
    const { rows } = await pool.query(
      `SELECT s.value FROM settings s JOIN users u ON u.id = s."userId"
        WHERE s.key = 'user_timezone' AND u."isAdmin" = TRUE ORDER BY u.id ASC LIMIT 1`
    );
    tz = rows[0]?.value?.trim() || tz;
  } catch (_) { /* default */ }
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()); } catch (_) { return new Date().toISOString().slice(0, 10); }
}

router.get('/', async (req, res) => {
  const userId = req.user.id;
  let flags = null; // null = admin, everything on
  if (!req.user.isAdmin) {
    try { flags = await loadFeatureAccess(userId); } catch (_) { flags = {}; }
  }
  const can = (key) => flags === null || flags[key] !== false;
  const today = await workspaceToday();
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows).catch((err) => { console.error('[attention]', err.message); return null; });
  const taskBase = `FROM tasks WHERE "userId" = $1 AND "parentTaskId" IS NULL AND status IN ('todo','in-progress') AND "dueDate" IS NOT NULL`;

  const [overdue, dueToday, reminders, invoices, expense, suggestions, youtube] = await Promise.all([
    q(`SELECT title, COUNT(*) OVER () AS n ${taskBase} AND LEFT("dueDate", 10) < $2
        ORDER BY "dueDate" ASC, CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 3`, [userId, today]),
    q(`SELECT title, COUNT(*) OVER () AS n ${taskBase} AND LEFT("dueDate", 10) = $2
        ORDER BY CASE priority WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END LIMIT 3`, [userId, today]),
    q(`SELECT title, COUNT(*) OVER () AS n FROM notes
        WHERE user_id = $1 AND remind_at IS NOT NULL AND remind_at <= NOW() AND reminder_done_at IS NULL
        ORDER BY remind_at ASC LIMIT 3`, [userId]),
    can('finance') ? q(`SELECT number, total, COUNT(*) OVER () AS n, SUM(total) OVER () AS sum_total FROM fin_invoices
        WHERE "userId" = $1 AND status = 'sent' AND COALESCE("docType", 'invoice') = 'invoice' AND "dueDate" IS NOT NULL AND "dueDate" < $2::date
        ORDER BY "dueDate" ASC LIMIT 3`, [userId, today]) : null,
    can('gmailIntel') ? q(`SELECT COUNT(*)::int AS n FROM expense_review_queue WHERE "userId" = $1 AND "reviewStatus" = 'pending'`, [userId]) : null,
    q(`SELECT COUNT(*)::int AS n FROM agent_suggestions WHERE "userId" = $1 AND status = 'new'`, [userId]),
    can('youtube') ? youtubeUnseen(pool, userId).catch((err) => { console.error('[attention]', err.message); return null; }) : null,
  ]);

  const list = (rows, field) => (rows ? { count: Number(rows[0]?.n || 0), sample: rows.map((r) => r[field]) } : null);
  const raw = {
    tasksOverdue: list(overdue, 'title'),
    tasksToday: list(dueToday, 'title'),
    remindersDue: list(reminders, 'title'),
    invoicesOverdue: invoices ? { count: Number(invoices[0]?.n || 0), total: Number(invoices[0]?.sum_total || 0), sample: invoices.map((r) => r.number) } : null,
    expensePending: expense ? { count: Number(expense[0]?.n || 0) } : null,
    suggestionsNew: suggestions ? { count: Number(suggestions[0]?.n || 0) } : null,
    youtubeNew: youtube && youtube.count > 0 ? youtube : null,
  };
  Object.keys(raw).forEach((k) => { if (!raw[k]) delete raw[k]; });
  res.json({ items: buildAttentionItems(raw) });
});

module.exports = router;
