'use strict';

const express = require('express');
const multer  = require('multer');
const { pool } = require('../db');
const { resolveTranslateModels, getTranslateAgentCardConfig } = require('../services/translateModelResolver');
const {
  proposeGlossary,
  translateParagraphBatch,
  reviewTranslation,
  applyGlossarySubstitutions,
} = require('../services/translateLlmService');
const { isAllowedUpload, extractForTranslate, detectSourceFormat } = require('../services/translateExtract');

const router = express.Router();

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
  console.log('[translate] Tesseract worker pool ready (4 workers)');
  return scheduler;
}

getScheduler().catch(err => console.error('[translate] Tesseract init failed:', err.message));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedUpload(file.originalname, file.mimetype)) return cb(null, true);
    cb(new Error('Only PDF, Word (.docx), or Excel (.xlsx/.xls) files are accepted'));
  },
});

/** Accept either `file` (preferred) or legacy `pdf` field name. */
function sourceUpload(req, res, next) {
  upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'pdf', maxCount: 1 },
  ])(req, res, (err) => {
    if (err) return next(err);
    req.file = req.files?.file?.[0] || req.files?.pdf?.[0] || null;
    next();
  });
}

async function setJobStatus(jobId, fields) {
  const keys   = Object.keys(fields);
  const values = Object.values(fields);
  const sets   = keys.map((k, i) => `"${k}"=$${i + 2}`).join(', ');
  await pool.query(`UPDATE translate_jobs SET ${sets} WHERE id=$1`, [jobId, ...values]);
}

async function markJobFailed(jobId, message) {
  await setJobStatus(jobId, { status: 'failed', errorMessage: message, progress: 0 });
}

