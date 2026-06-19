'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const {
  SUGGESTION_CATEGORIES,
  SUGGESTION_STATUSES,
  isValidCategory,
  isValidStatus,
} = require('../constants/suggestionInbox');
const SuggestionService = require('../services/SuggestionService');

// GET /api/suggestions/meta — categories, statuses, counts by status/category
router.get('/meta', async (req, res) => {
  const userId = req.user.id;
  try {
    const { rows: statusRows } = await pool.query(
      `SELECT status, COUNT(*)::int AS count
       FROM agent_suggestions
       WHERE "userId" = $1
       GROUP BY status`,
      [userId],
    );
    const { rows: categoryRows } = await pool.query(
      `SELECT category, COUNT(*)::int AS count
       FROM agent_suggestions
       WHERE "userId" = $1
       GROUP BY category`,
      [userId],
    );
    const statusCounts = Object.fromEntries(SUGGESTION_STATUSES.map((s) => [s, 0]));
    for (const row of statusRows) statusCounts[row.status] = row.count;
    const categoryCounts = Object.fromEntries(SUGGESTION_CATEGORIES.map((c) => [c, 0]));
    for (const row of categoryRows) categoryCounts[row.category] = row.count;

    res.json({
      categories: SUGGESTION_CATEGORIES,
      statuses: SUGGESTION_STATUSES,
      statusCounts,
      categoryCounts,
      total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suggestions/count?status=new
router.get('/count', async (req, res) => {
  const userId = req.user.id;
  const { status } = req.query;
  try {
    let sql = 'SELECT COUNT(*)::int AS count FROM agent_suggestions WHERE "userId" = $1';
    const params = [userId];
    if (status) {
      if (!isValidStatus(status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }
      sql += ' AND status = $2';
      params.push(status);
    }
    const { rows } = await pool.query(sql, params);
    res.json({ count: rows[0]?.count ?? 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suggestions?category=rule&status=new
router.get('/', async (req, res) => {
  const userId = req.user.id;
  const { category, status, q } = req.query;

  let sql = `
    SELECT id, category, status, title, body, context, source, "createdAt", "updatedAt"
    FROM agent_suggestions
    WHERE "userId" = $1
  `;
  const params = [userId];
  let idx = 2;

  if (category) {
    if (!isValidCategory(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    sql += ` AND category = $${idx++}`;
    params.push(category);
  }
  if (status) {
    if (!isValidStatus(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    sql += ` AND status = $${idx++}`;
    params.push(status);
  }
  if (q) {
    const term = `%${q}%`;
    sql += ` AND (title ILIKE $${idx} OR body ILIKE $${idx + 1} OR COALESCE(context, '') ILIKE $${idx + 2})`;
    idx += 3;
    params.push(term, term, term);
  }

  sql += ' ORDER BY "createdAt" DESC';

  try {
    const { rows } = await pool.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/suggestions/:id
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, category, status, title, body, context, source, "createdAt", "updatedAt"
       FROM agent_suggestions
       WHERE id = $1 AND "userId" = $2`,
      [req.params.id, req.user.id],
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/suggestions
router.post('/', async (req, res) => {
  const userId = req.user.id;
  const { category = 'other', title, body = '', context = null } = req.body ?? {};

  if (!isValidCategory(category)) {
    return res.status(400).json({ error: 'Invalid category' });
  }
  if (!title || !String(title).trim()) {
    return res.status(400).json({ error: 'title is required' });
  }

  try {
    const result = await SuggestionService.capture({
      userId,
      category,
      title,
      body,
      context,
      source: req.body?.source ?? 'manual',
    });
    if (result.error) return res.status(400).json({ error: result.error });
    if (result.skipped) return res.status(200).json({ skipped: true, reason: result.reason });
    const row = result.suggestion;
    res.status(result.created ? 201 : 200).json(row);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/suggestions/:id
router.patch('/:id', async (req, res) => {
  const userId = req.user.id;
  const { category, status, title, body, context } = req.body ?? {};

  const updates = [];
  const params = [req.params.id, userId];
  let idx = 3;

  if (category !== undefined) {
    if (!isValidCategory(category)) {
      return res.status(400).json({ error: 'Invalid category' });
    }
    updates.push(`category = $${idx++}`);
    params.push(category);
  }
  if (status !== undefined) {
    if (!isValidStatus(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }
    updates.push(`status = $${idx++}`);
    params.push(status);
  }
  if (title !== undefined) {
    if (!String(title).trim()) {
      return res.status(400).json({ error: 'title cannot be empty' });
    }
    updates.push(`title = $${idx++}`);
    params.push(String(title).trim());
  }
  if (body !== undefined) {
    updates.push(`body = $${idx++}`);
    params.push(String(body));
  }
  if (context !== undefined) {
    updates.push(`context = $${idx++}`);
    params.push(context ? String(context) : null);
  }

  if (!updates.length) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push('"updatedAt" = NOW()');

  try {
    const { rows } = await pool.query(
      `UPDATE agent_suggestions
       SET ${updates.join(', ')}
       WHERE id = $1 AND "userId" = $2
       RETURNING id, category, status, title, body, context, "createdAt", "updatedAt"`,
      params,
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/suggestions/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      'DELETE FROM agent_suggestions WHERE id = $1 AND "userId" = $2',
      [req.params.id, req.user.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
