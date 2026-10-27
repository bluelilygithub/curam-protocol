'use strict';

// Accountant login: a normal user row with "accountantOfUserId" set. It can only READ the owner's
// Finance (GET /api/finance/*), and Shares when the owner has opted that accountant in;
// everything it does is written to accountant_access_log.
// Flow: requireAuth calls applyAccountantScope() right after loading the user.

const { pool } = require('../db');

// Paths (relative to /api) an accountant may GET besides Finance. These run as the accountant's OWN
// user (not remapped), so they only ever see the accountant's own, empty settings.
const OWN_GET_PATHS = ['/settings', '/user', '/auth'];

const EXPORT_RE = /export|pdf|csv|xlsx|zip|pack|download|statement|\/file/i;

function isFinancePath(p) {
  return p === '/finance' || p.startsWith('/finance/');
}

// Shares (the owner's private trading account) is opt-in per accountant: the owner ticks it in
// Admin -> Accountant access, which stores featureOverrides.shares = true (off = false, the default).
// Read-only, and the Questions history (/shares/ask) stays private.
function isSharesPath(p) {
  return (p === '/shares' || p.startsWith('/shares/')) && p !== '/shares/ask' && !p.startsWith('/shares/ask/');
}

function hasSharesAccess(user) {
  return user.featureOverrides?.shares === true;
}

// The Finance guide chat (POST, answers from a fixed catalogue, sees no books and writes nothing). It runs as the accountant's OWN user,
// never the owner's, so it can't reach any data; its AI cost is logged against the accountant.
function isGuidePost(p, method) {
  return method === 'POST' && p === '/finance-tutor';
}

function isOwnGetPath(p) {
  return OWN_GET_PATHS.some((x) => p === x || p.startsWith(`${x}/`));
}

function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim().slice(0, 64);
}

async function logAccess(req, actor, kind, status) {
  try {
    await pool.query(
      `INSERT INTO accountant_access_log ("actorId","ownerId","actorEmail",kind,method,path,query,status,ip,"userAgent")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        actor.id,
        actor.accountantOfUserId,
        actor.email,
        kind,
        req.method,
        String(req.originalUrl || req.path).split('?')[0].slice(0, 300),
        String(req.originalUrl || '').split('?')[1]?.slice(0, 500) || null,
        status ?? null,
        clientIp(req),
        String(req.headers['user-agent'] || '').slice(0, 300),
      ]
    );
  } catch (_) { /* logging must never break the request */ }
}

function accessEnded(user) {
  if (user.disabledAt) return true;
  if (user.accessExpiresAt && new Date(user.accessExpiresAt) < new Date()) return true;
  return false;
}

/**
 * Returns true if the request may continue (req.user is set), false if a response was already sent.
 * Non-accountants pass through untouched.
 */
async function applyAccountantScope(req, res, user, token) {
  if (!user.accountantOfUserId) {
    req.user = { id: user.id, email: user.email, isAdmin: user.isAdmin };
    return true;
  }

  if (accessEnded(user)) {
    await pool.query('DELETE FROM auth_sessions WHERE token=$1', [token]).catch(() => {});
    res.status(401).json({ error: 'Access has ended. Ask the account owner.' });
    return false;
  }

  const actor = { id: user.id, email: user.email, accountantOfUserId: user.accountantOfUserId };
  const p = req.path; // relative to /api
  const readOnly = req.method === 'GET' || req.method === 'HEAD';

  const sharesOk = isSharesPath(p) && hasSharesAccess(user);
  if (isGuidePost(p, req.method)) {
    req.user = { id: user.id, email: user.email, isAdmin: false, isAccountant: true, actorId: user.id };
    return true;
  }

  if (!readOnly || !(isFinancePath(p) || sharesOk || isOwnGetPath(p))) {
    // /auth/* never reaches here (skipped earlier); logout is a POST handled there too.
    await logAccess(req, actor, 'denied', 403);
    res.status(403).json({ error: 'Accountant access is read-only and limited to the sections the account owner has shared.' });
    return false;
  }

  if (isFinancePath(p) || sharesOk) {
    // Finance and Shares code read req.user.id everywhere: point it at the owner's data. Never admin.
    req.user = {
      id: user.accountantOfUserId,
      email: user.email,
      isAdmin: false,
      isAccountant: true,
      actorId: user.id,
    };
    // The feature guard looks the flag up by id, so it must see the ACCOUNTANT's own flags.
    req.featureUserId = user.id;
    res.on('finish', () => {
      logAccess(req, actor, EXPORT_RE.test(p) ? 'export' : 'view', res.statusCode);
    });
  } else {
    req.user = { id: user.id, email: user.email, isAdmin: false, isAccountant: true, actorId: user.id };
  }
  return true;
}

async function logLogin(req, user) {
  if (!user.accountantOfUserId) return;
  await logAccess(req, { id: user.id, email: user.email, accountantOfUserId: user.accountantOfUserId }, 'login', 200);
}

// Owner's email, so the accountant's welcome box can offer "Email the owner".
async function ownerEmailOf(user) {
  if (!user.accountantOfUserId) return undefined;
  const { rows } = await pool.query('SELECT email FROM users WHERE id=$1', [user.accountantOfUserId]);
  return rows[0]?.email;
}

module.exports = { isSharesPath, hasSharesAccess, applyAccountantScope, logLogin, accessEnded, logAccess, ownerEmailOf };
