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
router.post('/upload-html', upload.single('file'), (req, res) => {
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
    const { html, bodyInnerHTML, headInnerHTML } = sanitizeHtml(rawHtml);
    res.json({
      html,
      bodyInnerHTML,
      headInnerHTML,
      changeLog: ['Removed anything in your page that could run code, to keep the preview safe — this doesn\'t affect how your page looks.'],
    });
  } catch (err) {
    res.status(500).json({ error: 'We couldn\'t read that HTML file. Please check it and try again.' });
  }
});

// Accepts one or more CSS files/snippets in a given order and returns the auto-fixed,
// merged stylesheet plus a plain-English change log and a list of flagged issues.
router.post('/process-css', upload.array('files', 20), (req, res) => {
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
