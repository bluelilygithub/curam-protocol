const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../db');

const SALT_ROUNDS = 12;
const SESSION_HOURS = 24;

function makeToken() {
  return crypto.randomBytes(32).toString('hex');
}

function makeExpiry() {
  const d = new Date();
  d.setHours(d.getHours() + SESSION_HOURS);
  return d.toISOString();
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { email, password, inviteCode } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (!inviteCode || inviteCode !== process.env.INVITE_CODE) {
    return res.status(403).json({ error: 'Invalid invite code' });
  }
  const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const result = db.prepare('INSERT INTO users (email, passwordHash) VALUES (?, ?)').run(email.toLowerCase(), passwordHash);
    const token = makeToken();
    db.prepare('INSERT INTO auth_sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(token, result.lastInsertRowid, makeExpiry());
    res.status(201).json({ token, user: { id: result.lastInsertRowid, email: email.toLowerCase() } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  const user = db.prepare('SELECT * FROM users WHERE email=?').get(email.toLowerCase());
  if (!user) return res.status(401).json({ error: 'Invalid email or password' });

  try {
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    const token = makeToken();
    db.prepare('INSERT INTO auth_sessions (token, userId, expiresAt) VALUES (?, ?, ?)').run(token, user.id, makeExpiry());
    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/change-password
router.post('/change-password', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = db.prepare('SELECT * FROM auth_sessions WHERE token=?').get(token);
  if (!session || new Date(session.expiresAt) < new Date()) {
    return res.status(401).json({ error: 'Session expired' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both fields required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(session.userId);
  const match = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!match) return res.status(401).json({ error: 'Current password is incorrect' });

  const newHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  db.prepare('UPDATE users SET passwordHash=? WHERE id=?').run(newHash, user.id);
  res.json({ ok: true });
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(token);
  res.json({ ok: true });
});

// GET /api/auth/me
router.get('/me', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = db.prepare('SELECT * FROM auth_sessions WHERE token=?').get(token);
  if (!session || new Date(session.expiresAt) < new Date()) {
    if (session) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(token);
    return res.status(401).json({ error: 'Session expired' });
  }

  const user = db.prepare('SELECT id, email, createdAt FROM users WHERE id=?').get(session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
});

module.exports = router;
