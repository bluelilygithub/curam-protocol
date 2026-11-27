'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const { loadFeatureAccess } = require('../middleware/auth');
const { buildAttentionItems, buildAttentionSummary } = require('../services/attention');
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

// The counts for one person; `extra` adds the sources only the Home sidebar shows (plans, tickets, emails).
async function collect(req, extra = false) {
  const userId = req.user.id;
  let flags = null; // null = admin, everything on
  if (!req.user.isAdmin) {
    try { flags = await loadFeatureAccess(userId); } catch (_) { flags = {}; }
  }
  const can = (key) => flags === null || flags[key] !== false;
  const today = await workspaceToday();
  const q = (sql, params) => pool.query(sql, params).then((r) => r.rows).catch((err) => { console.error('[attention]', err.message); return null; });
  const taskBase = `FROM tasks WHERE "userId" = $1 AND "parentTaskId" IS NULL AND status IN ('todo','in-progress') AND "dueDate" IS NOT NULL`;

  const [overdue, dueToday, reminders, invoices, expense, suggestions, youtube, pdfHtml, geoCheck, plansLate, ticketRows, inbox, drafts] = await Promise.all([
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
    // PDF Tools → PDF → HTML pages that finished in the background and have not been opened yet (PDF Tools has no feature switch)
    q(`SELECT filename, COUNT(*) OVER () AS n FROM pdf_html_jobs WHERE "userId" = $1 AND status = 'done' AND "seenAt" IS NULL
        ORDER BY "finishedAt" DESC LIMIT 3`, [userId]),
    // Device preview → Countries: country checks that finished in the background and have not been opened yet
    can('geoCheck') && can('restyle') ? q(`SELECT COALESCE(label, url) AS name, COUNT(*) OVER () AS n FROM geo_check_runs
        WHERE "userId" = $1 AND status IN ('done', 'stopped', 'failed') AND "seenAt" IS NULL ORDER BY "finishedAt" DESC LIMIT 3`, [userId]) : null,
    // steps of active plans that should have finished by today (a step ends startDate + durationDays)
    extra && can('plans') ? q(`SELECT s.title || ' (' || p.title || ')' AS title, COUNT(*) OVER () AS n FROM plan_steps s JOIN plans p ON p.id = s."planId"
        WHERE p."userId" = $1 AND p.status = 'active' AND s.status <> 'done' AND s."startDate" IS NOT NULL AND s."startDate" + s."durationDays" < $2::date
        ORDER BY s."startDate" ASC LIMIT 3`, [userId, today]) : null,
    // tickets are shared; these are the ones assigned to this person
    extra && can('tickets') ? q(`SELECT title, "dueDate" < $2::date AS late, COUNT(*) OVER () AS n FROM tickets
        WHERE "assigneeId" = $1 AND status <> 'done' ORDER BY "dueDate" ASC NULLS LAST LIMIT 200`, [userId, today]) : null,
    // Inbox Intel: threads classified urgent or waiting on me in the last fortnight, not yet actioned or acknowledged
    extra && can('gmailIntel') ? q(`SELECT "oneLine" AS title, COUNT(*) OVER () AS n FROM gmail_classifications
        WHERE "userId" = $1::text AND category IN ('urgent','waiting') AND NOT COALESCE(actioned, FALSE) AND NOT COALESCE(acknowledged, FALSE)
          AND "classifiedAt" > NOW() - INTERVAL '14 days' ORDER BY (category = 'urgent') DESC, "classifiedAt" DESC LIMIT 3`, [userId]) : null,
    extra && can('emailFollowUp') ? q(`SELECT COUNT(*)::int AS n FROM ef_drafts d JOIN ef_cases c ON c.id = d."caseId"
        WHERE c."userId" = $1 AND c.status = 'active' AND d.status = 'pending'`, [userId]) : null,
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
    pdfHtmlReady: list(pdfHtml, 'filename'),
    geoCheckReady: list(geoCheck, 'name'),
  };
  if (extra) {
    raw.plansOverdue = list(plansLate, 'title');
    if (ticketRows) {
      const late = ticketRows.filter((t) => t.late);
      raw.ticketsMine = { count: Number(ticketRows[0]?.n || 0) };
      raw.ticketsOverdue = { count: late.length, sample: late.slice(0, 3).map((t) => t.title) };
    }
    raw.inboxNeeds = list(inbox, 'title');
    raw.followUpDrafts = drafts ? { count: Number(drafts[0]?.n || 0) } : null;
  }
  // Admins only: two-step login cannot work on this server (docs/two-step-login.md). Checked in memory, no query.
  if (req.user.isAdmin && require('../services/loginChallenge').authKeyProblem()) raw.authKeyBroken = { count: 1 };
  Object.keys(raw).forEach((k) => { if (!raw[k]) delete raw[k]; });
  return raw;
}

router.get('/', async (req, res) => {
  res.json({ items: buildAttentionItems(await collect(req)) });
});

// GET /api/attention/summary — the Home page sidebar: one box per area (services/attention.js buildAttentionSummary)
router.get('/summary', async (req, res) => {
  res.json({ areas: buildAttentionSummary(await collect(req, true)) });
});

module.exports = router;
