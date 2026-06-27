const express = require('express');
const { tryReadFile, fileExists } = require('../utils/filewriter');
const { ensureScrollBehavior } = require('../utils/parseDesign');
const { appendResponsiveGuarantees } = require('../utils/responsiveCss');
const { buildPreviewHtml } = require('../utils/previewEnhance');
const { extractAllIteratePreviewCss } = require('../utils/targetedIterate');
const { assetUrl } = require('../utils/mountPath');
const db = require('../utils/db');

const router = express.Router();

// The preview is sandboxed, AI-generated HTML rendered in an iframe. It needs
// remote placeholder images (picsum.photos, etc.), Google Fonts, inline <style>,
// and the inline scroll-reveal / nav-toggle / slideshow controllers. Vault's
// global helmet CSP (production) blocks these, so override it for this response
// only — this does not relax the policy for the rest of the app.
const PREVIEW_CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https:",
  "style-src 'self' 'unsafe-inline' https:",
  "font-src 'self' data: https:",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self'",
  "frame-ancestors 'self'",
].join('; ');

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

async function loadTemplatePreviewHtml(sessionId, key) {
  const dir = `stage1/templates/${key}`;
  const html = await tryReadFile(sessionId, `${dir}/index.html`);
  if (!html) return null;

  const css = (await tryReadFile(sessionId, `${dir}/style.css`)) || '';
  const functionality = await loadIntakeFunctionality(sessionId);
  const hasResponsive = await fileExists(sessionId, `${dir}/responsive.css`);
  const iterateCss = extractAllIteratePreviewCss({ css, html });

  return buildPreviewHtml(html, {
    sessionId,
    baseHref: assetUrl(`/preview/${sessionId}/template/${key}/`),
    functionality,
    hasResponsive,
    wireframe: false,
    iterateCss,
    cssVersion: Date.now(),
  });
}

router.get('/:sessionId/template/:key/style.css', async (req, res, next) => {
  try {
    const { sessionId, key } = req.params;
    const css = await tryReadFile(sessionId, `stage1/templates/${key}/style.css`);
    if (!css) return res.status(404).send('/* template style.css not found */');
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.send(ensureScrollBehavior(css));
  } catch (err) {
    next(err);
  }
});

router.get('/:sessionId/template/:key/responsive.css', async (req, res, next) => {
  try {
    const { sessionId, key } = req.params;
    const css = await tryReadFile(sessionId, `stage1/templates/${key}/responsive.css`);
    if (!css) return res.status(404).send('/* template responsive.css not found */');
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.send(appendResponsiveGuarantees(css));
  } catch (err) {
    next(err);
  }
});

router.get(['/:sessionId/template/:key', '/:sessionId/template/:key/'], async (req, res, next) => {
  try {
    const { sessionId, key } = req.params;
    const html = await loadTemplatePreviewHtml(sessionId, key);
    if (!html) return res.status(404).send('Template preview not found');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', PREVIEW_CSP);
    res.send(html);
  } catch (err) {
    next(err);
  }
});

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
    res.setHeader('Content-Security-Policy', PREVIEW_CSP);
    res.send(html);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
