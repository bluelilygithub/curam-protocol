const express = require('express');
const multer  = require('multer');
const fetch   = require('node-fetch');
const { pool } = require('../db');

const router = express.Router();

// ── Google Translate API key check ────────────────────────────────────────────
const TRANSLATE_API_KEY = process.env.GOOGLE_TRANSLATE_API_KEY || '';
if (!TRANSLATE_API_KEY) {
  console.warn('[translate] GOOGLE_TRANSLATE_API_KEY not set — translate agent will not function');
}

// ── Tesseract worker pool (initialised once at module load) ───────────────────
let scheduler = null;
const OCR_LANGS = 'eng+fra+deu+spa+ita+por+chi_sim+jpn';

async function getScheduler() {
  if (scheduler) return scheduler;
  const { createScheduler, createWorker } = require('tesseract.js');
  scheduler = createScheduler();
  const workers = await Promise.all(
    Array.from({ length: 4 }, () => createWorker(OCR_LANGS))
  );
  workers.forEach(w => scheduler.addWorker(w));
  console.log('[translate] Tesseract worker pool ready (4 workers, langs: eng+fra+deu+spa+ita+por+chi_sim+jpn)');
  return scheduler;
}

// Initialise pool eagerly at startup (non-blocking)
getScheduler().catch(err => console.error('[translate] Tesseract init failed:', err.message));

// ── Multer — 15 MB PDF only ───────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') return cb(null, true);
    cb(new Error('Only PDF files are accepted'));
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function setJobStatus(jobId, fields) {
  const keys   = Object.keys(fields);
  const values = Object.values(fields);
  const sets   = keys.map((k, i) => `"${k}"=$${i + 2}`).join(', ');
  await pool.query(`UPDATE translate_jobs SET ${sets} WHERE id=$1`, [jobId, ...values]);
}

async function markJobFailed(jobId, message) {
  await setJobStatus(jobId, { status: 'failed', errorMessage: message, progress: 0 });
}

// ── Config endpoint ────────────────────────────────────────────────────────────
router.get('/config', (req, res) => {
  res.json({ configured: !!TRANSLATE_API_KEY });
});

