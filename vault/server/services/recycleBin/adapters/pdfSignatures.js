'use strict';

// How the recycle bin puts back a deleted entry from PDF Tools → Signed PDFs: the signing record and its kept copy.
// DELETE /api/pdf/signatures/:signingId (server/routes/pdf.js) calls moveToBin(). The copy stays on disk and in `attachments`
// while it waits; nobody can open it then, because the attachment's owner check goes through the (deleted) pdf_signatures row.

const fs = require('fs');
const { register } = require('../index');
const { insertRow } = require('../rowRestore');

register('pdf-signature', {
  label: 'Signed PDF',
  async restore(db, userId, payload) {
    const s = payload?.signature;
    if (!s) throw new Error('This deleted signed PDF has nothing to restore.');
    const id = await insertRow(db, 'pdf_signatures', s, { userId });
    const fileIds = Array.isArray(payload.attachmentIds) ? payload.attachmentIds.filter(Number.isInteger) : [];
    if (fileIds.length) {
      await db.query(`UPDATE attachments SET "entityId"=$1 WHERE id = ANY($2::int[]) AND "userId"=$3 AND "entityType"='pdf_signature'`, [id, fileIds, userId]);
    }
    return { entityId: id };
  },
  // Gone for good (30 days, deleted forever, bin emptied): remove the kept copy too.
  async discard(db, userId, payload) {
    const fileIds = Array.isArray(payload?.attachmentIds) ? payload.attachmentIds.filter(Number.isInteger) : [];
    if (!fileIds.length) return;
    const { rows } = await db.query(`SELECT id, "storedPath" FROM attachments WHERE id = ANY($1::int[]) AND "userId"=$2 AND "entityType"='pdf_signature'`, [fileIds, userId]);
    for (const a of rows) {
      try { if (fs.existsSync(a.storedPath)) fs.unlinkSync(a.storedPath); } catch { /* the row goes anyway */ }
    }
    await db.query(`DELETE FROM attachments WHERE id = ANY($1::int[]) AND "userId"=$2 AND "entityType"='pdf_signature'`, [rows.map((r) => r.id), userId]);
  },
});
