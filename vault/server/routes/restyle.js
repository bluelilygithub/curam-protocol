'use strict';

// CSS tool (Restyle) — non-technical-friendly CSS editor. The upload-html/process-css/ai-edit
// endpoints below are stateless like PDF Tools/Web Extractor: every request carries its own
// HTML/CSS, nothing persists server-side, in-memory multer only, never written to disk.
// Saved projects (below) are real per-user persistence, with version history and a public preview link — see docs/restyle.md.

const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const { getLogger } = require('../middleware/requestContext');
const { sanitizeHtml } = require('../services/restyle/sanitizeHtml');
const { processStylesheets } = require('../services/restyle/cssProcessor');
const { requestAiEdit } = require('../services/restyle/aiEdit');
const { inlineImagesInHtmlFragment, inlineImagesInCss } = require('../services/restyle/inlineImages');
const { loadPageFromUrl } = require('../services/restyle/loadFromUrl');
const { renderAvailable } = require('../services/restyle/renderPage');
const { scrapePageCss } = require('../services/restyle/scrapeCss');

const router = express.Router();

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB per file
const ALLOWED_HTML_EXT = new Set(['.html', '.htm']);
const ALLOWED_CSS_EXT = new Set(['.css']);
const MAX_PROJECT_CHARS = 15 * 1024 * 1024; // one saved page, with its style files and changes
const MAX_VERSIONS = 20; // history kept per saved page

// fieldSize matters here in a way it doesn't for most multer uses: the `pasted`/`order` fields
// in /process-css carry CSS text that can include base64-inlined background images (see
// inlineImages.js) — busboy's default fieldSize is 1MB, so a real page's embedded/linked CSS
// with even one inlined background image could silently exceed it. Multer/busboy's default
// behavior on overflow is to TRUNCATE the field, not reject the request — so this was silently
// corrupting the JSON payload (JSON.parse then failing, swallowed by the catch below) rather
// than erroring, which is why it looked like "the button does nothing." 25MB covers any
// realistic page; MAX_FILE_BYTES still caps actual uploaded FILES separately.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, fieldSize: 25 * 1024 * 1024 },
});

function extOf(filename) {
  const i = String(filename || '').lastIndexOf('.');
  return i === -1 ? '' : String(filename).slice(i).toLowerCase();
}

/**
 * Cleans a page's HTML for the preview and gathers everything the editor needs: the head and body fragments, its embedded <style> blocks
 * as style files, the pictures inlined (see below) and a short plain-English log and list of things worth a look. `linkedCss` are style
 * files fetched from a live page's <link> tags; they come first in the cascade, then the page's own embedded styles, as on the real page.
 */
const MAX_SOURCE_CHARS = 2 * 1024 * 1024; // the HTML source sent back for the source view
async function prepareHtml(rawHtml, { linkedCss = [], extraFlags = [], extraLog = [], sourceHtml } = {}) {
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

  const changeLog = [...extraLog, "Removed anything in your page that could run code, to keep the preview safe — this doesn't affect how your page looks."];
  // A <style> block embedded directly in the page is real CSS the tool didn't know about
  // before — surfaced as its own entry in the style list (below) rather than left inert inside
  // the HTML, since "Build the preview" only ever runs the separate style-file list through the
  // auto-fix pass.
  const cssFiles = [
    ...linkedCss,
    ...(embeddedCssResult.css.trim() ? [{ filename: 'Embedded styles from your page', css: embeddedCssResult.css }] : []),
  ];
  if (embeddedCssResult.css.trim()) changeLog.push('Found styles written directly inside your page and added them to your style list below, so they go through the same checks as an uploaded file.');
  if (linkedCss.length) changeLog.push(`Loaded ${linkedCss.length} style file${linkedCss.length === 1 ? '' : 's'} linked from the page.`);
  if (inlinedCount > 0) changeLog.push(`Loaded ${inlinedCount} image${inlinedCount === 1 ? '' : 's'} from your page so they show up in the preview.`);
  const flags = [...extraFlags];
  if (failedCount > 0) flags.push(`${failedCount} image${failedCount === 1 ? '' : 's'} in your page couldn't be loaded (the link may be broken, blocked, or the file too large) — ${failedCount === 1 ? 'it' : 'they'} may not show up in the preview.`);

  // The page as it came in (for a live page: as the website sent it), so it can be read in the source view.
  const original = String(sourceHtml == null ? rawHtml : sourceHtml);
  return {
    html, bodyInnerHTML: bodyResult.html, headInnerHTML: headResult.html, cssFiles, changeLog, flags,
    rawHtml: original.length > MAX_SOURCE_CHARS ? original.slice(0, MAX_SOURCE_CHARS) : original, rawTruncated: original.length > MAX_SOURCE_CHARS,
  };
}

