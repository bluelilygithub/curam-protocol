'use strict';

// CSS tool (Restyle) — non-technical-friendly CSS editor. The upload-html/process-css/ai-edit
// endpoints below are stateless like PDF Tools/Web Extractor: every request carries its own
// HTML/CSS, nothing persists server-side, in-memory multer only, never written to disk.
// Saved projects (below) are real per-user persistence — see docs/restyle.md.

const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const { sanitizeHtml } = require('../services/restyle/sanitizeHtml');
const { processStylesheets } = require('../services/restyle/cssProcessor');
const { requestAiEdit } = require('../services/restyle/aiEdit');
const { inlineImagesInHtmlFragment, inlineImagesInCss } = require('../services/restyle/inlineImages');
const { fetchDirect, normaliseHttpUrl } = require('../services/htmlFetch');
const { fetchBinary } = require('../services/webExtractorService');
const { JSDOM } = require('jsdom');

const router = express.Router();

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB per file
const ALLOWED_HTML_EXT = new Set(['.html', '.htm']);
const ALLOWED_CSS_EXT = new Set(['.css']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});

function extOf(filename) {
  const i = String(filename || '').lastIndexOf('.');
  return i === -1 ? '' : String(filename).slice(i).toLowerCase();
}

// Server-side extension check — the accept="" attribute on the client is only a UX hint,
// never trusted as validation.
router.post('/upload-html', upload.single('file'), async (req, res) => {
  try {
    let rawHtml;
    if (req.file) {
      const ext = extOf(req.file.originalname);
      if (!ALLOWED_HTML_EXT.has(ext)) {
        return res.status(400).json({ error: `That file doesn't look like an HTML file. Please upload a .html file.` });
      }
      rawHtml = req.file.buffer.toString('utf8');
    } else if (typeof req.body.html === 'string') {
      rawHtml = req.body.html;
    } else {
      return res.status(400).json({ error: 'No HTML was provided.' });
    }
    const { html, bodyInnerHTML, headInnerHTML, embeddedCss } = sanitizeHtml(rawHtml);

    // The preview iframe can't load remote images directly — Vault's own Content-Security-Policy
    // (which srcdoc inherits, having no origin of its own) only allows img-src 'self'/data:/blob:,
    // so any http(s) image is silently blocked by the browser. Fetch each one server-side instead
    // and inline it as a data: URI, which the CSP already permits. Covers <img> tags and inline
    // style="" attributes. Best-effort: an image that fails to fetch just stays as its original
    // URL, same as before this existed.
    const [headResult, bodyResult, embeddedCssResult] = await Promise.all([
      inlineImagesInHtmlFragment(headInnerHTML),
      inlineImagesInHtmlFragment(bodyInnerHTML),
      inlineImagesInCss(embeddedCss),
    ]);
    const inlinedCount = headResult.inlinedCount + bodyResult.inlinedCount + embeddedCssResult.inlinedCount;
    const failedCount = headResult.failedCount + bodyResult.failedCount + embeddedCssResult.failedCount;

    const changeLog = ['Removed anything in your page that could run code, to keep the preview safe — this doesn\'t affect how your page looks.'];
    // A <style> block embedded directly in the page is real CSS the tool didn't know about
    // before — surfaced as its own entry in the style list (below) rather than left inert inside
    // the HTML, since "Build the preview" only ever runs the separate style-file list through the
    // auto-fix pass.
    const cssFiles = embeddedCssResult.css.trim()
      ? [{ filename: 'Embedded styles from your page', css: embeddedCssResult.css }]
      : [];
    if (cssFiles.length) changeLog.push('Found styles written directly inside your page and added them to your style list below, so they go through the same checks as an uploaded file.');
    if (inlinedCount > 0) changeLog.push(`Loaded ${inlinedCount} image${inlinedCount === 1 ? '' : 's'} from your page so they show up in the preview.`);
    const flags = failedCount > 0
      ? [`${failedCount} image${failedCount === 1 ? '' : 's'} in your page couldn't be loaded (the link may be broken, blocked, or the file too large) — ${failedCount === 1 ? "it" : "they"} may not show up in the preview.`]
      : [];

    res.json({ html, bodyInnerHTML: bodyResult.html, headInnerHTML: headResult.html, cssFiles, changeLog, flags });
  } catch (err) {
    res.status(500).json({ error: 'We couldn\'t read that HTML file. Please check it and try again.' });
  }
});

