'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ACCEPTED_MIMES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'application/json', 'text/csv', 'text/markdown',
  'text/x-markdown',
];

const ACCEPTED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp', '.txt', '.json', '.csv', '.md'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const dir = path.join(uploadDir, String(req.params.projectId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}-${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ACCEPTED_MIMES.includes(file.mimetype) ||
        (file.mimetype === 'application/octet-stream' && ACCEPTED_EXTENSIONS.includes(ext))) {
      cb(null, true);
    } else {
      cb(new Error(`File type not accepted`));
    }
  },
});

async function extractPdfText(filePath) {
  try {
    const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');
    const data = new Uint8Array(fs.readFileSync(filePath));
    const doc = await pdfjsLib.getDocument({ data }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map((item) => item.str).join(' ') + '\n';
    }
    return text.trim();
  } catch (err) {
    console.error('PDF extraction error:', err);
    return '';
  }
}

async function generateAiSummary(text, filename) {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: `Summarize the following document "${filename}" in 2-3 sentences:\n\n${text.substring(0, 4000)}`,
      }],
    });
    return response.content[0]?.text || '';
  } catch (err) {
    console.error('AI summary error:', err);
    return '';
  }
}

// Validate projectId before multer runs so it can't write to a bad path
function requireNumericProjectId(req, res, next) {
  if (!/^\d+$/.test(req.params.projectId)) return res.status(400).json({ error: 'Invalid project ID' });
  next();
}

// POST /api/files/upload/:projectId
router.post('/upload/:projectId', requireNumericProjectId, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const { projectId } = req.params;
  let extractedText = '';
  let aiSummary = '';

  const ext = path.extname(req.file.originalname).toLowerCase();
  const isPdf = req.file.mimetype === 'application/pdf' || ext === '.pdf';
  const isText = [
    'text/plain', 'text/csv', 'text/markdown', 'text/x-markdown', 'application/json'
  ].includes(req.file.mimetype) || ['.txt', '.md', '.csv', '.json'].includes(ext);

  if (isPdf) {
    extractedText = await extractPdfText(req.file.path);
    if (extractedText) {
      aiSummary = await generateAiSummary(extractedText, req.file.originalname);
    }
  } else if (isText) {
    try {
      extractedText = fs.readFileSync(req.file.path, 'utf8');
      if (extractedText) {
        aiSummary = await generateAiSummary(extractedText, req.file.originalname);
      }
    } catch (err) {
      console.error('Text file read error:', err.message);
    }
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO files ("projectId", name, size, mimetype, path, "extractedText", "aiSummary")
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [projectId, req.file.originalname, req.file.size, req.file.mimetype, req.file.path, extractedText, aiSummary]
    );
    const { rows: file } = await pool.query('SELECT * FROM files WHERE id=$1', [rows[0].id]);

    // Index for search
    await pool.query(
      'INSERT INTO search_index(type, "projectId", title, body) VALUES ($1, $2, $3, $4)',
      ['file', String(projectId), req.file.originalname, extractedText.substring(0, 1000)]
    );

    res.status(201).json(file[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/files/:projectId
router.get('/:projectId', requireNumericProjectId, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM files WHERE "projectId"=$1 ORDER BY "uploadedAt" DESC',
      [req.params.projectId]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/files/:id/pin — toggle pinned
router.patch('/:id/pin', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, pinned FROM files WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const newVal = rows[0].pinned ? 0 : 1;
    await pool.query('UPDATE files SET pinned=$1 WHERE id=$2', [newVal, req.params.id]);
    res.json({ pinned: !!newVal });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/files/:id
router.delete('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM files WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const file = rows[0];

    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    await pool.query('DELETE FROM files WHERE id=$1', [req.params.id]);
    await pool.query(`DELETE FROM search_index WHERE type='file' AND title=$1`, [file.name]);

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
