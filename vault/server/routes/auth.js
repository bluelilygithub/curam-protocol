'use strict';

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');

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
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (!inviteCode || inviteCode !== process.env.INVITE_CODE) {
    return res.status(403).json({ error: 'Invalid invite code' });
  }

  try {
    const { rows: existing } = await pool.query(
      'SELECT id FROM users WHERE email=$1', [email.toLowerCase()]
    );
    if (existing[0]) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const { rows: newUser } = await pool.query(
      'INSERT INTO users (email, "passwordHash") VALUES ($1, $2) RETURNING id, email, "isAdmin"',
      [email.toLowerCase(), passwordHash]
    );
    const userRow = newUser[0];
    const userId = userRow.id;
    const token = makeToken();
    await pool.query(
      'INSERT INTO auth_sessions (token, "userId", "expiresAt") VALUES ($1, $2, $3)',
      [token, userId, makeExpiry()]
    );
    res.status(201).json({ token, user: { id: userId, email: userRow.email, isAdmin: !!userRow.isAdmin } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });

  try {
    const { rows: users } = await pool.query(
      'SELECT * FROM users WHERE email=$1', [email.toLowerCase()]
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Invalid email or password' });

    const token = makeToken();
    await pool.query(
      'INSERT INTO auth_sessions (token, "userId", "expiresAt") VALUES ($1, $2, $3)',
      [token, user.id, makeExpiry()]
    );
    res.json({ token, user: { id: user.id, email: user.email, isAdmin: !!user.isAdmin } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/logout
router.post('/logout', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  try {
    if (token) await pool.query('DELETE FROM auth_sessions WHERE token=$1', [token]);
  } catch (_) {}
  res.json({ ok: true });
});

// POST /api/auth/reset-password-request
router.post('/reset-password-request', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'email required' });

  try {
    const { rows: users } = await pool.query(
      'SELECT id FROM users WHERE email=$1', [email.toLowerCase()]
    );
    // Always return ok to avoid email enumeration
    if (!users[0]) return res.json({ ok: true });

    const token = makeToken();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

    await pool.query('DELETE FROM password_resets WHERE email=$1', [email.toLowerCase()]);
    await pool.query(
      'INSERT INTO password_resets (token, email, "expiresAt") VALUES ($1, $2, $3)',
      [token, email.toLowerCase(), expiresAt]
    );

    const requestBaseUrl = req.get('host') ? `${req.protocol}://${req.get('host')}` : '';
    const appUrl = (process.env.APP_URL || requestBaseUrl || 'http://localhost:5173').replace(/\/$/, '');
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
  } catch (err) {
    console.error('Reset password request error:', err.message);
  }

  res.json({ ok: true });
});

// POST /api/auth/reset-password-confirm
router.post('/reset-password-confirm', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'token and password required' });

  try {
    const { rows: resets } = await pool.query(
      'SELECT * FROM password_resets WHERE token=$1', [token]
    );
    const reset = resets[0];
    if (!reset || new Date(reset.expiresAt) < new Date()) {
      if (reset) await pool.query('DELETE FROM password_resets WHERE token=$1', [token]);
      return res.status(400).json({ error: 'Invalid or expired reset link' });
    }

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query('UPDATE users SET "passwordHash"=$1 WHERE email=$2', [hash, reset.email]);
    await pool.query('DELETE FROM password_resets WHERE token=$1', [token]);
    const { rows: users } = await pool.query('SELECT id FROM users WHERE email=$1', [reset.email]);
    if (users[0]) await pool.query('DELETE FROM auth_sessions WHERE "userId"=$1', [users[0].id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  try {
    const { rows: sessions } = await pool.query(
      'SELECT * FROM auth_sessions WHERE token=$1', [token]
    );
    const session = sessions[0];
    if (!session || new Date(session.expiresAt) < new Date()) {
      if (session) await pool.query('DELETE FROM auth_sessions WHERE token=$1', [token]);
      return res.status(401).json({ error: 'Session expired' });
    }

    const { rows: users } = await pool.query(
      'SELECT id, email, "createdAt", "isAdmin" FROM users WHERE id=$1', [session.userId]
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    res.json({ user });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
