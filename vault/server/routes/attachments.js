'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const { pool } = require('../db');

// Generic, cross-entity attachment routes (download + delete). Upload stays
// per-entity (server/routes/clients.js for touchpoints, server/routes/tasks.js
// for tasks) since the destination folder and creation-time validation differ
// per entity — but once a row exists, downloading/deleting it doesn't need
// to know which entity it came from, just how to check ownership for that
// entityType. See docs/crm-deals-schema.md §10/§11.

// Ownership check: attachments."userId" is uploader-for-display only (see
// server/utils/attachments.js), never the auth gate — real ownership is
// via the entity's own owning chain, same as the entity's own routes.
async function loadOwnedAttachment(attachmentId, userId) {
  const { rows: [attachment] } = await pool.query(
    `SELECT * FROM attachments WHERE id=$1`, [attachmentId]
  );
  if (!attachment) return null;

  if (attachment.entityType === 'touchpoint') {
    const { rows: [ok] } = await pool.query(
      `SELECT 1 FROM client_touchpoints tp
       JOIN clients c ON c.id = tp."clientId"
       WHERE tp.id=$1 AND c."userId"=$2`,
      [attachment.entityId, userId]
    );
    return ok ? attachment : null;
  }

  if (attachment.entityType === 'task') {
    const { rows: [ok] } = await pool.query(
      `SELECT 1 FROM tasks WHERE id=$1 AND "userId"=$2`,
      [attachment.entityId, userId]
    );
    return ok ? attachment : null;
  }

  return null; // unknown entityType — fail closed
}

// GET /api/attachments/:id/download
router.get('/:id/download', async (req, res) => {
  try {
    const attachment = await loadOwnedAttachment(parseInt(req.params.id, 10), req.user.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });
    if (!fs.existsSync(attachment.storedPath)) return res.status(404).json({ error: 'File missing on disk' });

    res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${attachment.filename.replace(/"/g, '')}"`);
    fs.createReadStream(attachment.storedPath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/attachments/:id
router.delete('/:id', async (req, res) => {
  try {
    const attachment = await loadOwnedAttachment(parseInt(req.params.id, 10), req.user.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found' });

    try { if (fs.existsSync(attachment.storedPath)) fs.unlinkSync(attachment.storedPath); }
    catch (e) { console.warn('[attachments] unlink failed:', e.message); }

    await pool.query('DELETE FROM attachments WHERE id=$1', [attachment.id]);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
