const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const db = require('../db');

const SALT_ROUNDS = 12;
const SESSION_HOURS = 24;

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many login attempts, please try again later.' },
});

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
router.post('/login', loginLimiter, async (req, res) => {
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

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(token);
  res.json({ ok: true });
});

// POST /api/auth/reset-password-request
router.post('/reset-password-request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  const user = db.prepare('SELECT id FROM users WHERE email=?').get(email.toLowerCase());
  // Always return ok to avoid email enumeration
  if (!user) return res.json({ ok: true });

  const token = makeToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare('DELETE FROM password_resets WHERE email=?').run(email.toLowerCase());
  db.prepare('INSERT INTO password_resets (token, email, expiresAt) VALUES (?, ?, ?)').run(token, email.toLowerCase(), expiresAt);

  const appUrl = (process.env.APP_URL || 'http://localhost:5173').replace(/\/$/, '');
  const resetLink = `${appUrl}/reset-password?token=${token}`;
  const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f0;padding:20px;">
<div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;">
<h2 style="margin-top:0;">Reset your password</h2>
<p>Click the link below to reset your Project Vault password. This link expires in 1 hour.</p>
<a href="${resetLink}" style="display:inline-block;background:#CC785C;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;">Reset Password</a>
<p style="margin-top:24px;font-size:12px;color:#888;">If you didn't request this, you can ignore this email.</p>
</div></body></html>`;

  try {
    const sendEmail = require('../utils/sendEmail');
    await sendEmail({ to: email.toLowerCase(), subject: 'Reset your Project Vault password', html });
  } catch (err) {
    console.error('Reset email error:', err.message);
  }

  res.json({ ok: true });
});

// POST /api/auth/reset-password-confirm
router.post('/reset-password-confirm', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password required' });

  const reset = db.prepare('SELECT * FROM password_resets WHERE token=?').get(token);
  if (!reset || new Date(reset.expiresAt) < new Date()) {
    if (reset) db.prepare('DELETE FROM password_resets WHERE token=?').run(token);
    return res.status(400).json({ error: 'Invalid or expired reset link' });
  }

  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    db.prepare('UPDATE users SET passwordHash=? WHERE email=?').run(hash, reset.email);
    db.prepare('DELETE FROM password_resets WHERE token=?').run(token);
    const user = db.prepare('SELECT id FROM users WHERE email=?').get(reset.email);
    if (user) db.prepare('DELETE FROM auth_sessions WHERE userId=?').run(user.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
