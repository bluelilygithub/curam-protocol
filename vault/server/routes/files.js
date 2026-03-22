'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { pool } = require('../db');
const { sanitiseCodeFile } = require('../utils/sanitiseCodeFile');
const { getModelsForUser } = require('../services/modelResolver');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const ACCEPTED_MIMES = [
  'application/pdf',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'text/plain', 'application/json', 'text/csv', 'text/markdown',
  'text/x-markdown',
  // Code files — browsers may send various MIME types for these
  'text/javascript', 'application/javascript', 'text/typescript',
  'text/css', 'text/html', 'text/x-python', 'text/x-php',
  'application/x-sh', 'text/x-shellscript', 'application/sql', 'text/x-sql',
  // Office / spreadsheet formats
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',     // .xlsx
  'application/vnd.ms-excel',                                               // .xls
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/msword',                                                      // .doc
  'application/vnd.openxmlformats-officedocument.presentationml.presentation', // .pptx
  'application/vnd.ms-powerpoint',                                           // .ppt
  'application/vnd.oasis.opendocument.spreadsheet',                          // .ods
  'application/vnd.oasis.opendocument.text',                                 // .odt
];

const ACCEPTED_EXTENSIONS = [
  '.pdf', '.jpg', '.jpeg', '.png', '.gif', '.webp',
  '.txt', '.json', '.csv', '.md',
  '.xlsx', '.xls', '.docx', '.doc', '.pptx', '.ppt', '.ods', '.odt',
];

// Code file extensions — stored as .txt on disk; original name preserved in DB
const CODE_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx', '.php', '.py', '.css', '.html', '.sql', '.sh'];
// .json already handled by ACCEPTED_EXTENSIONS; .env.example matched by filename suffix

const CODE_SIZE_LIMIT = 500 * 1024; // 500 KB

function isCodeFile(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  return CODE_EXTENSIONS.includes(ext) || file.originalname.toLowerCase().endsWith('.env.example');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
    const dir = path.join(uploadDir, String(req.params.projectId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (isCodeFile(file)) {
      // Append .txt so the file is never stored with an executable extension
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${unique}-${safe}.txt`);
    } else {
      cb(null, `${unique}-${file.originalname}`);
    }
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const nameLower = file.originalname.toLowerCase();

    // Explicitly block bare .env files (secrets)
    if (ext === '.env' || nameLower === '.env' || nameLower.endsWith('/.env')) {
      return cb(new Error('File type not accepted'));
    }

    if (isCodeFile(file)) return cb(null, true);

    if (ACCEPTED_MIMES.includes(file.mimetype) || ACCEPTED_EXTENSIONS.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not accepted`));
    }
  },
});

function extractXlsxText(filePath) {
  try {
    const XLSX = require('xlsx');
    const workbook = XLSX.readFile(filePath);
    const parts = [];
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet, { skipHidden: true });
      if (csv.trim()) {
        parts.push(`## Sheet: ${sheetName}\n${csv}`);
      }
    }
    return parts.join('\n\n');
  } catch (err) {
    console.error('XLSX extraction error:', err);
    return '';
  }
}

