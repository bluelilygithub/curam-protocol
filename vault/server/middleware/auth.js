const db = require('../db');

function requireAuth(req, res, next) {
  // Skip auth for health check and auth routes
  if (req.path === '/health' || req.path.startsWith('/auth/')) return next();

  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const session = db.prepare('SELECT * FROM auth_sessions WHERE token=?').get(token);
  if (!session || new Date(session.expiresAt) < new Date()) {
    if (session) db.prepare('DELETE FROM auth_sessions WHERE token=?').run(token);
    return res.status(401).json({ error: 'Session expired' });
  }

  const user = db.prepare('SELECT id, email FROM users WHERE id=?').get(session.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });

  req.user = user;
  next();
}

module.exports = { requireAuth };