// ── Glossary CRUD ─────────────────────────────────────────────────────────────
router.get('/glossaries', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, terms, "createdAt", "updatedAt",
              jsonb_array_length(terms) AS "termCount"
       FROM translate_glossaries WHERE "userId"=$1 ORDER BY name ASC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/glossaries/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM translate_glossaries WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/glossaries', async (req, res) => {
  try {
    const { name, terms = [] } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
    const { rows } = await pool.query(
      `INSERT INTO translate_glossaries ("userId", name, terms) VALUES ($1,$2,$3) RETURNING *`,
      [req.user.id, name.trim(), JSON.stringify(terms)]
    );
    res.status(201).json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/glossaries/:id', async (req, res) => {
  try {
    const { name, terms } = req.body;
    const { rows } = await pool.query(
      `UPDATE translate_glossaries SET name=$1, terms=$2, "updatedAt"=NOW()
       WHERE id=$3 AND "userId"=$4 RETURNING *`,
      [name, JSON.stringify(terms), req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/glossaries/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM translate_glossaries WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Job list ───────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, status, stage, progress, "sourceLanguage", "targetLanguage",
              "pageCount", "scannedPageCount", "avgOcrConfidence", "glossaryId",
              "errorMessage", "fileSizeBytes", "charCount", "createdAt", "completedAt"
       FROM translate_jobs WHERE "userId"=$1 ORDER BY "createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Job status (lightweight poll) ─────────────────────────────────────────────
router.get('/jobs/:id/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, status, stage, progress, "sourceLanguage", "targetLanguage",
              "pageCount", "scannedPageCount", "avgOcrConfidence", "translatedTextJson",
              "errorMessage", "completedAt"
       FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Download translated PDF ───────────────────────────────────────────────────
router.get('/jobs/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT filename, "translatedPdf" FROM translate_jobs WHERE id=$1 AND "userId"=$2 AND status='done'`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]?.translatedPdf) return res.status(404).json({ error: 'Not ready' });
    const safeName = rows[0].filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="translated-${safeName}"`);
    res.send(rows[0].translatedPdf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete job ────────────────────────────────────────────────────────────────
router.delete('/jobs/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Client reports PDF generation failure ─────────────────────────────────────
router.post('/jobs/:id/fail', async (req, res) => {
  try {
    const message = req.body?.error || (req.file ? 'Client-side generation error' : 'Unknown error');
    await setJobStatus(parseInt(req.params.id), { status: 'failed', errorMessage: message });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Complete job (client posts generated PDF) ─────────────────────────────────
router.post('/jobs/:id/complete', upload.single('translatedPdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF required' });
    await pool.query(
      `UPDATE translate_jobs
       SET "translatedPdf"=$1, status='done', progress=100, "completedAt"=NOW()
       WHERE id=$2 AND "userId"=$3`,
      [req.file.buffer, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Submit job ────────────────────────────────────────────────────────────────
router.post('/jobs', upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' });
  if (!TRANSLATE_API_KEY) return res.status(503).json({ error: 'Google Translate API key not configured' });

  const { targetLanguage, glossaryId, scannedPageImages } = req.body;
  if (!targetLanguage) return res.status(400).json({ error: 'targetLanguage required' });

  // Parse scanned page images sent by client
  let scannedImages = {};
  try { scannedImages = scannedPageImages ? JSON.parse(scannedPageImages) : {}; } catch {}

  // Reject password-protected PDFs
  const pdfParse = require('pdf-parse');
  try { await pdfParse(req.file.buffer, { max: 1 }); }
  catch (e) {
    if (e.message?.toLowerCase().includes('password')) {
      return res.status(400).json({ error: 'Password-protected PDFs cannot be processed' });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO translate_jobs ("userId", filename, status, "targetLanguage", "fileSizeBytes", "originalPdf")
     VALUES ($1,$2,'pending',$3,$4,$5) RETURNING id`,
    [req.user.id, req.file.originalname, targetLanguage, req.file.size, req.file.buffer]
  );
  const jobId = rows[0].id;

  // Fire pipeline asynchronously — do not await
  processTranslateJob(jobId, req.file.buffer, req.user.id, targetLanguage,
    glossaryId ? parseInt(glossaryId) : null, scannedImages)
    .catch(err => markJobFailed(jobId, err.message));

  res.status(202).json({ jobId });
});

// ── Pipeline ──────────────────────────────────────────────────────────────────

// Decode HTML entities returned by Google Translate (format:'html' mode)
function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, '\u00A0')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/&[a-z]+;/gi, '');
}

// Language-specific typographic corrections
function applyTypography(text, lang) {
  let t = decodeHtmlEntities(text);

  if (lang === 'fr' || lang === 'fr-CA') {
    // Convert straight double-quotes around phrases to guillemets
    t = t.replace(/"([^"]{1,200})"/g, '\u00AB\u00A0$1\u00A0\u00BB');
    // Ensure non-breaking space before :  ;  !  ?  (French typographic rule)
    t = t.replace(/\s*([;:!?])/g, '\u00A0$1');
    // Normalise currency spacing: number then space then currency symbol
    t = t.replace(/(\d)\s*\$\s*/g, '$1\u00A0$\u00A0');
  }

  return t;
}
async function processTranslateJob(jobId, pdfBuffer, userId, targetLanguage, glossaryId, scannedImages) {
  const pdfParse = require('pdf-parse');

  // ── 1. Extract text per page ────────────────────────────────────────────────
  await setJobStatus(jobId, { status: 'extracting', stage: 'Extracting text…', progress: 5 });

  const pageTexts = {};
  let pageCount = 0;

  // Use pdf-parse's pagerender callback to collect per-page text
  await pdfParse(pdfBuffer, {
    pagerender: (pageData) => {
      return pageData.getTextContent().then(tc => {
        const pageNum = pageData.pageNumber;
        pageCount = Math.max(pageCount, pageNum);
        const items = tc.items.map(item => ({
          text: item.str,
          x: Math.round(item.transform[4]),
          y: Math.round(item.transform[5]),
          w: Math.round(item.width),
          h: Math.round(item.height || 12),
        }));
        pageTexts[pageNum] = items;
        return '';
      });
    },
  });

  // Detect scanned pages (fewer than 20 chars of native text)
  const scannedPages = [];
  for (const [page, items] of Object.entries(pageTexts)) {
    const totalChars = items.reduce((s, i) => s + i.text.length, 0);
    if (totalChars < 20) scannedPages.push(parseInt(page));
  }
  // Also include any pages the client flagged
  for (const page of Object.keys(scannedImages)) {
    if (!scannedPages.includes(parseInt(page))) scannedPages.push(parseInt(page));
  }

  await setJobStatus(jobId, {
    pageCount,
    scannedPageCount: scannedPages.length,
  });

  // ── 2. OCR scanned pages ────────────────────────────────────────────────────
  let avgOcrConfidence = null;
  if (scannedPages.length > 0) {
    await setJobStatus(jobId, { status: 'ocr', stage: `OCR: 0 of ${scannedPages.length} pages`, progress: 10 });
    const sched = await getScheduler();
    const confidences = [];

    const batchSize = 4;
    for (let i = 0; i < scannedPages.length; i += batchSize) {
      const batch = scannedPages.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (pageNum) => {
          const imageData = scannedImages[String(pageNum)];
          if (!imageData) return null;
          // Strip data URL prefix if present
          const base64 = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
          const buf = Buffer.from(base64, 'base64');
          const result = await sched.addJob('recognize', buf);
          return { pageNum, text: result.data.text, confidence: result.data.confidence };
        })
      );

      for (const r of results) {
        if (!r) continue;
        confidences.push(r.confidence);
        // Replace the scanned page's text items with OCR result
        pageTexts[r.pageNum] = [{ text: r.text, x: 0, y: 0, w: 500, h: 12, ocrConfidence: r.confidence }];
      }

      const done = Math.min(i + batchSize, scannedPages.length);
      const pct  = 10 + Math.round((done / scannedPages.length) * 40);
      await setJobStatus(jobId, { stage: `OCR: ${done} of ${scannedPages.length} pages`, progress: pct });
    }

    if (confidences.length) {
      avgOcrConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length / 100;
      await setJobStatus(jobId, { avgOcrConfidence });
    }
  }

  // ── 3. Detect source language ───────────────────────────────────────────────
  await setJobStatus(jobId, { stage: 'Detecting language…', progress: 52 });
  const sampleText = Object.values(pageTexts)
    .flatMap(items => items.map(i => i.text))
    .join(' ')
    .slice(0, 500);

  let sourceLanguage = 'auto';
  try {
    const detectRes = await fetch(
      `https://translation.googleapis.com/language/translate/v2/detect?key=${TRANSLATE_API_KEY}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: sampleText }) }
    );
    const detectData = await detectRes.json();
    sourceLanguage = detectData.data?.detections?.[0]?.[0]?.language || 'auto';
  } catch {}
  await setJobStatus(jobId, { sourceLanguage });

  // ── 4. Reconstruct paragraphs per page ──────────────────────────────────────
  await setJobStatus(jobId, { stage: 'Reconstructing paragraphs…', progress: 55 });
  const paragraphsByPage = {};
  for (const [pageStr, items] of Object.entries(pageTexts)) {
    const pageNum = parseInt(pageStr);
    // Sort items top-to-bottom, left-to-right
    const sorted = [...items].sort((a, b) => (b.y - a.y) || (a.x - b.x));

    // Group into lines by Y proximity (±4px)
    const lines = [];
    for (const item of sorted) {
      if (!item.text.trim()) continue;
      const existing = lines.find(l => Math.abs(l.y - item.y) <= 4);
      if (existing) { existing.parts.push(item.text); }
      else { lines.push({ y: item.y, h: item.h || 12, parts: [item.text] }); }
    }

    // Group lines into paragraphs (gap > 1.5× line height = new paragraph)
    const paragraphs = [];
    let current = [];
    let prevY = null;
    let prevH = 12;
    for (const line of lines) {
      const lineText = line.parts.join(' ').trim();
      if (!lineText) continue;
      if (prevY !== null && Math.abs(prevY - line.y) > prevH * 1.5) {
        if (current.length) { paragraphs.push(current.join(' ')); current = []; }
      }
      current.push(lineText);
      prevY = line.y;
      prevH = line.h;
    }
    if (current.length) paragraphs.push(current.join(' '));
    paragraphsByPage[pageNum] = paragraphs.filter(p => p.length > 1);
  }

  // ── 5. Load glossary ────────────────────────────────────────────────────────
  let glossaryTerms = [];
  if (glossaryId) {
    try {
      const { rows } = await pool.query(
        `SELECT terms FROM translate_glossaries WHERE id=$1 AND "userId"=$2`,
        [glossaryId, userId]
      );
      glossaryTerms = rows[0]?.terms || [];
    } catch {}
  }

  const doNotTranslate = glossaryTerms.filter(t => t.doNotTranslate).map(t => t.source);
  const substitutions  = glossaryTerms.filter(t => !t.doNotTranslate && t.target);

  function applyGlossaryIn(text) {
    let t = text;
    for (const term of doNotTranslate) {
      const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp(escaped, 'gi'), `<span translate="no">${term}</span>`);
    }
    return t;
  }

  function applyGlossaryOut(text) {
    let t = text;
    // Strip any leftover <span translate="no"> tags
    t = t.replace(/<span translate="no">(.*?)<\/span>/gi, '$1');
    // Apply target substitutions
    for (const sub of substitutions) {
      if (!sub.source || !sub.target) continue;
      const escaped = sub.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      t = t.replace(new RegExp(escaped, 'gi'), sub.target);
    }
    return t;
  }

  // ── 6. Translate in chunks ──────────────────────────────────────────────────
  await setJobStatus(jobId, { status: 'translating', stage: 'Translating…', progress: 55 });

  const translatedByPage = {};
  const allPages = Object.keys(paragraphsByPage).map(Number).sort((a, b) => a - b);
  let chunksDone = 0;
  let totalChunks = 0;
  let totalCharCount = 0;

  // Google Translate v2 hard limit per q item is ~5000 chars.
  // Split any paragraph that exceeds 4500 chars at sentence boundaries.
  function splitLongParagraph(text, limit = 4500) {
    if (text.length <= limit) return [text];
    const pieces = [];
    // Split at sentence-ending punctuation followed by a space
    const sentences = text.match(/[^.!?]+[.!?]+[\s]*/g) || [text];
    let current = '';
    for (const s of sentences) {
      if (current.length + s.length > limit && current.length > 0) {
        pieces.push(current.trim());
        current = s;
      } else {
        current += s;
      }
    }
    if (current.trim()) pieces.push(current.trim());
    return pieces.length ? pieces : [text.slice(0, limit)];
  }

  // Flatten into chunks of max 20 paragraphs / 4500 chars total,
  // with each individual paragraph pre-split if needed.
  const chunks = [];
  for (const pageNum of allPages) {
    const paras = paragraphsByPage[pageNum];
    let currentChunk = { pages: [], paras: [], chars: 0 };
    for (const rawPara of paras) {
      const subParas = splitLongParagraph(rawPara);
      for (const para of subParas) {
        if (currentChunk.paras.length >= 20 || currentChunk.chars + para.length > 4500) {
          if (currentChunk.paras.length) { chunks.push(currentChunk); currentChunk = { pages: [], paras: [], chars: 0 }; }
        }
        currentChunk.paras.push({ pageNum, text: para });
        currentChunk.pages.push(pageNum);
        currentChunk.chars += para.length;
      }
    }
    if (currentChunk.paras.length) { chunks.push(currentChunk); currentChunk = { pages: [], paras: [], chars: 0 }; }
  }
  totalChunks = chunks.length;

  for (const chunk of chunks) {
    const qs = chunk.paras.map(p => applyGlossaryIn(p.text));
    const chunkChars = qs.reduce((s, q) => s + q.length, 0);
    try {
      const body = {
        q: qs,
        target: targetLanguage,
        format: 'html',
        ...(sourceLanguage !== 'auto' ? { source: sourceLanguage } : {}),
      };
      const tRes = await fetch(
        `https://translation.googleapis.com/language/translate/v2?key=${TRANSLATE_API_KEY}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
      const tData = await tRes.json();
      const translations = tData.data?.translations || [];

      translations.forEach((t, i) => {
        const { pageNum } = chunk.paras[i];
        if (!translatedByPage[pageNum]) translatedByPage[pageNum] = [];
        translatedByPage[pageNum].push(applyGlossaryOut(applyTypography(t.translatedText, targetLanguage)));
      });
    } catch (err) {
      // On failure, use original text as fallback
      chunk.paras.forEach(({ pageNum, text }) => {
        if (!translatedByPage[pageNum]) translatedByPage[pageNum] = [];
        translatedByPage[pageNum].push(applyGlossaryOut(applyTypography(`[Translation error] ${text}`, targetLanguage)));
      });
    }

    chunksDone++;
    totalCharCount += chunkChars;
    const pct = 55 + Math.round((chunksDone / totalChunks) * 30);
    await setJobStatus(jobId, { stage: `Translating: chunk ${chunksDone} of ${totalChunks}`, progress: pct });
  }

  // ── 7. Store translated text and signal client to generate PDF ───────────────
  await setJobStatus(jobId, {
    status: 'generating',
    stage: 'Generating bilingual PDF…',
    progress: 87,
    charCount: totalCharCount,
    translatedTextJson: JSON.stringify({
      sourceByPage: paragraphsByPage,
      translatedByPage,
      pageCount,
      scannedPages,
      avgOcrConfidence,
    }),
  });
  // Client will now poll, detect 'generating' + translatedTextJson,
  // build the PDF client-side, and POST it back via /jobs/:id/complete
}

module.exports = router;
