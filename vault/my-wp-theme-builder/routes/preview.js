const express = require('express');
const { tryReadFile, fileExists } = require('../utils/filewriter');
const { ensureScrollBehavior } = require('../utils/parseDesign');
const { appendResponsiveGuarantees } = require('../utils/responsiveCss');
const { buildPreviewHtml } = require('../utils/previewEnhance');
const { extractAllIteratePreviewCss } = require('../utils/targetedIterate');
const db = require('../utils/db');

const router = express.Router();

async function loadIntakeFunctionality(sessionId) {
  const raw = await tryReadFile(sessionId, 'intake.json');
  if (!raw) return [];
  try {
    return JSON.parse(raw).functionality || [];
  } catch {
    return [];
  }
}

async function isWireframePhase(sessionId) {
  const raw = await tryReadFile(sessionId, 'meta.json');
  if (!raw) return false;
  try {
    const meta = JSON.parse(raw);
    return meta.stage === 'wireframe';
  } catch {
    return false;
  }
}

async function loadCssVersion(sessionId) {
  const raw = await tryReadFile(sessionId, 'stage1/current.json');
  if (!raw) return null;
  try {
    return JSON.parse(raw).version || null;
  } catch {
    return null;
  }
}

async function loadPreviewHtml(sessionId) {
  if (!(await fileExists(sessionId, 'index.html'))) {
    return null;
  }

  const html = db.isEnabled()
    ? (await db.getHtml(sessionId)).html
    : await tryReadFile(sessionId, 'index.html');

  if (!html) return null;

  const css = db.isEnabled()
    ? (await db.getHtml(sessionId)).css
    : await tryReadFile(sessionId, 'style.css');

  const functionality = await loadIntakeFunctionality(sessionId);
  const hasResponsive = await fileExists(sessionId, 'responsive.css');
  const wireframe = await isWireframePhase(sessionId);
  const cssVersion = await loadCssVersion(sessionId);
  const iterateCss = extractAllIteratePreviewCss({ css: css || '', html });

  return buildPreviewHtml(html, {
    sessionId,
    functionality,
    hasResponsive,
    wireframe,
    iterateCss,
    cssVersion,
  });
}

router.get('/:sessionId/style.css', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const css = db.isEnabled()
      ? (await db.getHtml(sessionId)).css
      : await tryReadFile(sessionId, 'style.css');

    if (!css) {
      return res.status(404).send('/* not found */');
    }

    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(ensureScrollBehavior(css));
  } catch (err) {
    next(err);
  }
});

router.get('/:sessionId/responsive.css', async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const css = await tryReadFile(sessionId, 'responsive.css');

    if (!css) {
      return res.status(404).send('/* responsive.css not found */');
    }

    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.send(appendResponsiveGuarantees(css));
  } catch (err) {
    next(err);
  }
});

router.get(['/:sessionId', '/:sessionId/'], async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    const html = await loadPreviewHtml(sessionId);

    if (!html) {
      return res.status(404).send('Preview not found');
    }

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
