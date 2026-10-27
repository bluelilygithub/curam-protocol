'use strict';

const { pool } = require('../db');
const { FEATURE_ACCESS_KEYS, flagsFromSettingRows, applyUserOverrides, accountantFlags } = require('../config/featureAccess');
const { attachUserToLogContext } = require('./requestContext');
const { applyAccountantScope } = require('../services/accountantAccess');

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
      'SELECT id, email, "isAdmin", "accountantOfUserId", "accessExpiresAt", "disabledAt", "featureOverrides" FROM users WHERE id=$1', [session.userId]
    );
    const user = users[0];
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.disabledAt && !user.accountantOfUserId) return res.status(401).json({ error: 'Account disabled' });

    // Throttled "last active" stamp (at most once per 5 min per user); never blocks the request
    pool.query(
      `UPDATE users SET "lastActiveAt"=NOW()
       WHERE id=$1 AND ("lastActiveAt" IS NULL OR "lastActiveAt" < NOW() - INTERVAL '5 minutes')`,
      [user.id]
    ).catch(() => {});

    // Accountant logins are read-only, Finance-only and logged; everyone else gets req.user as before.
    if (!(await applyAccountantScope(req, res, user, token))) return;
    attachUserToLogContext(user.id);
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

async function loadFeatureAccess(userId) {
  const { rows } = await pool.query(
    "SELECT key, value FROM workspace_settings WHERE key LIKE 'feature_%'"
  );
  const workspaceFlags = flagsFromSettingRows(rows);
  if (!userId) return workspaceFlags;

  const { rows: userRows } = await pool.query(
    'SELECT "featureOverrides", "accountantOfUserId" FROM users WHERE id=$1', [userId]
  );
  if (userRows[0]?.accountantOfUserId) return accountantFlags(userRows[0].featureOverrides);
  return applyUserOverrides(workspaceFlags, userRows[0]?.featureOverrides);
}

function requireFeature(featureKey) {
  return async function featureGuard(req, res, next) {
    try {
      if (!FEATURE_ACCESS_KEYS.includes(featureKey)) return next();
      if (req.user?.isAdmin) return next();
      // An accountant's req.user.id is the owner's (so Finance reads the owner's data); flags are the accountant's own.
      const access = await loadFeatureAccess(req.featureUserId ?? req.user?.id);
      if (access[featureKey] === false) {
        return res.status(403).json({ error: 'Feature disabled for member accounts' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Passes when ANY of the given features is on for the caller (a shared service used by several tools, e.g. place lookup). */
function requireAnyFeature(...featureKeys) {
  return async function anyFeatureGuard(req, res, next) {
    try {
      if (req.user?.isAdmin) return next();
      const access = await loadFeatureAccess(req.user?.id);
      if (featureKeys.every((k) => FEATURE_ACCESS_KEYS.includes(k) && access[k] === false)) {
        return res.status(403).json({ error: 'Feature disabled for member accounts' });
      }
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireAuth, requireAdmin, requireFeature, requireAnyFeature, loadFeatureAccess };
