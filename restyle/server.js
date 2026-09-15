'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const multer = require('multer');

const { sanitizeHtml } = require('./lib/sanitizeHtml');
const { processStylesheets } = require('./lib/cssProcessor');
const { requestAiEdit } = require('./lib/aiEdit');

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2MB per file, per spec
const ALLOWED_HTML_EXT = new Set(['.html', '.htm']);
const ALLOWED_CSS_EXT = new Set(['.css']);

// In-memory storage only — nothing written to disk, so an ephemeral Railway filesystem is a
// non-issue. Nothing here needs to survive a restart or be shared across requests.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
});

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

function extOf(filename) {
  const i = String(filename || '').lastIndexOf('.');
  return i === -1 ? '' : String(filename).slice(i).toLowerCase();
}

// Validates + sanitizes a single uploaded HTML file (or accepts pasted HTML directly).
// Server-side extension check — the accept="" attribute on the client is only a UX hint,
// never trusted as validation.
app.post('/api/upload-html', upload.single('file'), (req, res) => {
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
// Body: multipart with any number of `files` (dropped .css files) AND/OR a JSON `pasted`
// array of { filename, css } for pasted snippets, plus an `order` array of identifiers
// (filenames) giving the final cascade order the client wants applied.
app.post('/api/process-css', upload.array('files', 20), (req, res) => {
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

// Plain-English AI edit — see lib/aiEdit.js for the allow-list + prompt.
app.post('/api/ai-edit', async (req, res) => {
  try {
    const { element, request: userRequest } = req.body || {};
    if (!element || typeof userRequest !== 'string' || !userRequest.trim()) {
      return res.status(400).json({ error: 'Missing element or request.' });
    }
    const changes = await requestAiEdit(element, userRequest.trim());
    res.json({ changes });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'Something went wrong applying that request.' });
  }
});

// Multer errors (e.g. file too large) — surfaced in plain English, not a stack trace.
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'That file is too large — please keep each file under 2MB.' });
    }
    return res.status(400).json({ error: 'There was a problem with that upload.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

app.listen(PORT, () => {
  console.log(`Restyle running on port ${PORT}`);
});
