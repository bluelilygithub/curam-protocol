'use strict';

const express = require('express');
const router = express.Router();
const { pool } = require('../db');

async function getTags(taskId) {
  const { rows } = await pool.query('SELECT tag FROM task_tags WHERE "taskId"=$1', [taskId]);
  return rows.map(r => r.tag);
}

// GET /api/shared/task/:token — public, no auth required
router.get('/task/:token', async (req, res) => {
  try {
    const { rows: tasks } = await pool.query(
      'SELECT * FROM tasks WHERE "shareToken"=$1', [req.params.token]
    );
    const task = tasks[0];
    if (!task) return res.status(404).json({ error: 'Task not found or no longer shared' });

    const { rows: subtasks } = await pool.query(
      'SELECT * FROM tasks WHERE "parentTaskId"=$1 ORDER BY "createdAt" ASC', [task.id]
    );

    res.json({
      id: task.id,
      title: task.title,
      notes: task.notes,
      priority: task.priority,
      status: task.status,
      dueDate: task.dueDate,
      category: task.category,
      estimatedMinutes: task.estimatedMinutes,
      timeSpentMinutes: task.timeSpentMinutes,
      tags: await getTags(task.id),
      subtasks: subtasks.map(s => ({
        id: s.id,
        title: s.title,
        status: s.status,
        priority: s.priority,
      })),
    });
  } catch (err) {
    console.error('[shared task GET]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
