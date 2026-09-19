'use strict';

// Shared attachment policy — used by touchpoints (server/routes/clients.js)
// and tasks (server/routes/tasks.js). Extracted once a second entity type
// needed the same upload/list/cleanup logic (docs/crm-deals-schema.md §10/§11).

const multer = require('multer');
const path   = require('path');
const fs     = require('fs');
const { pool } = require('../db');

const ATTACHMENT_MIMES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'application/json', 'text/csv', 'text/markdown',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
];
const ATTACHMENT_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.txt', '.json', '.csv', '.md', '.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt',
];

const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50MB, matches server/routes/files.js
const PER_USER_QUOTA_BYTES = (Number(process.env.ATTACHMENT_QUOTA_MB) || 500) * 1024 * 1024;

// Multer instance for a given subdirectory under UPLOAD_DIR/attachments/.
// `keyParam` names the req.params key used to namespace the folder
// (e.g. 'id' for a client/touchpoint route, 'id' for a task route too —
// caller picks the folder name via `folder(req)`).
function createAttachmentUpload(folder) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
      const dir = path.join(uploadDir, 'attachments', folder(req));
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${unique}-${safe}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_BYTES },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const nameLower = file.originalname.toLowerCase();
      if (ext === '.env' || nameLower === '.env' || nameLower.endsWith('/.env')) {
        return cb(new Error('File type not accepted'));
      }
      if (ATTACHMENT_MIMES.includes(file.mimetype) || ATTACHMENT_EXTENSIONS.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error('File type not accepted'));
      }
    },
  });
}

// Magic-byte sniff for disguised executables — the realistic control
// available here (no ClamAV/network scanning service on Railway). This is
// NOT virus scanning: it catches an executable renamed with an allowed
// extension (e.g. evil.exe -> evil.pdf), not malicious content inside a
// genuinely valid PDF/DOCX/image. Named honestly in docs for that reason.
const EXECUTABLE_SIGNATURES = [
  Buffer.from([0x4d, 0x5a]),             // MZ — Windows PE (.exe/.dll)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF — Linux binary
  Buffer.from('#!'),                      // shebang script
];

async function rejectIfDisguisedExecutable(filePath) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(4);
  fs.readSync(fd, buf, 0, 4, 0);
  fs.closeSync(fd);
  const isExecutable = EXECUTABLE_SIGNATURES.some(sig => buf.slice(0, sig.length).equals(sig));
  if (isExecutable) {
    fs.unlinkSync(filePath);
    const err = new Error('File content does not match an accepted type');
    err.statusCode = 400;
    throw err;
  }
}

async function assertWithinQuota(userId, incomingBytes) {
  const { rows: [{ total }] } = await pool.query(
    `SELECT COALESCE(SUM("sizeBytes"), 0) AS total FROM attachments WHERE "userId"=$1`,
    [userId]
  );
  if (Number(total) + incomingBytes > PER_USER_QUOTA_BYTES) {
    const err = new Error(`Attachment storage limit reached (${PER_USER_QUOTA_BYTES / (1024 * 1024)}MB per user)`);
    err.statusCode = 413;
    throw err;
  }
}

async function insertAttachment({ userId, entityType, entityId, file }) {
  const { rows: [attachment] } = await pool.query(`
    INSERT INTO attachments ("userId","entityType","entityId",filename,"storedPath","mimeType","sizeBytes")
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id, "entityType", "entityId", filename, "mimeType", "sizeBytes", "createdAt"
  `, [userId, entityType, entityId, file.originalname, file.path, file.mimetype, file.size]);
  return attachment;
}

// One bulk query for all given entity ids' attachments, grouped in JS.
async function attachmentsForEntities(entityType, entityIds) {
  if (!entityIds.length) return new Map();
  const { rows } = await pool.query(
    `SELECT id, "entityId", filename, "mimeType", "sizeBytes", "createdAt"
     FROM attachments WHERE "entityType"=$1 AND "entityId" = ANY($2::int[])
     ORDER BY "createdAt" ASC`,
    [entityType, entityIds]
  );
  const byEntity = new Map();
  for (const a of rows) {
    if (!byEntity.has(a.entityId)) byEntity.set(a.entityId, []);
    byEntity.get(a.entityId).push(a);
  }
  return byEntity;
}

// Single-entity convenience (matches tasks.js's existing per-row buildTask
// convention rather than the bulk-map style clients.js uses — see comments
// at each call site for why the two files differ here).
async function attachmentsForEntity(entityType, entityId) {
  const map = await attachmentsForEntities(entityType, [entityId]);
  return map.get(entityId) || [];
}

async function deleteAttachmentsForEntityIds(entityType, entityIds) {
  if (!entityIds.length) return;
  const { rows } = await pool.query(
    `SELECT id, "storedPath" FROM attachments WHERE "entityType"=$1 AND "entityId" = ANY($2::int[])`,
    [entityType, entityIds]
  );
  for (const a of rows) {
    try { if (fs.existsSync(a.storedPath)) fs.unlinkSync(a.storedPath); }
    catch (e) { console.warn('[attachments] unlink failed:', e.message); }
  }
  await pool.query(
    `DELETE FROM attachments WHERE "entityType"=$1 AND "entityId" = ANY($2::int[])`,
    [entityType, entityIds]
  );
}

module.exports = {
  ATTACHMENT_MIMES,
  ATTACHMENT_EXTENSIONS,
  MAX_FILE_BYTES,
  PER_USER_QUOTA_BYTES,
  createAttachmentUpload,
  rejectIfDisguisedExecutable,
  assertWithinQuota,
  insertAttachment,
  attachmentsForEntities,
  attachmentsForEntity,
  deleteAttachmentsForEntityIds,
};
