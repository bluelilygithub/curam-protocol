const fs = require('fs');
const path = require('path');
const db = require('./db');

const OUTPUT_ROOT = process.env.THEME_BUILDER_OUTPUT_DIR
  || path.join(__dirname, '..', '..', 'data', 'theme-builder-sessions');

function useDatabase() {
  return db.isEnabled();
}

function sessionDir(sessionId) {
  return path.join(OUTPUT_ROOT, sessionId);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

async function writeFileFs(sessionId, relativePath, content) {
  const fullPath = path.join(sessionDir(sessionId), relativePath);
  ensureDir(path.dirname(fullPath));
  fs.writeFileSync(fullPath, content, 'utf8');
  return fullPath;
}

function readFileFs(sessionId, relativePath) {
  const fullPath = path.join(sessionDir(sessionId), relativePath);
  return fs.readFileSync(fullPath, 'utf8');
}

function fileExistsFs(sessionId, relativePath) {
  return fs.existsSync(path.join(sessionDir(sessionId), relativePath));
}

function listFilesFs(sessionId, dir = '.') {
  const base = path.join(sessionDir(sessionId), dir);
  if (!fs.existsSync(base)) return [];

  const results = [];

  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      const rel = path.relative(sessionDir(sessionId), full);
      if (entry.isDirectory()) {
        walk(full);
      } else {
        results.push(rel);
      }
    }
  }

  walk(base);
  return results;
}

async function writeFile(sessionId, relativePath, content) {
  if (useDatabase()) {
    await db.writeSessionPath(sessionId, relativePath, content);
    return relativePath;
  }
  return writeFileFs(sessionId, relativePath, content);
}

async function readFile(sessionId, relativePath) {
  if (useDatabase()) {
    const content = await db.readSessionPath(sessionId, relativePath);
    if (content == null) {
      const err = new Error(`File not found: ${relativePath}`);
      err.code = 'ENOENT';
      throw err;
    }
    return content;
  }
  return readFileFs(sessionId, relativePath);
}

async function tryReadFile(sessionId, relativePath) {
  try {
    return await readFile(sessionId, relativePath);
  } catch {
    return null;
  }
}

async function fileExists(sessionId, relativePath) {
  if (relativePath === 'theme.zip') {
    if (useDatabase()) return db.themeZipExists(sessionId);
    return fs.existsSync(path.join(sessionDir(sessionId), 'theme.zip'));
  }

  if (useDatabase()) {
    return db.pathExists(sessionId, relativePath);
  }
  return fileExistsFs(sessionId, relativePath);
}

async function listFiles(sessionId, dir = '.') {
  if (useDatabase()) {
    const prefix = dir === '.' ? 'theme/' : dir;
    if (prefix.startsWith('theme')) {
      return db.listThemeFiles(sessionId, prefix.endsWith('/') ? prefix : `${prefix}/`);
    }
    return [];
  }
  return listFilesFs(sessionId, dir);
}

async function saveThemeZip(sessionId, zipBuffer) {
  if (useDatabase()) {
    await db.saveThemeZip(sessionId, zipBuffer);
    return;
  }
  fs.writeFileSync(path.join(sessionDir(sessionId), 'theme.zip'), zipBuffer);
}

async function readThemeZip(sessionId) {
  if (useDatabase()) {
    return db.getThemeZip(sessionId);
  }
  const zipPath = path.join(sessionDir(sessionId), 'theme.zip');
  if (!fs.existsSync(zipPath)) return null;
  return fs.readFileSync(zipPath);
}

async function deleteSession(sessionId) {
  if (useDatabase()) {
    await db.deleteSession(sessionId);
  }
  const dir = sessionDir(sessionId);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = {
  OUTPUT_ROOT,
  sessionDir,
  ensureDir,
  useDatabase,
  writeFile,
  readFile,
  tryReadFile,
  fileExists,
  listFiles,
  saveThemeZip,
  readThemeZip,
  deleteSession,
};
