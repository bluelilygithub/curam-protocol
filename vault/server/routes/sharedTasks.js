const express = require('express');
const router = express.Router();
const db = require('../db');

function getTags(taskId) {
  return db.prepare('SELECT tag FROM task_tags WHERE taskId=?').all(taskId).map(r => r.tag);
}

// GET /api/shared/task/:token — public, no auth required
router.get('/task/:token', (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE shareToken=?').get(req.params.token);
    if (!task) return res.status(404).json({ error: 'Task not found or no longer shared' });
    const subtasks = db.prepare('SELECT * FROM tasks WHERE parentTaskId=? ORDER BY createdAt ASC').all(task.id);
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
      tags: getTags(task.id),
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
