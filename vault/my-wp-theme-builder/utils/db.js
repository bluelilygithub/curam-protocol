const { Pool } = require('pg');

let pool;

function sslConfig(connectionString) {
  try {
    const u = new URL(connectionString);
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
    return local ? false : { rejectUnauthorized: false };
  } catch {
    return false;
  }
}

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: sslConfig(process.env.DATABASE_URL),
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}

function isEnabled() {
  return Boolean(process.env.DATABASE_URL);
}

async function initDb() {
  const p = getPool();
  if (!p) return;

  await p.query(`
    CREATE TABLE IF NOT EXISTS theme_builder_sessions (
      session_id TEXT PRIMARY KEY,
      meta JSONB NOT NULL DEFAULT '{}',
      intake_data JSONB,
      wp_data JSONB,
      index_html TEXT,
      style_css TEXT,
      approved_html TEXT,
      approved_css TEXT,
      stage2_analysis JSONB,
      field_suggestions JSONB,
      theme_slug TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS theme_builder_artifacts (
      session_id TEXT NOT NULL REFERENCES theme_builder_sessions(session_id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (session_id, path)
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS theme_builder_theme_files (
      session_id TEXT NOT NULL REFERENCES theme_builder_sessions(session_id) ON DELETE CASCADE,
      file_path TEXT NOT NULL,
      content_base64 TEXT NOT NULL,
      PRIMARY KEY (session_id, file_path)
    )
  `);

  await p.query(`
    CREATE TABLE IF NOT EXISTS theme_builder_theme_zips (
      session_id TEXT PRIMARY KEY REFERENCES theme_builder_sessions(session_id) ON DELETE CASCADE,
      zip_base64 TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function touchSession(sessionId) {
  await getPool().query(
    'UPDATE theme_builder_sessions SET updated_at = NOW() WHERE session_id = $1',
    [sessionId]
  );
}

async function ensureSession(sessionId, meta = {}) {
  const p = getPool();
  await p.query(
    `INSERT INTO theme_builder_sessions (session_id, meta)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId, JSON.stringify(meta)]
  );
}

async function sessionExists(sessionId) {
  const { rows } = await getPool().query(
    'SELECT 1 FROM theme_builder_sessions WHERE session_id = $1',
    [sessionId]
  );
  return rows.length > 0;
}

async function getSessionRow(sessionId) {
  const { rows } = await getPool().query(
    'SELECT * FROM theme_builder_sessions WHERE session_id = $1',
    [sessionId]
  );
  return rows[0] || null;
}

function parseJsonContent(content) {
  try {
    return JSON.parse(content);
  } catch {
    return content;
  }
}

