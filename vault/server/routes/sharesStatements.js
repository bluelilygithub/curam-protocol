'use strict';

const express = require('express');
const router  = express.Router();
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');
const { aiLimiter } = require('../middleware/aiRateLimit');
const {
  createImport, getImports, getImportDetail, updateLineFields, approveLine, rejectLine, revertImport,
} = require('../services/sharesStatementImport');
const { parseCmcDividendEmails } = require('../services/sharesDividendEmail');

// PDF-only per docs/shares-statement-import.md. Temp storage — deleted right
// after text extraction, never kept (the extracted+structured data lives in
// share_statement_lines, not the original file).
const upload = multer({
  dest: path.join(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'), 'statements-tmp'),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || path.extname(file.originalname).toLowerCase() === '.pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF statements are accepted'));
    }
  },
});

// POST /api/shares/statements/upload — the only route on this router that
// makes an LLM call, so aiLimiter applies here only, not to the whole router.
router.post('/upload', aiLimiter, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file is required' });
  try {
    const result = await createImport(req.user.id, {
      filename: req.file.originalname,
      filePath: req.file.path,
      brokerHint: req.body.brokerHint || null,
    });
    res.status(201).json(result);
  } catch (err) {
    console.error('[sharesStatements] upload error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {}); // best-effort — extraction already read it
  }
});

// POST /api/shares/statements/email { text } — pasted CMC dividend email(s). Parsed with plain rules
// (no model call, nothing leaves the server), then into the same review queue as a PDF.
router.post('/email', async (req, res) => {
  try {
    const text = String((req.body && req.body.text) || '');
    if (!text.trim()) return res.status(400).json({ error: 'Paste the dividend email text first' });
    if (text.length > 50000) return res.status(400).json({ error: 'That is too long for a dividend email' });
    const { lines, warnings, skipped } = parseCmcDividendEmails(text);
    if (!lines.length) {
      return res.status(400).json({ error: `No dividend found in that text${skipped.length ? ` (${skipped.join('; ')})` : ' — paste the whole email, starting at "Dividend On:"'}` });
    }
    const first = lines[0];
    const result = await createImport(req.user.id, {
      filename: lines.length === 1 ? `CMC dividend email — ${first.symbol} ${first.date}` : `CMC dividend emails — ${lines.length} dividends`,
      brokerHint: 'CMC Markets',
      lines,
    });
    res.status(201).json({ ...result, emailWarnings: [...warnings, ...skipped.map((s) => `Skipped ${s}`)] });
  } catch (err) {
    console.error('[sharesStatements] email error:', err.message);
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// GET /api/shares/statements
router.get('/', async (req, res) => {
  try {
    res.json(await getImports(req.user.id));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/shares/statements/:id
router.get('/:id', async (req, res) => {
  try {
    const detail = await getImportDetail(req.user.id, Number(req.params.id));
    if (!detail) return res.status(404).json({ error: 'Import not found' });
    res.json(detail);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/shares/statements/lines/:lineId — edit a pending line before approving
router.put('/lines/:lineId', async (req, res) => {
  try {
    const updated = await updateLineFields(req.user.id, Number(req.params.lineId), req.body || {});
    if (!updated) return res.status(404).json({ error: 'Line not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST /api/shares/statements/lines/:lineId/approve
router.post('/lines/:lineId/approve', async (req, res) => {
  try {
    const updated = await approveLine(req.user.id, Number(req.params.lineId));
    if (!updated) return res.status(404).json({ error: 'Line not found' });
    res.json(updated);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// POST /api/shares/statements/lines/:lineId/reject
router.post('/lines/:lineId/reject', async (req, res) => {
  try {
    const updated = await rejectLine(req.user.id, Number(req.params.lineId));
    if (!updated) return res.status(404).json({ error: 'Line not found or already reviewed' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/shares/statements/:id/revert
router.post('/:id/revert', async (req, res) => {
  try {
    const updated = await revertImport(req.user.id, Number(req.params.id));
    if (!updated) return res.status(404).json({ error: 'Import not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
