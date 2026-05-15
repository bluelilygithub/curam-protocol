'use strict';

const { pool } = require('../db');

async function requireAuth(req, res, next) {
  // Skip auth for health check and auth routes
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();

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
      'SELECT id, email, "isAdmin" FROM users WHERE id=$1', [session.userId]
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'User not found' });

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!req.user.isAdmin) return res.status(403).json({ error: 'Admin access required' });
  return next();
}

module.exports = { requireAuth, requireAdmin };