async function writeSessionPath(sessionId, relativePath, content) {
  const text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
  await ensureSession(sessionId);

  switch (relativePath) {
    case 'meta.json':
      await getPool().query(
        `UPDATE theme_builder_sessions SET meta = $2::jsonb, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'intake.json':
      await getPool().query(
        `UPDATE theme_builder_sessions SET intake_data = $2::jsonb, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'wpData.json':
      await getPool().query(
        `UPDATE theme_builder_sessions SET wp_data = $2::jsonb, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'index.html':
      await getPool().query(
        `UPDATE theme_builder_sessions SET index_html = $2, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'style.css':
      await getPool().query(
        `UPDATE theme_builder_sessions SET style_css = $2, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'stage1/approved/index.html':
      await getPool().query(
        `UPDATE theme_builder_sessions SET approved_html = $2, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'stage1/approved/style.css':
      await getPool().query(
        `UPDATE theme_builder_sessions SET approved_css = $2, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'stage2/analysis.json':
      await getPool().query(
        `UPDATE theme_builder_sessions SET stage2_analysis = $2::jsonb, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    case 'stage2/field-suggestions.json':
      await getPool().query(
        `UPDATE theme_builder_sessions SET field_suggestions = $2::jsonb, updated_at = NOW() WHERE session_id = $1`,
        [sessionId, text]
      );
      return;
    default:
      break;
  }

  if (relativePath.startsWith('theme/')) {
    await saveThemeFile(sessionId, relativePath, text);
    return;
  }

  await getPool().query(
    `INSERT INTO theme_builder_artifacts (session_id, path, content)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, path) DO UPDATE SET content = EXCLUDED.content`,
    [sessionId, relativePath, text]
  );
  await touchSession(sessionId);
}

async function readSessionPath(sessionId, relativePath) {
  const row = await getSessionRow(sessionId);
  if (!row) return null;

  switch (relativePath) {
    case 'meta.json':
      return row.meta ? JSON.stringify(row.meta, null, 2) : null;
    case 'intake.json':
      return row.intake_data ? JSON.stringify(row.intake_data, null, 2) : null;
    case 'wpData.json':
      return row.wp_data ? JSON.stringify(row.wp_data, null, 2) : null;
    case 'index.html':
      return row.index_html;
    case 'style.css':
      return row.style_css;
    case 'stage1/approved/index.html':
      return row.approved_html;
    case 'stage1/approved/style.css':
      return row.approved_css;
    case 'stage2/analysis.json':
      return row.stage2_analysis ? JSON.stringify(row.stage2_analysis, null, 2) : null;
    case 'stage2/field-suggestions.json':
      return row.field_suggestions ? JSON.stringify(row.field_suggestions, null, 2) : null;
    default:
      break;
  }

  if (relativePath.startsWith('theme/')) {
    return getThemeFile(sessionId, relativePath);
  }

  const { rows } = await getPool().query(
    'SELECT content FROM theme_builder_artifacts WHERE session_id = $1 AND path = $2',
    [sessionId, relativePath]
  );
  return rows[0]?.content ?? null;
}

async function pathExists(sessionId, relativePath) {
  if (!(await sessionExists(sessionId))) return false;

  if (relativePath === 'meta.json') return true;

  const content = await readSessionPath(sessionId, relativePath);
  return content != null && content !== '';
}

async function saveHtml(sessionId, html, css) {
  await ensureSession(sessionId);
  await getPool().query(
    `UPDATE theme_builder_sessions
     SET index_html = $2, style_css = $3, updated_at = NOW()
     WHERE session_id = $1`,
    [sessionId, html, css || null]
  );
}

async function getHtml(sessionId) {
  const row = await getSessionRow(sessionId);
  if (!row) return { html: null, css: null };
  return { html: row.index_html, css: row.style_css };
}

async function saveApprovedHtml(sessionId, html, css) {
  await ensureSession(sessionId);
  await getPool().query(
    `UPDATE theme_builder_sessions
     SET approved_html = $2, approved_css = $3, updated_at = NOW()
     WHERE session_id = $1`,
    [sessionId, html, css || null]
  );
}

async function getApprovedHtml(sessionId) {
  const row = await getSessionRow(sessionId);
  if (!row) return { html: null, css: null };
  return { html: row.approved_html, css: row.approved_css };
}

async function saveThemeFile(sessionId, filePath, content) {
  await ensureSession(sessionId);
  const base64 = Buffer.from(content, 'utf8').toString('base64');
  await getPool().query(
    `INSERT INTO theme_builder_theme_files (session_id, file_path, content_base64)
     VALUES ($1, $2, $3)
     ON CONFLICT (session_id, file_path) DO UPDATE SET content_base64 = EXCLUDED.content_base64`,
    [sessionId, filePath, base64]
  );
  await touchSession(sessionId);
}

async function getThemeFile(sessionId, filePath) {
  const { rows } = await getPool().query(
    'SELECT content_base64 FROM theme_builder_theme_files WHERE session_id = $1 AND file_path = $2',
    [sessionId, filePath]
  );
  if (!rows[0]) return null;
  return Buffer.from(rows[0].content_base64, 'base64').toString('utf8');
}

async function listThemeFiles(sessionId, prefix = 'theme/') {
  const { rows } = await getPool().query(
    `SELECT file_path FROM theme_builder_theme_files
     WHERE session_id = $1 AND file_path LIKE $2
     ORDER BY file_path`,
    [sessionId, `${prefix}%`]
  );
  return rows.map((r) => r.file_path);
}

async function setThemeSlug(sessionId, themeSlug) {
  await getPool().query(
    'UPDATE theme_builder_sessions SET theme_slug = $2, updated_at = NOW() WHERE session_id = $1',
    [sessionId, themeSlug]
  );
}

async function saveThemeZip(sessionId, zipBuffer) {
  await ensureSession(sessionId);
  const zipBase64 = zipBuffer.toString('base64');
  await getPool().query(
    `INSERT INTO theme_builder_theme_zips (session_id, zip_base64, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (session_id) DO UPDATE SET zip_base64 = EXCLUDED.zip_base64, updated_at = NOW()`,
    [sessionId, zipBase64]
  );
}

async function getThemeZip(sessionId) {
  const { rows } = await getPool().query(
    'SELECT zip_base64 FROM theme_builder_theme_zips WHERE session_id = $1',
    [sessionId]
  );
  if (!rows[0]) return null;
  return Buffer.from(rows[0].zip_base64, 'base64');
}

async function themeZipExists(sessionId) {
  const { rows } = await getPool().query(
    'SELECT 1 FROM theme_builder_theme_zips WHERE session_id = $1',
    [sessionId]
  );
  return rows.length > 0;
}

async function deleteSession(sessionId) {
  await getPool().query('DELETE FROM theme_builder_sessions WHERE session_id = $1', [sessionId]);
}

module.exports = {
  isEnabled,
  getPool,
  initDb,
  ensureSession,
  sessionExists,
  getSessionRow,
  writeSessionPath,
  readSessionPath,
  pathExists,
  saveHtml,
  getHtml,
  saveApprovedHtml,
  getApprovedHtml,
  saveThemeFile,
  getThemeFile,
  listThemeFiles,
  setThemeSlug,
  saveThemeZip,
  getThemeZip,
  themeZipExists,
  deleteSession,
  parseJsonContent,
};