const MAX_SCRAPED_STYLESHEETS = 10;

// Fetches a public URL and returns it in the same shape as /upload-html, plus any linked
// <link rel="stylesheet"> CSS files it can find, fetched alongside — so pasting a URL gets you
// both the page AND its real stylesheets in one step, instead of hunting them down by hand.
// Deliberately does NOT fetch or execute any <script> — same security stance as the rest of this
// tool (no allow-scripts, scripts always stripped): loading arbitrary third-party JS would mean
// running untrusted code, which this tool guarantees it never does.
router.post('/scrape-url', async (req, res) => {
  try {
    const { url } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Paste a web address first.' });

    let normalised;
    try { normalised = normaliseHttpUrl(url); } catch { return res.status(400).json({ error: "That doesn't look like a valid web address." }); }

    // Deliberately fetchDirect(), not fetchHtml() — fetchHtml's multi-strategy fallback chain
    // (Serper/WordPress-API/Jina readability) exists for SEO/text-extraction use cases where a
    // lossy reconstruction beats nothing. For a CSS editor that's the wrong trade: a Jina/Serper
    // result rewrites the markup into a stripped-down readable-text reconstruction, which is
    // exactly why a real user report compared this unfavourably to just pasting real page
    // source — that fallback path could silently kick in even when the direct fetch "worked" but
    // merely looked thin to the heuristic. fetchDirect returns the actual raw HTML byte-for-byte,
    // same as View Source, with no substitution.
    const page = await fetchDirect(normalised);
    if (!page?.body) return res.status(502).json({ error: "Couldn't load that page — it may be down or blocking automated requests. Try pasting its page source directly instead." });
    if (page.statusCode >= 400) return res.status(502).json({ error: `That page returned an error (status ${page.statusCode}) — try pasting its page source directly instead.` });
    const baseUrl = page.finalUrl || normalised;

    // Discover <link rel="stylesheet" href> before sanitizing (sanitize doesn't touch <link>,
    // but working from the raw fetched HTML avoids any ambiguity either way).
    const linkDom = new JSDOM(page.body);
    const stylesheetHrefs = [...linkDom.window.document.querySelectorAll('link[rel~="stylesheet"][href]')]
      .map((el) => {
        try { return new URL(el.getAttribute('href'), baseUrl).toString(); } catch { return null; }
      })
      .filter(Boolean)
      .slice(0, MAX_SCRAPED_STYLESHEETS);

    const scriptCount = linkDom.window.document.querySelectorAll('script[src], script:not([src])').length;

    const { html, bodyInnerHTML, headInnerHTML, embeddedCss } = sanitizeHtml(page.body);

    const [headResult, bodyResult, embeddedCssResult, cssResults] = await Promise.all([
      inlineImagesInHtmlFragment(headInnerHTML),
      inlineImagesInHtmlFragment(bodyInnerHTML),
      inlineImagesInCss(embeddedCss),
      Promise.all(stylesheetHrefs.map(async (href) => {
        try {
          const { buffer } = await fetchBinary(href);
          const { css } = await inlineImagesInCss(buffer.toString('utf8'));
          const filename = (() => {
            try { return new URL(href).pathname.split('/').pop() || 'stylesheet.css'; } catch { return 'stylesheet.css'; }
          })();
          return { filename: filename.endsWith('.css') ? filename : `${filename || 'stylesheet'}.css`, css, ok: true };
        } catch {
          return { href, ok: false };
        }
      })),
    ]);

    // Embedded <style> blocks first — they're usually the primary styling on a modern page
    // (component-scoped CSS, critical-CSS inlining, etc.), so they should win cascade priority
    // by default same as they would on the real live page (later = higher priority).
    const cssFiles = [
      ...(embeddedCssResult.css.trim() ? [{ filename: 'Embedded styles from that page', css: embeddedCssResult.css }] : []),
      ...cssResults.filter((r) => r.ok).map(({ filename, css }) => ({ filename, css })),
    ];
    const failedStylesheets = cssResults.filter((r) => !r.ok).length;
    const inlinedCount = headResult.inlinedCount + bodyResult.inlinedCount + embeddedCssResult.inlinedCount;
    const failedImages = headResult.failedCount + bodyResult.failedCount + embeddedCssResult.failedCount;

    const changeLog = [
      `Loaded the page from ${new URL(baseUrl).hostname}.`,
      'Removed anything in your page that could run code, to keep the preview safe — this doesn\'t affect how your page looks.',
    ];
    if (embeddedCssResult.css.trim()) changeLog.push('Found styles written directly inside that page and added them to your style list below.');
    if (cssResults.length > 0) changeLog.push(`Loaded ${cssResults.filter((r) => r.ok).length} style sheet${cssResults.filter((r) => r.ok).length === 1 ? '' : 's'} linked from that page.`);
    if (inlinedCount > 0) changeLog.push(`Loaded ${inlinedCount} image${inlinedCount === 1 ? '' : 's'} from that page so they show up in the preview.`);
    if (scriptCount > 0) changeLog.push(`That page uses ${scriptCount} script${scriptCount === 1 ? '' : 's'} for behaviour (like menus or sliders) — those are intentionally not loaded here, since this tool only ever changes how a page looks, never runs code from it.`);
    if (!cssFiles.length) changeLog.push("This page doesn't seem to reference any styles the tool could find — it may load its CSS in a way this tool can't detect. You can still add style files yourself below.");

    const flags = [];
    if (failedStylesheets > 0) flags.push(`${failedStylesheets} style sheet${failedStylesheets === 1 ? '' : 's'} linked from that page couldn't be loaded.`);
    if (failedImages > 0) flags.push(`${failedImages} image${failedImages === 1 ? '' : 's'} from that page couldn't be loaded.`);

    res.json({ html, bodyInnerHTML: bodyResult.html, headInnerHTML: headResult.html, cssFiles, changeLog, flags });
  } catch (err) {
    console.error('[restyle] scrape-url:', err);
    res.status(500).json({ error: err.message || "Couldn't load that page. Please check the address and try again." });
  }
});