// Server-side extension check — the accept="" attribute on the client is only a UX hint,
// never trusted as validation.
router.post('/upload-html', upload.single('file'), async (req, res) => {
  try {
    let rawHtml;
    if (req.file) {
      const ext = extOf(req.file.originalname);
      if (!ALLOWED_HTML_EXT.has(ext)) {
        return res.status(400).json({ error: "That file doesn't look like an HTML file. Please upload a .html file." });
      }
      rawHtml = req.file.buffer.toString('utf8');
    } else if (typeof req.body.html === 'string') {
      rawHtml = req.body.html;
    } else {
      return res.status(400).json({ error: 'No HTML was provided.' });
    }
    res.json(await prepareHtml(rawHtml));
  } catch (err) {
    getLogger().error({ err }, '[restyle/upload-html]');
    res.status(500).json({ error: "We couldn't read that HTML file. Please check it and try again." });
  }
});

// ── Load a live page by its web address ──────────────────────────────────────────────────────────────────────────────────
// A plain fetch by default; `render: true` runs the page in a headless browser first so a page that builds itself with JavaScript has
// its content. Both go through the SSRF checks (htmlFetch.js / renderPage.js). Limits are per person, because each call fetches a page
// and up to a dozen style files, and a render starts a browser.
const urlLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 40,
  keyGenerator: (req) => `restyle-url-${req.user.id}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'That is a lot of pages in an hour. Try again a little later.' },
});
const RENDERS_PER_HOUR = 8;
const renderHits = new Map(); // userId -> [timestamps]
function renderAllowed(userId) {
  const now = Date.now();
  const recent = (renderHits.get(userId) || []).filter((t) => now - t < 60 * 60 * 1000);
  if (recent.length >= RENDERS_PER_HOUR) { renderHits.set(userId, recent); return false; }
  recent.push(now);
  renderHits.set(userId, recent);
  return true;
}

/** What went wrong loading an address, in plain words, with the right status. */
function describeLoadError(err) {
  const m = String((err && err.message) || '');
  if (/private|DNS|Invalid URL|Only http/i.test(m)) return { status: 400, error: 'That address cannot be loaded. Check it is a public web address starting with http:// or https://.' };
  if (/busy/i.test(m)) return { status: 503, error: m };
  if (/not set up|too large/i.test(m)) return { status: 400, error: m };
  if (/Server returned (202|401|403|406|429)/i.test(m)) return { status: 502, error: 'That website refused to give us the page (it turns away automatic visitors). If you have the page, open it in your browser, choose File, Save page as, and upload the .html file here instead. The "builds itself with JavaScript" option opens it in a real browser and sometimes gets in.' };
  const code = m.match(/Server returned (\d+)/i);
  if (code) return { status: 502, error: `The website answered with an error (${code[1]}), so the page could not be loaded.` };
  return { status: 502, error: "We couldn't open that page. It may be down, blocking automatic visitors, or taking too long." };
}

// ── Download a page's CSS ────────────────────────────────────────────────────────────────────────────────────────────────
// The style files a live page depends on (linked, imported, and written inside the page), with their addresses made complete, plus a
// summary of the design settings they set. Returns text only: nothing is changed, saved or run. Same limits and render rules as /fetch-url.
router.post('/scrape-css', urlLimiter, async (req, res) => {
  const { url, render } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'Type the address of the page first.' });
  if (render && !renderAvailable()) return res.status(400).json({ error: 'Loading pages that build themselves with JavaScript is not set up on this server.' });
  if (render && !renderAllowed(req.user.id)) return res.status(429).json({ error: `You can load ${RENDERS_PER_HOUR} pages that way an hour. Try the normal load, or wait a little.` });
  try {
    res.json(await scrapePageCss(url.trim(), { render: !!render }));
  } catch (err) {
    getLogger().error({ err: { message: err.message } }, '[restyle/scrape-css]');
    const { status, error } = describeLoadError(err);
    res.status(status).json({ error });
  }
});

router.get('/capabilities', (req, res) => {
  res.json({ render: renderAvailable() });
});

router.post('/fetch-url', urlLimiter, async (req, res) => {
  const { url, render } = req.body || {};
  if (typeof url !== 'string' || !url.trim()) return res.status(400).json({ error: 'Type the address of the page first.' });
  if (render && !renderAvailable()) return res.status(400).json({ error: 'Loading pages that build themselves with JavaScript is not set up on this server.' });
  if (render && !renderAllowed(req.user.id)) return res.status(429).json({ error: `You can load ${RENDERS_PER_HOUR} pages that way an hour. Try the normal load, or wait a little.` });
  try {
    const loaded = await loadPageFromUrl(url.trim(), { render: !!render });
    const prepared = await prepareHtml(loaded.html, {
      sourceHtml: loaded.rawHtml,
      linkedCss: loaded.cssFiles,
      extraFlags: loaded.flags,
      extraLog: [`Loaded ${loaded.finalUrl}${loaded.rendered ? ' in a browser (its scripts ran first)' : ''}.`],
    });
    res.json({ ...prepared, sourceUrl: loaded.finalUrl, rendered: loaded.rendered });
  } catch (err) {
    getLogger().error({ err: { message: err.message } }, '[restyle/fetch-url]');
    const { status, error } = describeLoadError(err);
    res.status(status).json({ error });
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
      } catch (err) {
        // Previously swallowed silently — that's exactly what made a truncated multer field
        // (see fieldSize note above) look like "the button does nothing" instead of a real
        // error. A field that failed to parse as JSON almost always means it was cut off.
        console.error('[restyle] process-css: pasted field failed to parse as JSON', { length: req.body.pasted.length, err: err.message });
        return res.status(400).json({ error: 'One of your style entries was too large to process in one go — try splitting it into smaller files.' });
      }
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
      `SELECT id, name, "createdAt", "updatedAt", ("shareToken" IS NOT NULL) AS shared
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
      `SELECT id, name, html, "cssEntries", "createdAt", "updatedAt", "shareToken"
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
    if (cssEntries !== undefined && !Array.isArray(cssEntries)) return res.status(400).json({ error: 'The style files could not be saved.' });
    if (JSON.stringify(html).length > MAX_PROJECT_CHARS) return res.status(400).json({ error: 'This page is too large to save.' });

    const { rows } = await pool.query(
      `INSERT INTO restyle_projects ("userId", name, html, "cssEntries")
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, "createdAt", "updatedAt"`,
      [req.user.id, name.trim(), JSON.stringify(html), JSON.stringify(cssEntries || [])],
    );
    res.json({ project: rows[0] });
  } catch (err) {
    console.error('Restyle project save:', err);
    res.status(500).json({ error: 'Could not save this page.' });
  }
});

// PUT /api/restyle/projects/:id — { name?, html?, cssEntries? } → updates an existing saved page in place. What was there is first
// copied into the page's history (the newest MAX_VERSIONS kept), so an update can always be taken back.
router.put('/projects/:id', async (req, res) => {
  const { name, html, cssEntries } = req.body || {};
  if (html && JSON.stringify(html).length > MAX_PROJECT_CHARS) return res.status(400).json({ error: 'This page is too large to save.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const archived = await client.query(
      `INSERT INTO restyle_project_versions ("projectId", "userId", name, html, "cssEntries")
       SELECT id, "userId", name, html, "cssEntries" FROM restyle_projects WHERE id = $1 AND "userId" = $2
       RETURNING id`,
      [req.params.id, req.user.id],
    );
    if (!archived.rows[0]) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Saved page not found.' }); }
    const { rows } = await client.query(
      `UPDATE restyle_projects
       SET name = COALESCE($1, name), html = COALESCE($2, html), "cssEntries" = COALESCE($3, "cssEntries"), "updatedAt" = NOW()
       WHERE id = $4 AND "userId" = $5
       RETURNING id, name, "createdAt", "updatedAt"`,
      [name?.trim() || null, html ? JSON.stringify(html) : null, cssEntries ? JSON.stringify(cssEntries) : null, req.params.id, req.user.id],
    );
    await client.query(
      `DELETE FROM restyle_project_versions WHERE "projectId" = $1 AND id NOT IN (
         SELECT id FROM restyle_project_versions WHERE "projectId" = $1 ORDER BY "createdAt" DESC, id DESC LIMIT $2)`,
      [req.params.id, MAX_VERSIONS],
    );
    await client.query('COMMIT');
    res.json({ project: rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    getLogger().error({ err }, '[restyle/project update]');
    res.status(500).json({ error: 'Could not update this saved page.' });
  } finally {
    client.release();
  }
});

// GET /api/restyle/projects/:id/versions — the history of a saved page, newest first (what each update replaced).
router.get('/projects/:id/versions', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.name, v."createdAt"
       FROM restyle_project_versions v JOIN restyle_projects p ON p.id = v."projectId"
       WHERE v."projectId" = $1 AND p."userId" = $2 ORDER BY v."createdAt" DESC, v.id DESC`,
      [req.params.id, req.user.id],
    );
    res.json({ versions: rows });
  } catch (err) {
    getLogger().error({ err }, '[restyle/versions]');
    res.status(500).json({ error: 'Could not load the history of this page.' });
  }
});

