const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../db');

const SALT_ROUNDS = 12;

// POST /api/user/change-password — protected by requireAuth middleware in index.js
router.post('/change-password', async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(newHash, user.id);
  res.json({ ok: true });
});

module.exports = router;