// Accepts one or more CSS files/snippets in a given order and returns the auto-fixed,
// merged stylesheet plus a plain-English change log and a list of flagged issues.
router.post('/process-css', upload.array('files', 20), async (req, res) => {
  try {
    const droppedSheets = (req.files || []).map(f => {
      const ext = extOf(f.originalname);
      if (!ALLOWED_CSS_EXT.has(ext)) return null;
      return { filename: f.originalname, css: f.buffer.toString('utf8') };
    }).filter(Boolean);

    let pastedSheets = [];
    if (req.body.pasted) {
      try {
        const parsed = JSON.parse(req.body.pasted);
        if (Array.isArray(parsed)) {
          pastedSheets = parsed
            .filter(p => p && typeof p.css === 'string')
            .map(p => ({ filename: p.filename || 'Pasted styles', css: p.css }));
        }
      } catch { /* ignore malformed pasted payload */ }
    }

    const allSheets = [...droppedSheets, ...pastedSheets];
    if (!allSheets.length) {
      return res.status(400).json({ error: 'No stylesheets were provided.' });
    }

    // Respect the client's requested cascade order (array of filenames), falling back to
    // upload order for anything not named.
    let ordered = allSheets;
    if (req.body.order) {
      try {
        const orderList = JSON.parse(req.body.order);
        if (Array.isArray(orderList)) {
          const byName = new Map(allSheets.map(s => [s.filename, s]));
          ordered = orderList.map(name => byName.get(name)).filter(Boolean);
          allSheets.forEach(s => { if (!orderList.includes(s.filename)) ordered.push(s); });
        }
      } catch { /* keep upload order */ }
    }

    const result = processStylesheets(ordered);

    // Same CSP problem as upload-html (see there) applies to any background-image: url(...) in
    // the CSS itself — inline those as data: URIs too, best-effort.
    const { css: cssWithImages, inlinedCount, failedCount } = await inlineImagesInCss(result.css);
    result.css = cssWithImages;
    if (inlinedCount > 0) result.changeLog.push(`Loaded ${inlinedCount} background image${inlinedCount === 1 ? '' : 's'} from your styles so they show up in the preview.`);
    if (failedCount > 0) result.flags.push(`${failedCount} background image${failedCount === 1 ? '' : 's'} in your styles couldn't be loaded (the link may be broken, blocked, or the file too large) — ${failedCount === 1 ? 'it' : 'they'} may not show up in the preview.`);

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'We couldn\'t read one of those style files. Please check it and try again.' });
  }
});

