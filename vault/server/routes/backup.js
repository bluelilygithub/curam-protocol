'use strict';

/**
 * Google Drive backup of the caller's OWN workspace data.
 *
 * Every route here is admin-only (router.use(requireAdmin) below), and a backup contains only the
 * calling user's rows and upload folders, never another user's. Restore is switched off: putting
 * rows back into a database shared by several people needs per-user id remapping, and the old
 * version deleted every user's data in these tables before inserting. See POST /restore.
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { pool } = require('../db');
const { decrypt, encrypt } = require('../utils/encryption');
const { requireAdmin } = require('../middleware/auth');

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const BACKUP_ROOT_NAME = 'Curam Vault Backups';
const MAX_BACKUPS = 4;
const APP_VERSION = '1.0';
const WEEK_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ENV_VARS = [
  'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'GOOGLE_REDIRECT_URI', 'ENCRYPTION_KEY', 'SEARCH_API_KEY', 'SERPER_SEARCH_API_KEY', 'DATABASE_URL',
  'APP_URL', 'UPLOAD_DIR', 'MAIL_CHANNEL_API_KEY',
];

// What a backup contains, and how each table is limited to the caller's own rows ($1 = the caller's
// user id). Tables with no user column are reached through the project, chat, task or template they
// belong to. A table that cannot be tied to its owner is left out rather than guessed at.
const OWN_PROJECTS = '(SELECT id FROM projects WHERE "userId" = $1)';
const OWN_SESSIONS = `(SELECT "sessionId" FROM sessions WHERE "userId" = $1 OR "projectId" IN ${OWN_PROJECTS})`;
const OWN_TASKS = '(SELECT id FROM tasks WHERE "userId" = $1 OR "parentTaskId" IN (SELECT id FROM tasks WHERE "userId" = $1))';
const OWN_TEMPLATES = '(SELECT id FROM task_templates WHERE "userId" = $1)';
const OWN_OBJECTIVES = '(SELECT id FROM objectives WHERE "userId" = $1)';

const BACKUP_TABLES = [
  ['folders', '"userId" = $1'],
  ['personas', '"userId" = $1'],
  ['projects', '"userId" = $1'],
  ['memory', '"userId" = $1'],
  ['task_templates', '"userId" = $1'],
  ['objectives', '"userId" = $1'],
  ['key_results', `"objectiveId" IN ${OWN_OBJECTIVES}`],
  ['sessions', `("userId" = $1 OR "projectId" IN ${OWN_PROJECTS})`],
  ['messages', `("projectId" IN ${OWN_PROJECTS} OR "sessionId" IN ${OWN_SESSIONS})`],
  ['tasks', `("userId" = $1 OR "parentTaskId" IN (SELECT id FROM tasks WHERE "userId" = $1))`],
  ['task_tags', `"taskId" IN ${OWN_TASKS}`],
  ['task_comments', `"taskId" IN ${OWN_TASKS}`],
  ['task_dependencies', `"taskId" IN ${OWN_TASKS}`],
  ['template_subtasks', `"templateId" IN ${OWN_TEMPLATES}`],
  ['prompts', '"userId" = $1'],
  ['notes', 'user_id = $1'],
  ['pinned_urls', `"projectId" IN ${OWN_PROJECTS}`],
  ['files', `"projectId" IN ${OWN_PROJECTS}`],
  ['session_files', `"sessionId" IN ${OWN_SESSIONS}`],
  ['bookmarks', `"sessionId" IN ${OWN_SESSIONS}`],
  ['prompt_chains', '"userId" = $1'],
  ['debates', `"projectId" IN ${OWN_PROJECTS}`],
  ['comparisons', `"projectId" IN ${OWN_PROJECTS}`],
  ['search_index', `"projectId" IN (SELECT id::text FROM projects WHERE "userId" = $1)`],
];

// ── Helpers ────────────────────────────────────────────────────────────────────

function getOAuth2Client() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function getDriveClient(userId) {
  const { rows } = await pool.query('SELECT * FROM gmail_tokens WHERE "userId"=$1', [userId]);
  if (!rows[0]) {
    throw new Error('Google account not connected. Connect Google in Settings → Integrations.');
  }
  const row = rows[0];
  if (!row.scope || !row.scope.includes('drive')) {
    throw new Error('Google Drive access not granted. Reconnect Google in Settings → Integrations to enable Drive backup.');
  }
  const oauth2Client = getOAuth2Client();
  oauth2Client.setCredentials({
    access_token: decrypt(row.accessToken),
    refresh_token: decrypt(row.refreshToken),
    token_type: row.tokenType || 'Bearer',
    expiry_date: row.expiryDate ? Number(row.expiryDate) : undefined,
    scope: row.scope || undefined,
  });
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      pool.query(
        `UPDATE gmail_tokens SET "accessToken"=$1, "expiryDate"=$2, "updatedAt"=NOW() WHERE "userId"=$3`,
        [encrypt(tokens.access_token), tokens.expiry_date || null, userId]
      ).catch(err => console.error('[backup] token refresh error:', err));
    }
  });
  return google.drive({ version: 'v3', auth: oauth2Client });
}

function sse(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sseHeaders(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
}

// Find the Curam Vault Backups root folder (app-created, so visible with drive.file scope)
async function getOrCreateRootFolder(drive) {
  const q = `name='${BACKUP_ROOT_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const list = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
  if (list.data.files.length > 0) return list.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name: BACKUP_ROOT_NAME, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  });
  return created.data.id;
}

async function createDriveFolder(drive, name, parentId) {
  const created = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  return created.data.id;
}

async function uploadJson(drive, name, obj, parentId) {
  const body = JSON.stringify(obj, null, 2);
  const readable = new Readable();
  readable.push(body);
  readable.push(null);
  const res = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType: 'application/json', body: readable },
    fields: 'id',
  });
  return res.data.id;
}

async function uploadFileStream(drive, name, filePath, parentId) {
  const res = await drive.files.create({
    requestBody: { name, parents: [parentId] },
    media: { mimeType: 'application/octet-stream', body: fs.createReadStream(filePath) },
    fields: 'id',
  });
  return res.data.id;
}

async function downloadToBuffer(drive, fileId) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.data.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    res.data.on('end', () => resolve(Buffer.concat(chunks)));
    res.data.on('error', reject);
  });
}

// Recursively walk a directory, returning [{relativePath, absolutePath}] for every file
function walkDir(dir, base) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir)) {
    const abs = path.join(dir, entry);
    const rel = base ? path.join(base, entry) : entry;
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        results.push(...walkDir(abs, rel));
      } else if (stat.isFile()) {
        results.push({ relativePath: rel, absolutePath: abs });
      }
    } catch {}
  }
  return results;
}

// The caller's rows, table by table. Tables that cannot be read come back empty.
async function exportOwnedData(userId) {
  const tables = {};
  for (const [table, where] of BACKUP_TABLES) {
    try {
      const { rows } = await pool.query(`SELECT * FROM "${table}" WHERE ${where}`, [userId]);
      tables[table] = rows;
    } catch (_) {
      tables[table] = [];
    }
  }
  return tables;
}

// The caller's uploaded files: one folder per project they own, plus their own Finance documents.
// Nothing else under the upload folder (other people's projects and documents) is ever read.
async function listOwnedUploads(userId, uploadDir = UPLOAD_DIR) {
  const { rows } = await pool.query('SELECT id FROM projects WHERE "userId" = $1', [userId]);
  const results = [];
  for (const { id } of rows) {
    results.push(...walkDir(path.join(uploadDir, String(id)), String(id)));
  }
  const financeBase = path.join('finance-docs', String(userId));
  results.push(...walkDir(path.join(uploadDir, financeBase), financeBase));
  return results;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// Every backup route is for administrators only.
router.use(requireAdmin);

// GET /api/backup/status
router.get('/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT scope FROM gmail_tokens WHERE "userId"=$1', [req.user.id]
    );
    const driveConnected = !!(rows[0]?.scope && rows[0].scope.includes('drive'));

    const { rows: s } = await pool.query(
      `SELECT value FROM settings WHERE "userId"=$1 AND key='last_backup_at'`, [req.user.id]
    );
    const lastBackupAt = s[0]?.value || null;

    // Try to get the root folder ID for the Drive link
    let driveFolderUrl = null;
    if (driveConnected) {
      try {
        const drive = await getDriveClient(req.user.id);
        const q = `name='${BACKUP_ROOT_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
        const list = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
        if (list.data.files.length > 0) {
          driveFolderUrl = `https://drive.google.com/drive/folders/${list.data.files[0].id}`;
        }
      } catch (_) {}
    }

    res.json({ driveConnected, lastBackupAt, driveFolderUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backup/list
router.get('/list', async (req, res) => {
  try {
    const drive = await getDriveClient(req.user.id);
    const rootFolderId = await getOrCreateRootFolder(drive);

    const { data: { files: folders } } = await drive.files.list({
      q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name, createdTime)',
      orderBy: 'createdTime desc',
      pageSize: 20,
    });

    const results = await Promise.all((folders || []).slice(0, 10).map(async (folder) => {
      try {
        const { data: { files: manifestFiles } } = await drive.files.list({
          q: `name='manifest.json' and '${folder.id}' in parents and trashed=false`,
          fields: 'files(id)',
          pageSize: 1,
        });
        let manifest = {};
        if (manifestFiles && manifestFiles.length) {
          const buf = await downloadToBuffer(drive, manifestFiles[0].id);
          manifest = JSON.parse(buf.toString('utf8'));
        }
        return {
          folderId: folder.id,
          name: folder.name,
          date: folder.createdTime,
          fileCount: manifest.fileCount || 0,
          recordCounts: manifest.recordCounts || {},
        };
      } catch {
        return {
          folderId: folder.id,
          name: folder.name,
          date: folder.createdTime,
          fileCount: 0,
          recordCounts: {},
        };
      }
    }));

    res.json({ backups: results, rootFolderId });
  } catch (err) {
    console.error('[backup] List error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/backup/variables
router.get('/variables', (req, res) => {
  const result = {};
  for (const name of ENV_VARS) {
    result[name] = !!process.env[name];
  }
  res.json(result);
});

// POST /api/backup/create — SSE
router.post('/create', async (req, res) => {
  sseHeaders(res);
  try {
    const drive = await getDriveClient(req.user.id);

    // ── Stage 1: Export the caller's data ─────────────────────────────────────
    sse(res, { stage: 'database', message: 'Exporting your data…', percent: 5 });

    const tables = await exportOwnedData(req.user.id);

    const now = new Date();
    const dbExport = {
      version: APP_VERSION,
      created_at: now.toISOString(),
      userId: req.user.id,
      tables,
    };

    sse(res, { stage: 'database', message: 'Data exported successfully', percent: 20 });

    // ── Stage 2: Scan the caller's uploaded files ─────────────────────────────
    sse(res, { stage: 'files', message: 'Scanning uploaded files…', percent: 22 });

    const uploadedFiles = await listOwnedUploads(req.user.id);
    console.log(`[backup] user ${req.user.id}: UPLOAD_DIR=${UPLOAD_DIR} | files found=${uploadedFiles.length}`);

    // ── Stage 3: Create Drive folder structure ────────────────────────────────
    sse(res, { stage: 'files', message: 'Creating Drive folder…', percent: 25 });

    const rootFolderId = await getOrCreateRootFolder(drive);
    const folderName = `${now.toISOString().slice(0, 10)}_${WEEK_DAYS[now.getDay()]}`;
    const backupFolderId = await createDriveFolder(drive, folderName, rootFolderId);
    const filesFolderId = await createDriveFolder(drive, 'files', backupFolderId);

    // ── Stage 4: Upload data.json ─────────────────────────────────────────────
    sse(res, { stage: 'files', message: 'Uploading database backup…', percent: 30 });
    await uploadJson(drive, 'data.json', dbExport, backupFolderId);

    // ── Stage 5: Upload each file ─────────────────────────────────────────────
    const totalFiles = uploadedFiles.length;
    const driveFolderCache = new Map(); // key: "parentId:name" → Drive folder id
    const getDriveSubfolder = async (name, parentId) => {
      const key = `${parentId}:${name}`;
      if (driveFolderCache.has(key)) return driveFolderCache.get(key);
      const id = await createDriveFolder(drive, name, parentId);
      driveFolderCache.set(key, id);
      return id;
    };

    for (let i = 0; i < uploadedFiles.length; i++) {
      const { relativePath, absolutePath } = uploadedFiles[i];
      const parts = relativePath.split(path.sep);
      const fileName = parts.pop();
      const percent = 30 + Math.round(((i + 1) / Math.max(totalFiles, 1)) * 50);
      sse(res, {
        stage: 'files',
        message: `Uploading file ${i + 1} of ${totalFiles}: ${relativePath}`,
        percent,
      });
      try {
        let parentId = filesFolderId;
        for (const part of parts) {
          parentId = await getDriveSubfolder(part, parentId);
        }
        await uploadFileStream(drive, fileName, absolutePath, parentId);
      } catch (fileErr) {
        console.error(`[backup] Failed to upload file ${relativePath}:`, fileErr.message);
        // Non-fatal — continue with remaining files
      }
    }

    // ── Stage 6: Upload manifest ──────────────────────────────────────────────
    sse(res, { stage: 'files', message: 'Writing manifest…', percent: 82 });
    const manifest = {
      version: APP_VERSION,
      created_at: now.toISOString(),
      fileCount: totalFiles,
      recordCounts: Object.fromEntries(
        Object.entries(tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0])
      ),
    };
    await uploadJson(drive, 'manifest.json', manifest, backupFolderId);

    // ── Stage 7: Cleanup old backups ──────────────────────────────────────────
    sse(res, { stage: 'cleanup', message: 'Removing old backups…', percent: 88 });
    try {
      const { data: { files: allFolders } } = await drive.files.list({
        q: `'${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, createdTime)',
        orderBy: 'createdTime desc',
        pageSize: 100,
      });
      if (allFolders && allFolders.length > MAX_BACKUPS) {
        for (const old of allFolders.slice(MAX_BACKUPS)) {
          await drive.files.delete({ fileId: old.id }).catch(() => {});
        }
      }
    } catch (cleanupErr) {
      console.error('[backup] Cleanup error:', cleanupErr.message);
    }

    // ── Stage 8: Save timestamp (settings are per user: the key is (userId, key)) ──
    await pool.query(
      `INSERT INTO settings ("userId", key, value) VALUES ($1, 'last_backup_at', $2)
       ON CONFLICT ("userId", key) DO UPDATE SET value = EXCLUDED.value`,
      [req.user.id, now.toISOString()]
    );

    sse(res, { stage: 'complete', message: 'Backup complete — saved to Google Drive', percent: 100 });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[backup] Create error:', err);
    sse(res, { stage: 'error', message: err.message });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

// POST /api/backup/restore — DISABLED.
// The previous version emptied these tables for every user and refilled them from a Drive file, and
// wrote files into the upload folder using names taken from Drive. With several people sharing one
// database that is not safe. Restoring one person's backup needs its own design (new ids, no deleting
// anyone else's rows, path checks). Until then a restore is done from a database backup instead.
router.post('/restore', (req, res) => {
  res.status(410).json({
    error: 'Restore from Drive is switched off for safety. Your Drive backups are untouched; ask for a restore from a database backup.',
  });
});

module.exports = router;
module.exports.helpers = { exportOwnedData, listOwnedUploads, BACKUP_TABLES };
