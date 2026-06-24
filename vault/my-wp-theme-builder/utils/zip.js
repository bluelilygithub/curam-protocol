const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('./db');
const { sessionDir, readThemeZip, saveThemeZip, tryReadFile, fileExists, listFiles } = require('./filewriter');

function resolveThemeDir(sessionId, themeSlug) {
  const base = sessionDir(sessionId);
  const themeNested = path.join(base, 'theme', themeSlug);
  if (fs.existsSync(themeNested)) return themeNested;

  const themeRoot = path.join(base, 'theme');
  if (fs.existsSync(themeRoot)) return themeRoot;

  const legacy = path.join(base, themeSlug);
  if (fs.existsSync(legacy)) return legacy;

  const error = new Error(`Theme directory not found for session ${sessionId}`);
  error.status = 404;
  throw error;
}

async function getDownloadFilename(sessionId, themeSlug = 'theme') {
  if (db.isEnabled()) {
    const row = await db.getSessionRow(sessionId);
    const name = row?.wp_data?.setup?.themeName || row?.wp_data?.themeName;
    if (name) {
      const safe = String(name).replace(/[^\w .-]/g, '').trim();
      if (safe) return `${safe}.zip`;
    }
  } else if (await fileExists(sessionId, 'wpData.json')) {
    try {
      const wpData = JSON.parse(await tryReadFile(sessionId, 'wpData.json'));
      const name = wpData?.setup?.themeName || wpData?.themeName;
      if (name) {
        const safe = String(name).replace(/[^\w .-]/g, '').trim();
        if (safe) return `${safe}.zip`;
      }
    } catch {
      // fall through
    }
  }
  return `${themeSlug}.zip`;
}

function buildFileTree(files, themeSlug) {
  const prefix = `theme/${themeSlug}/`;
  const root = { name: themeSlug, type: 'folder', children: [] };

  const paths = files
    .map((f) => (f.startsWith(prefix) ? f.slice(prefix.length) : f.replace(/^theme\/[^/]+\//, '')))
    .filter(Boolean)
    .sort();

  paths.forEach((relPath) => {
    const parts = relPath.split('/');
    let node = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1 && part.includes('.');
      if (isFile) {
        node.children.push({ name: part, type: 'file' });
        return;
      }

      let folder = node.children.find((c) => c.type === 'folder' && c.name === part);
      if (!folder) {
        folder = { name: part, type: 'folder', children: [] };
        node.children.push(folder);
      }
      node = folder;
    });
  });

  return root;
}

function buildZipFromFilesystem(sessionId, themeSlug) {
  return new Promise((resolve, reject) => {
    const themeDir = resolveThemeDir(sessionId, themeSlug);
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', reject);
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    archive.directory(themeDir, themeSlug);
    archive.finalize();
  });
}

async function buildZipFromDatabase(sessionId, themeSlug) {
  const files = await db.listThemeFiles(sessionId, `theme/${themeSlug}/`);
  if (!files.length) {
    const error = new Error(`No theme files found for session ${sessionId}`);
    error.status = 404;
    throw error;
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });

    archive.on('error', reject);
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    (async () => {
      try {
        for (const filePath of files) {
          const content = await db.getThemeFile(sessionId, filePath);
          const rel = filePath.replace(`theme/${themeSlug}/`, '');
          archive.append(content, { name: `${themeSlug}/${rel}` });
        }
        await archive.finalize();
      } catch (err) {
        reject(err);
      }
    })();
  });
}

async function buildThemeZip(sessionId, themeSlug) {
  const zipBuffer = db.isEnabled()
    ? await buildZipFromDatabase(sessionId, themeSlug)
    : await buildZipFromFilesystem(sessionId, themeSlug);

  await saveThemeZip(sessionId, zipBuffer);
  return zipBuffer;
}

async function streamThemeZip(sessionId, res, filename) {
  let zipBuffer = await readThemeZip(sessionId);

  if (!zipBuffer) {
    const error = new Error('Theme ZIP not found — run theme conversion first');
    error.status = 404;
    throw error;
  }

  const safeName = String(filename || 'theme.zip').replace(/["\r\n]/g, '');

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', zipBuffer.length);
  res.end(zipBuffer);
}

module.exports = {
  resolveThemeDir,
  getDownloadFilename,
  buildFileTree,
  buildThemeZip,
  streamThemeZip,
};