// Plain-English AI edit — resolves the workspace's standard model via getModelsForUser(),
// same as any other Vault AI feature. See services/restyle/aiEdit.js for the allow-list + prompt.
router.post('/ai-edit', async (req, res) => {
  try {
    const { element, request: userRequest } = req.body || {};
    if (!element || typeof userRequest !== 'string' || !userRequest.trim()) {
      return res.status(400).json({ error: 'Missing element or request.' });
    }
    const changes = await requestAiEdit(req.user.id, element, userRequest.trim());
    res.json({ changes });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Something went wrong applying that request.' });
  }
});

// ── Saved projects (real persistence) ───────────────────────────────────────
// Stores the sanitized HTML (head/body) + the ordered CSS entries as uploaded/pasted, never a
// rendered snapshot — reopening re-runs them through the same auto-fix pass. Any inline-style
// edits already applied on the frontend live inside the saved bodyInnerHTML itself, since edits
// write directly into the element's inline style before Save is clicked.

// GET /api/restyle/projects — list the caller's saved pages, newest first.
router.get('/projects', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, "createdAt", "updatedAt"
       FROM restyle_projects WHERE "userId" = $1 ORDER BY "updatedAt" DESC`,
      [req.user.id],
    );
    res.json({ projects: rows });
  } catch (err) {
    console.error('Restyle projects list:', err);
    res.status(500).json({ error: 'Could not load your saved pages.' });
  }
});

// GET /api/restyle/projects/:id — full saved page (html + cssEntries) to reload into the editor.
router.get('/projects/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, html, "cssEntries", "createdAt", "updatedAt"
       FROM restyle_projects WHERE id = $1 AND "userId" = $2`,
      [req.params.id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Saved page not found.' });
    res.json({ project: rows[0] });
  } catch (err) {
    console.error('Restyle project load:', err);
    res.status(500).json({ error: 'Could not load this saved page.' });
  }
});

// POST /api/restyle/projects — { name, html: {head, body}, cssEntries } → saves a new page.
router.post('/projects', async (req, res) => {
  try {
    const { name, html, cssEntries } = req.body || {};
    if (!name?.trim()) return res.status(400).json({ error: 'A name is required to save.' });
    if (!html || typeof html !== 'object') return res.status(400).json({ error: 'No page to save — build a preview first.' });
    if (!Array.isArray(cssEntries) || !cssEntries.length) return res.status(400).json({ error: 'No styles to save — add at least one style file first.' });

    const { rows } = await pool.query(
      `INSERT INTO restyle_projects ("userId", name, html, "cssEntries")
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, "createdAt", "updatedAt"`,
      [req.user.id, name.trim(), JSON.stringify(html), JSON.stringify(cssEntries)],
    );
    res.json({ project: rows[0] });
  } catch (err) {
    console.error('Restyle project save:', err);
    res.status(500).json({ error: 'Could not save this page.' });
  }
});

// PUT /api/restyle/projects/:id — { name?, html?, cssEntries? } → updates an existing saved page
// (e.g. saving further edits back to the same slot instead of creating a new one).
router.put('/projects/:id', async (req, res) => {
  try {
    const { name, html, cssEntries } = req.body || {};
    const { rows } = await pool.query(
      `UPDATE restyle_projects
       SET name = COALESCE($1, name), html = COALESCE($2, html), "cssEntries" = COALESCE($3, "cssEntries"), "updatedAt" = NOW()
       WHERE id = $4 AND "userId" = $5
       RETURNING id, name, "createdAt", "updatedAt"`,
      [name?.trim() || null, html ? JSON.stringify(html) : null, cssEntries ? JSON.stringify(cssEntries) : null, req.params.id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Saved page not found.' });
    res.json({ project: rows[0] });
  } catch (err) {
    console.error('Restyle project update:', err);
    res.status(500).json({ error: 'Could not update this saved page.' });
  }
});

// DELETE /api/restyle/projects/:id
router.delete('/projects/:id', async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      `DELETE FROM restyle_projects WHERE id = $1 AND "userId" = $2`,
      [req.params.id, req.user.id],
    );
    if (!rowCount) return res.status(404).json({ error: 'Saved page not found.' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Restyle project delete:', err);
    res.status(500).json({ error: 'Could not delete this saved page.' });
  }
});

// Multer errors (e.g. file too large) — surfaced in plain English, not a stack trace.
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'That file is too large — please keep each file under 2MB.' });
    }
    return res.status(400).json({ error: 'There was a problem with that upload.' });
  }
  console.error('[restyle]', err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

module.exports = router;
