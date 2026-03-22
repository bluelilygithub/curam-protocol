'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

// Write to settings table for backwards compatibility
async function syncToSettings(userId, text) {
  await pool.query(
    "INSERT INTO settings (\"userId\", key, value) VALUES ($1, 'mission_statement', $2) ON CONFLICT (\"userId\", key) DO UPDATE SET value=EXCLUDED.value",
    [userId, text]
  );
}

function formatRow(r) {
  return {
    id: r.id,
    versionNumber: r.version_number,
    statementText: r.statement_text,
    wizardData: r.wizard_data,
    createdAt: r.created_at,
    isCurrent: r.is_current,
  };
}

// GET /api/mission/current
router.get('/current', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, version_number, statement_text, wizard_data, created_at, is_current FROM mission_statements WHERE user_id=$1 AND is_current=true',
      [req.user.id]
    );
    res.json(rows[0] ? formatRow(rows[0]) : null);
  } catch (err) {
    console.error('[mission current]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mission/history
router.get('/history', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, version_number, statement_text, created_at, is_current FROM mission_statements WHERE user_id=$1 ORDER BY version_number DESC',
      [req.user.id]
    );
    res.json(rows.map(formatRow));
  } catch (err) {
    console.error('[mission history]', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/mission/reminder-status — must be before /:id
router.get('/reminder-status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT key, value FROM settings WHERE \"userId\"=$1 AND key IN ('mission_review_frequency','mission_last_reviewed_at','mission_review_snoozed_until')",
      [req.user.id]
    );
    const s = {};
    rows.forEach(r => { s[r.key] = r.value; });

    const frequency = s.mission_review_frequency || 'off';
    if (frequency === 'off') return res.json({ shouldShow: false });

    const snoozedUntil = s.mission_review_snoozed_until;
    if (snoozedUntil && new Date(snoozedUntil) > new Date()) {
      return res.json({ shouldShow: false });
    }

    const intervalDays = { weekly: 7, monthly: 30, quarterly: 90 }[frequency];
    if (!intervalDays) return res.json({ shouldShow: false });

    const lastReviewed = s.mission_last_reviewed_at;
    let baseDate;
    if (lastReviewed) {
      baseDate = new Date(lastReviewed);
    } else {
      const { rows: mRows } = await pool.query(
        'SELECT created_at FROM mission_statements WHERE user_id=$1 AND is_current=true',
        [req.user.id]
      );
      if (!mRows[0]) return res.json({ shouldShow: false });
      baseDate = new Date(mRows[0].created_at);
    }

    const nextReview = new Date(baseDate.getTime() + intervalDays * 24 * 60 * 60 * 1000);
    if (new Date() >= nextReview) {
      return res.json({ shouldShow: true, dueDate: nextReview.toISOString(), lastReviewedAt: lastReviewed || null });
    }
    res.json({ shouldShow: false });
  } catch (err) {
    console.error('[mission reminder-status]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mission/reminder/snooze — must be before /:id
router.post('/reminder/snooze', async (req, res) => {
  try {
    const snoozedUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(
      "INSERT INTO settings (\"userId\", key, value) VALUES ($1, 'mission_review_snoozed_until', $2) ON CONFLICT (\"userId\", key) DO UPDATE SET value=EXCLUDED.value",
      [req.user.id, snoozedUntil]
    );
    res.json({ ok: true, snoozedUntil });
  } catch (err) {
    console.error('[mission reminder/snooze]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mission/reminder/reviewed — must be before /:id
router.post('/reminder/reviewed', async (req, res) => {
  try {
    const now = new Date().toISOString();
    await pool.query(
      "INSERT INTO settings (\"userId\", key, value) VALUES ($1, 'mission_last_reviewed_at', $2) ON CONFLICT (\"userId\", key) DO UPDATE SET value=EXCLUDED.value",
      [req.user.id, now]
    );
    await pool.query(
      "DELETE FROM settings WHERE \"userId\"=$1 AND key='mission_review_snoozed_until'",
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('[mission reminder/reviewed]', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/mission — create new version
router.post('/', async (req, res) => {
  const { statementText, wizardData } = req.body;
  if (!statementText?.trim()) return res.status(400).json({ error: 'statementText required' });
  try {
    // Compute next version number atomically inside the INSERT to avoid any race condition
    const { rows } = await pool.query(
      `INSERT INTO mission_statements (user_id, version_number, statement_text, wizard_data, is_current)
       VALUES (
         $1,
         (SELECT COALESCE(MAX(version_number), 0) + 1 FROM mission_statements WHERE user_id = $1),
         $2, $3, true
       )
       RETURNING id, version_number, statement_text, wizard_data, created_at, is_current`,
      [req.user.id, statementText.trim(), wizardData ? JSON.stringify(wizardData) : null]
    );
    await syncToSettings(req.user.id, statementText.trim());
    res.json(formatRow(rows[0]));
  } catch (err) {
    console.error('[mission POST]', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/mission/:id — direct edit of current mission, no new version
router.put('/:id', async (req, res) => {
  const { statementText, wizardData } = req.body;
  if (!statementText?.trim()) return res.status(400).json({ error: 'statementText required' });
  try {
    const { rows } = await pool.query(
      `UPDATE mission_statements
       SET statement_text=$1,
           wizard_data=CASE WHEN $2::text IS NULL THEN wizard_data ELSE $2::jsonb END
       WHERE id=$3 AND user_id=$4 AND is_current=true
       RETURNING id, version_number, statement_text, wizard_data, created_at, is_current`,
      [statementText.trim(), wizardData ? JSON.stringify(wizardData) : null, req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Mission not found or not current' });
    await syncToSettings(req.user.id, statementText.trim());
    res.json(formatRow(rows[0]));
  } catch (err) {
    console.error('[mission PUT]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
