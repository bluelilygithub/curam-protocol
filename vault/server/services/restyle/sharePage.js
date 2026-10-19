'use strict';

// The public, read-only preview of a saved CSS-tool page: the page as saved, with the changes made in the tool, so a client can look at it
// without a Vault login. Built here from the saved project and served by routes/restyleShared.js with a Content-Security-Policy that
// allows no scripts at all. See docs/restyle.md ("Share a preview").

const { sanitizeHtml } = require('./sanitizeHtml');
const { sanitizeEditsCss, sanitizePageCss, forStyleElement } = require('./sanitizeCss');

const escapeHtml = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MAX_PAGE_CHARS = 8 * 1024 * 1024;

/** The headers the shared page is served with: no scripts, nothing framed, nothing indexed, no referrer sent. */
const SHARE_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data: https: http:; font-src https: data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  'Cache-Control': 'no-store',
};

/**
 * @param {{name:string, html:{head?:string, body?:string, pageCss?:string, editsCss?:string}}} project  a saved project row
 * @param {{view?: 'original'|'changes'}} [opts]
 * @returns {string} a complete HTML document
 */
function buildSharedPage(project, { view = 'changes' } = {}) {
  const saved = (project && project.html) || {};
  const head = String(saved.head || '');
  const body = String(saved.body || '');
  if (head.length + body.length > MAX_PAGE_CHARS) throw new Error('This page is too large to share.');

  // The saved fragments were cleaned when they came in, but a saved project is only as clean as what the browser sent, so clean again.
  const clean = sanitizeHtml(`<!DOCTYPE html><html><head>${head}</head><body>${body}</body></html>`);
  const pageCss = sanitizePageCss([saved.pageCss, clean.embeddedCss].filter(Boolean).join('\n'));
  const editsCss = view === 'original' ? '' : sanitizeEditsCss(saved.editsCss);

  const link = (href, label, active) => `<a href="${href}" style="color:#fff;text-decoration:${active ? 'underline' : 'none'};opacity:${active ? 1 : 0.7}">${label}</a>`;
  const bar = `<div style="position:sticky;top:0;z-index:2147483647;background:#1a1a1a;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;display:flex;flex-wrap:wrap;gap:14px;align-items:center">`
    + `<span style="opacity:0.85">Preview: ${escapeHtml(project.name)}</span>`
    + `<span style="margin-left:auto;display:flex;gap:14px">${link('?view=changes', 'With the changes', view !== 'original')}${link('?view=original', 'Original', view === 'original')}</span></div>`;

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">`
    + `<title>${escapeHtml(project.name)}</title>${clean.headInnerHTML}`
    + `<style>${forStyleElement(pageCss)}</style><style>${forStyleElement(editsCss)}</style></head><body>${bar}${clean.bodyInnerHTML}</body></html>`;
}

module.exports = { buildSharedPage, SHARE_HEADERS };
