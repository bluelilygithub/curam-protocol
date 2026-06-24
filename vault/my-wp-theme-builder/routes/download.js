const express = require('express');
const { fileExists, tryReadFile } = require('../utils/filewriter');
const { buildThemeZip, streamThemeZip, getDownloadFilename } = require('../utils/zip');
const {
  buildSourceZip,
  buildStaticHostingZip,
  buildWordpressZip,
  streamZipBuffer,
  exportFilename,
} = require('../utils/exportZip');
const { slugifyTheme } = require('../services/generateTheme');
const db = require('../utils/db');

const router = express.Router();

async function resolveThemeSlug(sessionId, meta) {
  if (meta.themeSlug) return meta.themeSlug;
  if (db.isEnabled()) {
    const row = await db.getSessionRow(sessionId);
    return slugifyTheme(row?.wp_data?.setup?.themeName || 'my-theme');
  }
  try {
    const wpRaw = await tryReadFile(sessionId, 'wpData.json');
    const wpData = wpRaw ? JSON.parse(wpRaw) : {};
    return slugifyTheme(wpData?.setup?.themeName || 'my-theme');
  } catch {
    return 'my-theme';
  }
}

router.get('/:sessionId', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const variant = String(req.query.variant || 'wordpress').toLowerCase();
    const version = req.query.version ? Number(req.query.version) : null;
    const approved = req.query.approved === '1' || variant === 'static';

    if (!(await fileExists(sessionId, 'meta.json'))) {
      return res.status(404).json({ error: 'Session not found' });
    }

    const metaRaw = await tryReadFile(sessionId, 'meta.json');
    const meta = metaRaw ? JSON.parse(metaRaw) : {};
    const themeSlug = await resolveThemeSlug(sessionId, meta);

    if (variant === 'source') {
      const buffer = await buildSourceZip(sessionId, { approved, version });
      const filename = await exportFilename(sessionId, 'source', themeSlug);
      return streamZipBuffer(res, buffer, filename);
    }

    if (variant === 'static') {
      const buffer = await buildStaticHostingZip(sessionId, { approved });
      const filename = await exportFilename(sessionId, 'static', themeSlug);
      return streamZipBuffer(res, buffer, filename);
    }

    if (variant === 'wordpress' || variant === 'theme') {
      const buffer = await buildWordpressZip(sessionId, themeSlug);
      const filename = await getDownloadFilename(sessionId, themeSlug);
      return streamZipBuffer(res, buffer, filename);
    }

    return res.status(400).json({
      error: 'Unknown variant. Use variant=source|static|wordpress',
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