// ── Config ────────────────────────────────────────────────────────────────────
router.get('/config', async (req, res) => {
  try {
    const models = await resolveTranslateModels({ userId: req.user.id });
    res.json({
      configured: models.ok,
      engine: 'vault-llm',
      translateModel: models.translate?.modelId || null,
      reviewModel: models.review?.modelId || null,
      errors: models.errors || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message, configured: false });
  }
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

// ── Jobs ──────────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, status, stage, progress, "sourceLanguage", "targetLanguage",
              "pageCount", "scannedPageCount", "avgOcrConfidence", "glossaryId",
              "errorMessage", "fileSizeBytes", "charCount", "qaSummaryJson",
              "createdAt", "completedAt"
       FROM translate_jobs WHERE "userId"=$1 ORDER BY "createdAt" DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/:id/status', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, status, stage, progress, "sourceLanguage", "targetLanguage",
              "pageCount", "scannedPageCount", "avgOcrConfidence", "translatedTextJson",
              "qaSummaryJson", "proposedGlossaryJson", "intakeAnswers",
              "errorMessage", "completedAt"
       FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/jobs/:id/download', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT filename, "translatedPdf" FROM translate_jobs WHERE id=$1 AND "userId"=$2 AND status='done'`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]?.translatedPdf) return res.status(404).json({ error: 'Not ready' });
    const base = rows[0].filename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'document';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="translated-${base}.pdf"`);
    res.send(rows[0].translatedPdf);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/jobs/:id', async (req, res) => {
  try {
    await pool.query(
      `DELETE FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    res.status(204).end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:id/fail', async (req, res) => {
  try {
    const message = req.body?.error || (req.file ? 'Client-side generation error' : 'Unknown error');
    await setJobStatus(parseInt(req.params.id), { status: 'failed', errorMessage: message });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
router.post('/jobs', sourceUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required (PDF, Word .docx, or Excel .xlsx)' });

  const sourceFormat = detectSourceFormat(req.file.originalname, req.file.mimetype);
  if (!sourceFormat) {
    return res.status(400).json({ error: 'Unsupported file type. Use PDF, Word (.docx), or Excel (.xlsx/.xls).' });
  }

  const models = await resolveTranslateModels({ userId: req.user.id });
  if (!models.ok || !models.translate?.modelId) {
    return res.status(503).json({
      error: models.errors?.[0] || 'Translate model not configured — set it in Settings → Translate agent',
    });
  }

  const { targetLanguage, glossaryId } = req.body;
  if (!targetLanguage) return res.status(400).json({ error: 'targetLanguage required' });

  let intakeAnswers = {};
  try {
    intakeAnswers = req.body.intakeAnswers
      ? (typeof req.body.intakeAnswers === 'string'
        ? JSON.parse(req.body.intakeAnswers)
        : req.body.intakeAnswers)
      : {};
  } catch {
    return res.status(400).json({ error: 'Invalid intakeAnswers JSON' });
  }

  if (!intakeAnswers.domain) {
    return res.status(400).json({ error: 'Please answer the intake questions (domain is required)' });
  }

  const enableReview = String(req.body.enableReview ?? 'true') !== 'false';

  let scannedImages = {};
  try { scannedImages = req.body.scannedPageImages ? JSON.parse(req.body.scannedPageImages) : {}; } catch {}

  if (sourceFormat === 'pdf') {
    const pdfParse = require('pdf-parse');
    try { await pdfParse(req.file.buffer, { max: 1 }); }
    catch (e) {
      if (e.message?.toLowerCase().includes('password')) {
        return res.status(400).json({ error: 'Password-protected PDFs cannot be processed' });
      }
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO translate_jobs
       ("userId", filename, status, "targetLanguage", "fileSizeBytes", "originalPdf",
        "glossaryId", "intakeAnswers", "enableReview")
     VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8) RETURNING id`,
    [
      req.user.id,
      req.file.originalname,
      targetLanguage,
      req.file.size,
      req.file.buffer,
      glossaryId ? parseInt(glossaryId, 10) : null,
      JSON.stringify(intakeAnswers),
      enableReview,
    ]
  );
  const jobId = rows[0].id;

  processTranslateJob(jobId, req.file.buffer, req.user.id, targetLanguage,
    glossaryId ? parseInt(glossaryId, 10) : null, scannedImages, intakeAnswers, enableReview,
    { filename: req.file.originalname, mimetype: req.file.mimetype, sourceFormat })
    .catch(err => markJobFailed(jobId, err.message));

  res.status(202).json({ jobId, sourceFormat });
});

// ── Pipeline ──────────────────────────────────────────────────────────────────
function splitLongParagraph(text, limit = 3500) {
  if (text.length <= limit) return [text];
  const pieces = [];
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

async function processTranslateJob(
  jobId, fileBuffer, userId, targetLanguage, glossaryId, scannedImages, intakeAnswers, enableReview,
  fileMeta = {}
) {
  const models = await resolveTranslateModels({ userId });
  if (!models.ok || !models.translate?.modelId) {
    throw new Error(models.errors?.[0] || 'Translate model not configured');
  }
  const translateModelId = models.translate.modelId;
  const reviewModelId = models.review?.modelId || translateModelId;
  const sourceFormat = fileMeta.sourceFormat
    || detectSourceFormat(fileMeta.filename, fileMeta.mimetype)
    || 'pdf';

  // ── 1. Extract text ─────────────────────────────────────────────────────────
  await setJobStatus(jobId, { status: 'extracting', stage: 'Extracting text…', progress: 5 });

  let extracted;
  try {
    extracted = await extractForTranslate({
      buffer: fileBuffer,
      filename: fileMeta.filename || 'upload.pdf',
      mimetype: fileMeta.mimetype,
    });
  } catch (err) {
    throw new Error(err.message || 'Failed to extract text from file');
  }

  let { pageCount, paragraphsByPage, pageLabels } = extracted;
  const pageTexts = extracted.pageTexts || {};

  const scannedPages = [];
  if (sourceFormat === 'pdf') {
    for (const page of extracted.scannedCandidatePages || []) scannedPages.push(page);
    for (const page of Object.keys(scannedImages)) {
      const n = parseInt(page, 10);
      if (!scannedPages.includes(n)) scannedPages.push(n);
    }
  }

  await setJobStatus(jobId, { pageCount, scannedPageCount: scannedPages.length });

  // ── 2. OCR scanned pages (PDF only) ─────────────────────────────────────────
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
          const base64 = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
          const buf = Buffer.from(base64, 'base64');
          const result = await sched.addJob('recognize', buf);
          return { pageNum, text: result.data.text, confidence: result.data.confidence };
        })
      );
      for (const r of results) {
        if (!r) continue;
        confidences.push(r.confidence);
        // Rebuild paragraphs for OCR page from raw text
        const paras = String(r.text || '')
          .split(/\n{2,}/)
          .map((p) => p.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim())
          .filter((p) => p.length > 1);
        paragraphsByPage[r.pageNum] = paras.length
          ? paras
          : (r.text.trim() ? [r.text.trim()] : []);
        pageTexts[r.pageNum] = [{ text: r.text, x: 0, y: 0, w: 500, h: 12, ocrConfidence: r.confidence }];
      }
      const done = Math.min(i + batchSize, scannedPages.length);
      const pct  = 10 + Math.round((done / scannedPages.length) * 25);
      await setJobStatus(jobId, { stage: `OCR: ${done} of ${scannedPages.length} pages`, progress: pct });
    }
    if (confidences.length) {
      avgOcrConfidence = confidences.reduce((a, b) => a + b, 0) / confidences.length / 100;
      await setJobStatus(jobId, { avgOcrConfidence });
    }
  }

  // PDF path already built paragraphs in extract; non-PDF likewise.
  // Ensure every page has an entry.
  if (sourceFormat === 'pdf' && Object.keys(paragraphsByPage).length === 0 && Object.keys(pageTexts).length) {
    // Fallback: should not normally happen — extract already builds paragraphs
  }

  await setJobStatus(jobId, {
    stage: sourceFormat === 'pdf'
      ? 'Reconstructing paragraphs…'
      : sourceFormat === 'docx'
        ? 'Preparing Word document text…'
        : 'Preparing spreadsheet cells…',
    progress: 38,
  });

  const sourceSkim = Object.keys(paragraphsByPage)
    .map(Number).sort((a, b) => a - b)
    .flatMap(p => paragraphsByPage[p])
    .join('\n')
    .slice(0, 8000);

  if (!sourceSkim.trim()) {
    throw new Error('No extractable text found in this file');
  }

  // ── 4. Load saved glossary + LLM propose ────────────────────────────────────
  await setJobStatus(jobId, {
    status: 'preparing',
    stage: 'Building glossary from your answers…',
    progress: 42,
  });

  let existingTerms = [];
  if (glossaryId) {
    try {
      const { rows } = await pool.query(
        `SELECT terms FROM translate_glossaries WHERE id=$1 AND "userId"=$2`,
        [glossaryId, userId]
      );
      existingTerms = rows[0]?.terms || [];
    } catch {}
  }

  // Honour must-keep terms from intake as DNT
  const mustKeep = String(intakeAnswers?.mustKeepTerms || '')
    .split(/[,;\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(source => ({ source, target: '', doNotTranslate: true, note: 'User must-keep' }));

  const mergedExisting = [...existingTerms, ...mustKeep];

  let glossaryPrep;
  try {
    glossaryPrep = await proposeGlossary({
      modelId: translateModelId,
      userId,
      intakeAnswers,
      sourceSkim,
      targetLanguage,
      existingTerms: mergedExisting,
    });
  } catch (err) {
    console.error('[translate] glossary prep failed:', err.message);
    glossaryPrep = {
      sourceLanguage: 'auto',
      terms: mergedExisting,
      uncertainTerms: [],
      guidance: intakeAnswers?.notes || '',
    };
  }

  const sourceLanguage = glossaryPrep.sourceLanguage || 'auto';
  const glossaryTerms = glossaryPrep.terms || mergedExisting;

  if ((sourceFormat === 'xlsx' || sourceFormat === 'xls') && glossaryPrep.guidance != null) {
    glossaryPrep.guidance = [
      glossaryPrep.guidance,
      'Spreadsheet cells are prefixed with [A1]-style refs — keep that prefix unchanged; translate only the cell text after it.',
    ].filter(Boolean).join('\n');
  }

  await setJobStatus(jobId, {
    sourceLanguage,
    proposedGlossaryJson: JSON.stringify({
      terms: glossaryTerms,
      uncertainTerms: glossaryPrep.uncertainTerms || [],
      dialectalChoices: glossaryPrep.dialectalChoices || [],
      guidance: glossaryPrep.guidance || '',
    }),
  });

  // ── 5. Translate with Vault LLM ─────────────────────────────────────────────
  await setJobStatus(jobId, { status: 'translating', stage: 'Translating with Vault LLM…', progress: 48 });

  const translatedByPage = {};
  const allPages = Object.keys(paragraphsByPage).map(Number).sort((a, b) => a - b);
  const runningGlossary = {};
  for (const t of glossaryTerms) {
    if (t.source && t.target && !t.doNotTranslate) {
      runningGlossary[t.source] = t.target;
    }
  }

  // Chunk: max ~6 paragraphs / ~3500 chars for LLM context quality
  const chunks = [];
  for (const pageNum of allPages) {
    const paras = paragraphsByPage[pageNum];
    let currentChunk = { paras: [], chars: 0 };
    for (const rawPara of paras) {
      for (const para of splitLongParagraph(rawPara)) {
        if (currentChunk.paras.length >= 6 || currentChunk.chars + para.length > 3500) {
          if (currentChunk.paras.length) { chunks.push(currentChunk); currentChunk = { paras: [], chars: 0 }; }
        }
        currentChunk.paras.push({ pageNum, text: para });
        currentChunk.chars += para.length;
      }
    }
    if (currentChunk.paras.length) chunks.push(currentChunk);
  }

  let chunksDone = 0;
  let totalCharCount = 0;
  const reviewPairs = [];

  for (const chunk of chunks) {
    const texts = chunk.paras.map(p => p.text);
    totalCharCount += texts.reduce((s, t) => s + t.length, 0);
    let translations;
    try {
      translations = await translateParagraphBatch({
        modelId: translateModelId,
        userId,
        paragraphs: texts,
        sourceLanguage,
        targetLanguage,
        glossaryTerms,
        guidance: glossaryPrep.guidance,
        runningGlossary,
        intakeAnswers,
      });
    } catch (err) {
      console.error('[translate] chunk failed:', err.message);
      translations = texts.map(t => `[Translation error] ${t}`);
    }

    translations.forEach((rawT, i) => {
      const { pageNum, text } = chunk.paras[i];
      const t = applyGlossarySubstitutions(rawT, glossaryTerms);
      if (!translatedByPage[pageNum]) translatedByPage[pageNum] = [];
      translatedByPage[pageNum].push(t);
      reviewPairs.push({ source: text, target: t });
    });

    chunksDone++;
    const pct = 48 + Math.round((chunksDone / Math.max(chunks.length, 1)) * 32);
    await setJobStatus(jobId, {
      stage: `Translating: chunk ${chunksDone} of ${chunks.length}`,
      progress: pct,
      charCount: totalCharCount,
    });
  }

  // ── 6. Review pass ──────────────────────────────────────────────────────────
  let qaSummary = {
    skipped: !enableReview,
    uncertainTerms: glossaryPrep.uncertainTerms || [],
    dialectalChoices: glossaryPrep.dialectalChoices || [],
    guidance: glossaryPrep.guidance || '',
    glossaryTermCount: glossaryTerms.length,
    translateModel: translateModelId,
    reviewModel: reviewModelId,
    maoriPolicy: String(targetLanguage || '').toLowerCase() === 'mi'
      ? (intakeAnswers?.regionalAudience
        ? `Regional adaptation for: ${intakeAnswers.regionalAudience}`
        : 'Standard te reo Māori (Te Taura Whiri)')
      : null,
  };

  if (enableReview && reviewPairs.length) {
    await setJobStatus(jobId, {
      status: 'reviewing',
      stage: 'Review pass (QA)…',
      progress: 82,
    });
    try {
      const review = await reviewTranslation({
        modelId: reviewModelId,
        userId,
        sourceLanguage,
        targetLanguage,
        pairs: reviewPairs,
        glossaryTerms,
        intakeAnswers,
      });
      qaSummary = {
        ...qaSummary,
        skipped: false,
        ...review,
        uncertainTerms: (review.uncertainTerms?.length
          ? review.uncertainTerms
          : glossaryPrep.uncertainTerms) || [],
        dialectalChoices: (review.dialectalChoices?.length
          ? review.dialectalChoices
          : glossaryPrep.dialectalChoices) || [],
      };
    } catch (err) {
      console.error('[translate] review failed:', err.message);
      qaSummary.reviewError = err.message;
    }
  }

  // ── 7. Hand off to client PDF generation ────────────────────────────────────
  await setJobStatus(jobId, {
    status: 'generating',
    stage: 'Generating bilingual PDF…',
    progress: 90,
    charCount: totalCharCount,
    qaSummaryJson: JSON.stringify(qaSummary),
    translatedTextJson: JSON.stringify({
      sourceByPage: paragraphsByPage,
      translatedByPage,
      pageCount,
      pageLabels: pageLabels || {},
      sourceFormat,
      scannedPages,
      avgOcrConfidence,
      qaSummary,
      glossaryTerms,
    }),
  });
}

module.exports = router;
