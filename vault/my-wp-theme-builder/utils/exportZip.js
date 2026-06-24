'use strict';

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const db = require('./db');
const { tryReadFile, readThemeZip } = require('./filewriter');
const { buildThemeZip, getDownloadFilename } = require('./zip');

function stripPreviewArtifacts(html) {
  return String(html || '')
    .replace(/<script[^>]+preview-picker\.js[^>]*>\s*<\/script>/gi, '')
    .replace(/<script[^>]+src=["'][^"']*preview-picker\.js[^"']*["'][^>]*>\s*<\/script>/gi, '')
    .replace(/<style id=["']tb-wireframe-chrome["'][^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<base[^>]*>/gi, '');
}

function ensureStaticStylesheets(html) {
  let out = stripPreviewArtifacts(html);
  if (!/<link[^>]+href=["']style\.css["']/i.test(out)) {
    const link = '<link rel="stylesheet" href="style.css">';
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${link}\n</head>`) : `${link}\n${out}`;
  }
  if (!/<link[^>]+href=["']responsive\.css["']/i.test(out)) {
    out = out.replace(
      /<link[^>]+href=["']style\.css["'][^>]*>/i,
      (m) => `${m}\n<link rel="stylesheet" href="responsive.css">`
    );
  }
  return out;
}

async function readDesignFiles(sessionId, { approved = false } = {}) {
  let html;
  let css;
  let responsiveCss = '';

  if (approved) {
    if (db.isEnabled()) {
      const row = await db.getSessionRow(sessionId);
      html = row?.approved_html;
      css = row?.approved_css || '';
    } else {
      html = await tryReadFile(sessionId, 'stage1/approved/index.html');
      css = (await tryReadFile(sessionId, 'stage1/approved/style.css')) || '';
    }
    responsiveCss = (await tryReadFile(sessionId, 'stage1/approved/responsive.css')) || '';
  }

  if (!html) {
    if (db.isEnabled()) {
      const stored = await db.getHtml(sessionId);
      html = stored?.html;
      css = stored?.css || '';
    } else {
      html = await tryReadFile(sessionId, 'index.html');
      css = (await tryReadFile(sessionId, 'style.css')) || '';
    }
    responsiveCss = (await tryReadFile(sessionId, 'responsive.css')) || responsiveCss;
  }

  if (!html) {
    const err = new Error('No design files to export');
    err.status = 404;
    throw err;
  }

  return { html, css, responsiveCss };
}

function archiveToBuffer(appendFn) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', reject);
    archive.on('data', (chunk) => chunks.push(chunk));
    archive.on('end', () => resolve(Buffer.concat(chunks)));
    Promise.resolve(appendFn(archive)).then(() => archive.finalize()).catch(reject);
  });
}

async function buildSourceZip(sessionId, { approved = false, version = null } = {}) {
  if (version) {
    const html = await tryReadFile(sessionId, `stage1/v${version}/index.html`);
    const css = (await tryReadFile(sessionId, `stage1/v${version}/style.css`)) || '';
    const responsiveCss = (await tryReadFile(sessionId, `stage1/v${version}/responsive.css`)) || '';
    if (!html) {
      const err = new Error(`Version v${version} not found`);
      err.status = 404;
      throw err;
    }
    return archiveToBuffer((archive) => {
      archive.append(html, { name: 'index.html' });
      if (css) archive.append(css, { name: 'style.css' });
      if (responsiveCss) archive.append(responsiveCss, { name: 'responsive.css' });
      archive.append(JSON.stringify({ sessionId, version, exportedAt: new Date().toISOString() }, null, 2), { name: 'export-meta.json' });
    });
  }

  const { html, css, responsiveCss } = await readDesignFiles(sessionId, { approved });
  const wireframe = await tryReadFile(sessionId, 'stage1/wireframe-approved.html')
    || await tryReadFile(sessionId, 'stage1/wireframe.html');

  return archiveToBuffer((archive) => {
    archive.append(html, { name: 'index.html' });
    if (css) archive.append(css, { name: 'style.css' });
    if (responsiveCss) archive.append(responsiveCss, { name: 'responsive.css' });
    if (wireframe) archive.append(wireframe, { name: 'wireframe-approved.html' });
    archive.append(JSON.stringify({ sessionId, variant: 'source', exportedAt: new Date().toISOString() }, null, 2), { name: 'export-meta.json' });
  });
}

async function buildStaticHostingZip(sessionId, { approved = true } = {}) {
  const { html, css, responsiveCss } = await readDesignFiles(sessionId, { approved });
  const cleanHtml = ensureStaticStylesheets(html);

  return archiveToBuffer((archive) => {
    archive.append(cleanHtml, { name: 'index.html' });
    archive.append(css || '/* style.css */', { name: 'style.css' });
    archive.append(responsiveCss || '/* responsive.css */', { name: 'responsive.css' });
    archive.append([
      '# Static site export',
      '',
      'Upload all files to your web root (public_html, www, or htdocs).',
      'No Node, React, or build step required.',
      '',
      'Files:',
      '- index.html',
      '- style.css',
      '- responsive.css',
    ].join('\n'), { name: 'README-HOSTING.txt' });
  });
}

async function buildWordpressZip(sessionId, themeSlug) {
  let zipBuffer = await readThemeZip(sessionId);
  if (!zipBuffer) {
    await buildThemeZip(sessionId, themeSlug);
    zipBuffer = await readThemeZip(sessionId);
  }
  if (!zipBuffer) {
    const err = new Error('WordPress theme not generated yet — complete the WP brief first');
    err.status = 404;
    throw err;
  }
  return zipBuffer;
}

function streamZipBuffer(res, buffer, filename) {
  const safeName = String(filename || 'export.zip').replace(/["\r\n]/g, '');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
  res.setHeader('Content-Length', buffer.length);
  res.end(buffer);
}

async function exportFilename(sessionId, variant, themeSlug) {
  const metaRaw = await tryReadFile(sessionId, 'meta.json');
  const meta = metaRaw ? JSON.parse(metaRaw) : {};
  const base = (meta.displayName || 'site').replace(/[^\w .-]/g, '').trim() || 'site';
  if (variant === 'wordpress') {
    return getDownloadFilename(sessionId, themeSlug || meta.themeSlug || 'theme');
  }
  if (variant === 'static') return `${base}-static-hosting.zip`;
  return `${base}-source.zip`;
}

module.exports = {
  buildSourceZip,
  buildStaticHostingZip,
  buildWordpressZip,
  streamZipBuffer,
  exportFilename,
  stripPreviewArtifacts,
};
