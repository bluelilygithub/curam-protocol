'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { Readable } = require('stream');
const { google } = require('googleapis');
const { pool } = require('../db');
const { decrypt, encrypt } = require('../utils/encryption');

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

// Tables exported in backup (backup order = insert order for restore)
const TABLES_TO_BACKUP = [
  'folders', 'personas', 'projects', 'memory', 'task_templates',
  'objectives', 'key_results', 'sessions', 'messages', 'tasks',
  'task_tags', 'task_comments', 'task_dependencies', 'template_subtasks',
  'prompts', 'notes', 'pinned_urls', 'files', 'session_files',
  'bookmarks', 'prompt_chains', 'debates', 'comparisons', 'search_index',
];

// Cleared in reverse dependency order before restore
const CLEAR_ORDER = [
  'file_chunks', 'search_index', 'comparisons', 'debates', 'prompt_chains',
  'bookmarks', 'session_files', 'files', 'pinned_urls', 'notes', 'prompts',
  'template_subtasks', 'task_dependencies', 'task_comments', 'task_tags', 'tasks',
  'messages', 'sessions', 'key_results', 'objectives', 'task_templates',
  'memory', 'projects', 'personas', 'folders',
];

// Tables that have a serial id column needing sequence reset after restore
const TABLES_WITH_SERIAL_ID = [
  'folders', 'personas', 'projects', 'memory', 'task_templates', 'objectives',
  'key_results', 'messages', 'tasks', 'task_tags', 'task_comments',
  'task_dependencies', 'template_subtasks', 'prompts', 'notes', 'pinned_urls',
  'files', 'bookmarks', 'prompt_chains', 'debates', 'comparisons', 'search_index',
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

async function downloadToFile(drive, fileId, destPath) {
  const res = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );
  await new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(destPath);
    res.data.pipe(dest);
    dest.on('finish', resolve);
    dest.on('error', reject);
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

// Recursively list all non-folder files in a Drive folder, returning [{id, name, relativePath}]
async function listDriveFilesRecursive(drive, folderId, base) {
  const results = [];
  const { data: { files } } = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id, name, mimeType)',
    pageSize: 1000,
  });
  for (const f of (files || [])) {
    const rel = base ? path.join(base, f.name) : f.name;
    if (f.mimeType === 'application/vnd.google-apps.folder') {
      results.push(...await listDriveFilesRecursive(drive, f.id, rel));
    } else {
      results.push({ id: f.id, name: f.name, relativePath: rel });
    }
  }
  return results;
}

// Topological sort so parent tasks are inserted before child tasks
function topologicalSortTasks(tasks) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const result = [];
  const visited = new Set();

  function dfs(task) {
    if (visited.has(task.id)) return;
    if (task.parentTaskId && byId.has(task.parentTaskId)) {
      dfs(byId.get(task.parentTaskId));
    }
    visited.add(task.id);
    result.push(task);
  }

  for (const task of tasks) dfs(task);
  return result;
}

// Batch insert rows — columns derived from first row's keys
async function bulkInsert(client, table, rows) {
  if (!rows || !rows.length) return;
  const columns = Object.keys(rows[0]);
  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    let paramIdx = 1;
    const valuePlaceholders = [];
    const params = [];
    for (const row of batch) {
      const placeholders = columns.map(() => `$${paramIdx++}`);
      valuePlaceholders.push(`(${placeholders.join(', ')})`);
      for (const col of columns) {
        params.push(row[col] !== undefined ? row[col] : null);
      }
    }
    const colNames = columns.map(c => `"${c}"`).join(', ');
    await client.query(
      `INSERT INTO "${table}" (${colNames}) VALUES ${valuePlaceholders.join(', ')}`,
      params
    );
  }
}

// ── Routes ─────────────────────────────────────────────────────────────────────

