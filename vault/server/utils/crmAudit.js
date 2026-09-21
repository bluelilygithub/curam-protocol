'use strict';

const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');

// Records a CRM write (contact/deal/touchpoint/client create-update-delete)
// to crm_audit_log so "it disappeared" can be answered from the DB instead
// of guessed at. Fail-soft by design — a logging error must never block the
// actual CRM operation, so this never throws; it logs and swallows.
async function logCrmAudit({ userId, clientId, entityType, entityId, action, before = null, after = null }) {
  try {
    await pool.query(
      `INSERT INTO crm_audit_log ("userId", "clientId", "entityType", "entityId", action, before, after)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [userId, clientId, entityType, entityId, action, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]
    );
  } catch (err) {
    getLogger().error({ err, entityType, entityId, action }, 'crm_audit_log write failed');
  }
}

module.exports = { logCrmAudit };