async function extractWordText(filePath) {
  try {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value.trim();
  } catch (err) {
    console.error('Word extraction error:', err);
    return '';
  }
}

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
      model: (await getModelsForUser(req.user?.id)).light,
      max_tokens: 500,
      store: false,
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
  let storedMimetype = req.file.mimetype;

  const ext = path.extname(req.file.originalname).toLowerCase();
  const isPdf = req.file.mimetype === 'application/pdf' || ext === '.pdf';
  const isText = [
    'text/plain', 'text/csv', 'text/markdown', 'text/x-markdown', 'application/json'
  ].includes(req.file.mimetype) || ['.txt', '.md', '.csv', '.json'].includes(ext);
  const isSpreadsheet = ['.xlsx', '.xls', '.ods'].includes(ext);
  const isWord = ['.docx', '.doc'].includes(ext);
  const isCode = isCodeFile(req.file);

  if (isCode) {
    // Enforce 500 KB hard limit for code files
    if (req.file.size > CODE_SIZE_LIMIT) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Code files must be under 500KB to prevent context overflow.' });
    }

    // Validate UTF-8 — reject binary files even if they have a code extension
    let rawContent;
    try {
      rawContent = fs.readFileSync(req.file.path, 'utf8');
    } catch {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'File must be valid UTF-8 text. Binary files are not accepted.' });
    }

    // Sanitise prompt injection attempts
    const { sanitised, injectionFound, removedCount } = sanitiseCodeFile(rawContent, req.file.originalname);
    if (injectionFound) {
      console.warn(`[files] Prompt injection patterns removed from "${req.file.originalname}": ${removedCount} line(s)`);
      fs.writeFileSync(req.file.path, sanitised, 'utf8');
    }

    extractedText = sanitised;
    storedMimetype = 'text/plain'; // Never store code files under an executable MIME type
    if (extractedText) {
      aiSummary = await generateAiSummary(extractedText, req.file.originalname);
    }
  } else if (isPdf) {
    extractedText = await extractPdfText(req.file.path);
    if (extractedText) {
      aiSummary = await generateAiSummary(extractedText, req.file.originalname);
    }
  } else if (isSpreadsheet) {
    extractedText = extractXlsxText(req.file.path);
    if (extractedText) {
      aiSummary = await generateAiSummary(extractedText, req.file.originalname);
    }
  } else if (isWord) {
    extractedText = await extractWordText(req.file.path);
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
      [projectId, req.file.originalname, req.file.size, storedMimetype, req.file.path, extractedText, aiSummary]
    );
    const fileId = rows[0].id;

    // ── RAG: chunk and embed the extracted text ────────────────────────────────
    if (extractedText) {
      if (!process.env.GEMINI_API_KEY) {
        console.warn('[files] GEMINI_API_KEY not set — skipping RAG chunking for:', req.file.originalname);
      } else {
        try {
          const { chunkText } = require('../services/chunker');
          const { embedText } = require('../services/embeddings');
          const chunks = chunkText(extractedText);
          let embeddedCount = 0;
          for (let i = 0; i < chunks.length; i++) {
            const embedding = await embedText(chunks[i]);
            if (embedding) {
              await pool.query(
                `INSERT INTO file_chunks (file_id, project_id, chunk_index, chunk_text, embedding)
                 VALUES ($1, $2, $3, $4, $5::vector)`,
                [fileId, projectId, i, chunks[i], `[${embedding.join(',')}]`]
              );
              embeddedCount++;
            }
          }
          console.log(`[files] RAG: ${embeddedCount}/${chunks.length} chunks embedded for "${req.file.originalname}"`);
        } catch (ragErr) {
          console.error('[files] RAG chunking/embedding error (upload continues):', ragErr.message);
        }
      }
    }

    // Anthropic Files API — upload PDFs for persistent cross-session file references
    const isPdf = storedMimetype === 'application/pdf' ||
                  path.extname(req.file.originalname).toLowerCase() === '.pdf';
    if (isPdf && process.env.ANTHROPIC_API_KEY) {
      try {
        console.log('[files] Uploading to Anthropic Files API:', req.file.originalname);
        const fileStream = fs.createReadStream(req.file.path);
        const anthropicFile = await anthropic.beta.files.upload({
          file: await Anthropic.toFile(fileStream, req.file.originalname, { type: 'application/pdf' }),
        });
        console.log('[files] Anthropic Files API upload success, file_id:', anthropicFile.id);
        await pool.query('UPDATE files SET "anthropicFileId"=$1 WHERE id=$2', [anthropicFile.id, fileId]);
      } catch (anthropicErr) {
        console.error('[files] Anthropic Files API upload failed:', anthropicErr.message, anthropicErr.status);
      }
    } else {
      console.log('[files] Skipping Anthropic Files API upload — isPdf:', isPdf, 'hasKey:', !!process.env.ANTHROPIC_API_KEY);
    }

    const { rows: file } = await pool.query('SELECT * FROM files WHERE id=$1', [fileId]);

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

// GET /api/files/:id/raw — serve raw binary for client-side preview (pdfjs-dist etc.)
router.get('/:id/raw', async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: 'Invalid file ID' });
  try {
    const { rows } = await pool.query('SELECT path, mimetype, name FROM files WHERE id=$1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    const { path: filePath, mimetype, name } = rows[0];
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not on disk' });
    res.setHeader('Content-Type', mimetype || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(name)}"`);
    fs.createReadStream(filePath).pipe(res);
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
    // file_chunks rows are cascade-deleted via the FK on files(id)
    await pool.query('DELETE FROM files WHERE id=$1', [req.params.id]);
    await pool.query(`DELETE FROM search_index WHERE type='file' AND title=$1`, [file.name]);

    // Best-effort cleanup from Anthropic Files API
    if (file.anthropicFileId && process.env.ANTHROPIC_API_KEY) {
      try {
        await anthropic.beta.files.del(file.anthropicFileId);
      } catch (anthropicErr) {
        console.warn('[files] Anthropic Files API delete failed:', anthropicErr.message);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