// GET /api/backup/status
router.get('/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT scope FROM gmail_tokens WHERE "userId"=$1', [req.user.id]
    );
    const driveConnected = !!(rows[0]?.scope && rows[0].scope.includes('drive'));

    const { rows: s } = await pool.query(
      "SELECT value FROM settings WHERE key='last_backup_at'"
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

    // ── Stage 1: Export database ──────────────────────────────────────────────
    sse(res, { stage: 'database', message: 'Exporting database…', percent: 5 });

    const tables = {};
    for (const table of TABLES_TO_BACKUP) {
      try {
        const { rows } = await pool.query(`SELECT * FROM "${table}"`);
        tables[table] = rows;
      } catch (_) {
        tables[table] = [];
      }
    }

    const now = new Date();
    const dbExport = {
      version: APP_VERSION,
      created_at: now.toISOString(),
      tables,
    };

    sse(res, { stage: 'database', message: 'Database exported successfully', percent: 20 });

    // ── Stage 2: Scan uploaded files ──────────────────────────────────────────
    sse(res, { stage: 'files', message: 'Scanning uploaded files…', percent: 22 });

    const uploadedFiles = walkDir(UPLOAD_DIR);
    console.log(`[backup] UPLOAD_DIR=${UPLOAD_DIR} | exists=${fs.existsSync(UPLOAD_DIR)} | files found=${uploadedFiles.length}`);

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

    // ── Stage 8: Save timestamp ───────────────────────────────────────────────
    await pool.query(
      `INSERT INTO settings (key, value) VALUES ('last_backup_at', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [now.toISOString()]
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

// POST /api/backup/restore — SSE
router.post('/restore', async (req, res) => {
  sseHeaders(res);
  const { folderId } = req.body || {};
  if (!folderId) {
    sse(res, { stage: 'error', message: 'folderId is required' });
    res.write('data: [DONE]\n\n');
    return res.end();
  }

  try {
    const drive = await getDriveClient(req.user.id);

    // ── Download data.json ────────────────────────────────────────────────────
    sse(res, { stage: 'database', message: 'Downloading backup data…', percent: 5 });

    const { data: { files: dataFiles } } = await drive.files.list({
      q: `name='data.json' and '${folderId}' in parents and trashed=false`,
      fields: 'files(id)',
      pageSize: 1,
    });
    if (!dataFiles || !dataFiles.length) {
      throw new Error('data.json not found in this backup folder. The backup may be corrupted.');
    }
    const buf = await downloadToBuffer(drive, dataFiles[0].id);
    const dbExport = JSON.parse(buf.toString('utf8'));
    const tables = dbExport.tables || {};

    sse(res, { stage: 'database', message: 'Restoring database…', percent: 15 });

    // ── Restore DB in a transaction ───────────────────────────────────────────
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Clear tables in reverse dependency order
      // Tasks self-reference: nullify parentTaskId first to avoid FK violations
      await client.query('UPDATE tasks SET "parentTaskId" = NULL WHERE "parentTaskId" IS NOT NULL').catch(() => {});
      for (const table of CLEAR_ORDER) {
        await client.query(`DELETE FROM "${table}"`).catch(() => {});
      }

      // Insert in dependency order
      const tasksDone = new Set(['tasks']); // handle tasks specially below
      for (const table of TABLES_TO_BACKUP) {
        if (table === 'tasks') continue; // handle below
        const rows = tables[table];
        if (!rows || !rows.length) continue;
        await bulkInsert(client, table, rows);
      }

      // Tasks: topological sort so parents come before children
      const taskRows = tables['tasks'] || [];
      if (taskRows.length) {
        const sorted = topologicalSortTasks(taskRows);
        await bulkInsert(client, 'tasks', sorted);
      }

      // Reset serial sequences so future inserts get correct IDs
      for (const table of TABLES_WITH_SERIAL_ID) {
        if (tables[table] && tables[table].length) {
          await client.query(
            `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE(MAX(id), 1)) FROM "${table}"`
          ).catch(() => {});
        }
      }

      await client.query('COMMIT');
      sse(res, { stage: 'database', message: 'Database restored successfully', percent: 60 });
    } catch (dbErr) {
      await client.query('ROLLBACK');
      throw new Error(`Database restore failed: ${dbErr.message}`);
    } finally {
      client.release();
    }

    // ── Restore files ─────────────────────────────────────────────────────────
    sse(res, { stage: 'files', message: 'Restoring uploaded files…', percent: 65 });

    try {
      // Find the files/ subfolder
      const { data: { files: subfolders } } = await drive.files.list({
        q: `name='files' and '${folderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id)',
        pageSize: 1,
      });

      if (subfolders && subfolders.length) {
        const filesFolderId = subfolders[0].id;
        const driveFiles = await listDriveFilesRecursive(drive, filesFolderId);

        if (!fs.existsSync(UPLOAD_DIR)) {
          fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }

        const total = driveFiles.length;
        for (let i = 0; i < driveFiles.length; i++) {
          const driveFile = driveFiles[i];
          const destPath = path.join(UPLOAD_DIR, driveFile.relativePath);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });
          const percent = 65 + Math.round(((i + 1) / Math.max(total, 1)) * 30);
          sse(res, {
            stage: 'files',
            message: `Restoring file ${i + 1} of ${total}…`,
            percent,
          });
          await downloadToFile(drive, driveFile.id, destPath);
        }
      }
    } catch (fileErr) {
      console.error('[backup] File restore error:', fileErr.message);
      // Non-fatal — DB is already restored
    }

    sse(res, { stage: 'complete', message: 'Restore complete — reloading app…', percent: 100 });
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[backup] Restore error:', err);
    sse(res, { stage: 'error', message: err.message });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

module.exports = router;