// GET /api/restyle/projects/:id/versions/:vid — one earlier version, to open in the editor.
router.get('/projects/:id/versions/:vid', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT v.id, v.name, v.html, v."cssEntries", v."createdAt"
       FROM restyle_project_versions v JOIN restyle_projects p ON p.id = v."projectId"
       WHERE v.id = $1 AND v."projectId" = $2 AND p."userId" = $3`,
      [req.params.vid, req.params.id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'That version was not found.' });
    res.json({ project: rows[0] });
  } catch (err) {
    getLogger().error({ err }, '[restyle/version]');
    res.status(500).json({ error: 'Could not load that version.' });
  }
});

// POST /api/restyle/projects/:id/share — makes (or keeps) the page's public preview link. The link shows the page as last saved.
router.post('/projects/:id/share', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE restyle_projects SET "shareToken" = COALESCE("shareToken", $1) WHERE id = $2 AND "userId" = $3 RETURNING "shareToken"`,
      [crypto.randomBytes(32).toString('hex'), req.params.id, req.user.id],
    );
    if (!rows[0]) return res.status(404).json({ error: 'Saved page not found.' });
    res.json({ token: rows[0].shareToken });
  } catch (err) {
    getLogger().error({ err }, '[restyle/share]');
    res.status(500).json({ error: 'Could not make the link.' });
  }
});

// DELETE /api/restyle/projects/:id/share — stops sharing: the old link stops working at once.
router.delete('/projects/:id/share', async (req, res) => {
  try {
    const { rowCount } = await pool.query('UPDATE restyle_projects SET "shareToken" = NULL WHERE id = $1 AND "userId" = $2', [req.params.id, req.user.id]);
    if (!rowCount) return res.status(404).json({ error: 'Saved page not found.' });
    res.json({ ok: true });
  } catch (err) {
    getLogger().error({ err }, '[restyle/unshare]');
    res.status(500).json({ error: 'Could not stop sharing.' });
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
