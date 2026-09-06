'use strict';

const express = require('express');
const multer  = require('multer');
const { pool } = require('../db');
const { resolveTranslateModels, getTranslateAgentCardConfig } = require('../services/translateModelResolver');
const {
  proposeGlossary,
  autoFixGlossaryDrift,
  translateParagraphBatch,
  reviewTranslation,
  applyGlossarySubstitutions,
  hardSanityGate,
  runDeterministicCompletenessCheck,
  repairIncompletePairs,
} = require('../services/translateLlmService');
const { verifyQaCategoryClaims, mergeGarbledRows, lockedDoNotTranslateTerms, enforceRedactionPassThrough, findPlaceholder, isCodeLikeArtifact, detectRepeatedTermCandidates } = require('../services/translateQaChecks');
const { isAllowedUpload, extractForTranslate, detectSourceFormat } = require('../services/translateExtract');
const {
  isGoogleTranslateConfigured,
  detectLanguage: googleDetectLanguage,
  translateTexts: googleTranslateTexts,
  wrapDoNotTranslate,
  stripDoNotTranslateSpans,
} = require('../services/googleTranslateService');
const translateMemory = require('../services/translateMemory');
const { buildNativeXlsx, buildNativeDocx } = require('../services/translateNativeOutput');
const { calculateCost } = require('../services/costCalculator');
const { getUsdToAudRate } = require('../services/marketData');
const { v4: uuidv4 } = require('uuid');

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
    const { getVaultModelsConfigForUser } = require('../services/modelResolver');
    const { models: catalog } = await getVaultModelsConfigForUser(req.user.id);
    const googleOk = isGoogleTranslateConfigured();
    const llmOk = Boolean(models.ok && models.translate?.modelId);
    res.json({
      configured: llmOk || googleOk,
      // Full connected-model catalog — lets the UI offer a per-job override instead of
      // always using the Settings-configured default.
      catalog: (catalog || []).map(m => ({ id: m.id, name: m.name || m.id, emoji: m.emoji || null, provider: m.provider || null })),
      engines: {
        llm: {
          available: llmOk,
          translateModel: models.translate?.modelId || null,
          reviewModel: models.review?.modelId || null,
          errors: models.errors || [],
        },
        google: {
          available: googleOk,
          errors: googleOk ? [] : ['GOOGLE_TRANSLATE_API_KEY not set'],
        },
      },
      // Back-compat
      engine: llmOk ? 'vault-llm' : (googleOk ? 'google' : null),
      translateModel: models.translate?.modelId || null,
      reviewModel: models.review?.modelId || null,
      errors: llmOk || googleOk ? [] : (models.errors || ['No translation engine configured']),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, configured: false });
  }
});

// ── Upfront estimate ──────────────────────────────────────────────────────────
// Extracts text only (no translation) so the user can see roughly what a job will cost/how big
// it is before submitting. Informational only — actual cost can vary with glossary/review passes.
router.post('/estimate', sourceUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required' });
  try {
    const sourceFormat = detectSourceFormat(req.file.originalname, req.file.mimetype);
    if (!sourceFormat) return res.status(400).json({ error: 'Unsupported file type' });

    const extracted = await extractForTranslate({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    const charCount = Object.values(extracted.paragraphsByPage || {})
      .flat()
      .reduce((sum, p) => sum + String(p).length, 0);

    const targetLanguages = req.body.targetLanguages
      ? (() => { try { return JSON.parse(req.body.targetLanguages); } catch { return [req.body.targetLanguages]; } })()
      : [req.body.targetLanguage].filter(Boolean);
    const languageCount = Math.max(1, targetLanguages.length);

    // Rough token estimate: ~4 chars/token in, output roughly matches input length.
    const estTokensIn = Math.ceil(charCount / 4);
    const estTokensOut = estTokensIn;

    let estCostAud = null;
    let modelId = null;
    try {
      const models = await resolveTranslateModels({ userId: req.user.id });
      modelId = models.translate?.modelId || null;
      if (modelId) {
        const perLanguageUsd = calculateCost(modelId, estTokensIn, estTokensOut);
        if (perLanguageUsd != null) {
          const usdAud = await getUsdToAudRate();
          estCostAud = Number(perLanguageUsd) * languageCount * usdAud;
        }
      }
    } catch {}

    res.json({
      sourceFormat,
      pageCount: extracted.pageCount,
      charCount,
      languageCount,
      estTokensIn: estTokensIn * languageCount,
      estTokensOut: estTokensOut * languageCount,
      estCostAud,
      currency: 'AUD',
      modelId,
      note: 'Rough estimate from character count — actual usage varies with glossary size and review pass.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
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

// Global glossary: one auto-learned glossary per (userId, targetLanguage). Looked up/created
// when a job opts in with `useGlobalGlossary`, and topped up with newly proposed/locked terms
// when that job finishes — see upsertGlobalGlossaryTerms below.
router.get('/glossaries/global/:lang', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, name, terms, "targetLanguage", "createdAt", "updatedAt",
              jsonb_array_length(terms) AS "termCount"
       FROM translate_glossaries WHERE "userId"=$1 AND "targetLanguage"=$2 AND "isGlobal"=TRUE`,
      [req.user.id, req.params.lang]
    );
    res.json(rows[0] || null);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

async function findOrCreateGlobalGlossary(userId, targetLanguage) {
  const { rows } = await pool.query(
    `SELECT * FROM translate_glossaries WHERE "userId"=$1 AND "targetLanguage"=$2 AND "isGlobal"=TRUE`,
    [userId, targetLanguage]
  );
  if (rows[0]) return rows[0];
  const inserted = await pool.query(
    `INSERT INTO translate_glossaries ("userId", name, terms, "targetLanguage", "isGlobal")
     VALUES ($1,$2,'[]',$3,TRUE) RETURNING *`,
    [userId, `Global — ${targetLanguage}`, targetLanguage]
  );
  return inserted.rows[0];
}

// Merges newly-seen glossary terms into the global glossary for a language, keyed by source
// text (case-insensitive). Existing entries win — a job's fresh proposal never overwrites a
// term the user (or a prior job) already locked in.
async function upsertGlobalGlossaryTerms(userId, targetLanguage, newTerms) {
  if (!Array.isArray(newTerms) || !newTerms.length) return;
  const glossary = await findOrCreateGlobalGlossary(userId, targetLanguage);
  const existing = Array.isArray(glossary.terms) ? glossary.terms : [];
  const bySource = new Map(existing.map((t) => [String(t.source || '').trim().toLowerCase(), t]));
  for (const t of newTerms) {
    const key = String(t?.source || '').trim().toLowerCase();
    if (!key || bySource.has(key)) continue;
    bySource.set(key, t);
  }
  await pool.query(
    `UPDATE translate_glossaries SET terms=$1, "updatedAt"=NOW() WHERE id=$2`,
    [JSON.stringify([...bySource.values()]), glossary.id]
  );
}

// ── Translation memory ──────────────────────────────────────────────────────────
router.get('/memory/stats', async (req, res) => {
  try {
    res.json(await translateMemory.stats({ userId: req.user.id }));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/memory/export.tmx', async (req, res) => {
  try {
    const tmx = await translateMemory.exportTmx({
      userId: req.user.id,
      sourceLang: req.query.sourceLang || null,
      targetLang: req.query.targetLang || null,
    });
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader('Content-Disposition', 'attachment; filename="translation-memory.tmx"');
    res.send(tmx);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Jobs ──────────────────────────────────────────────────────────────────────
router.get('/jobs', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, filename, status, stage, progress, "sourceLanguage", "targetLanguage",
              "pageCount", "scannedPageCount", "avgOcrConfidence", "glossaryId", "batchId",
              "errorMessage", "fileSizeBytes", "charCount", "qaSummaryJson",
              ("translatedFile" IS NOT NULL) AS "hasNativeOutput",
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
      `SELECT id, status, stage, progress, "sourceLanguage", "targetLanguage", "batchId",
              "pageCount", "scannedPageCount", "avgOcrConfidence", "translatedTextJson",
              "qaSummaryJson", "proposedGlossaryJson", "intakeAnswers",
              ("translatedFile" IS NOT NULL) AS "hasNativeOutput", "translatedFileName",
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

router.get('/jobs/:id/download-native', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT filename, "translatedFile", "translatedFileMime", "translatedFileName"
       FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]?.translatedFile) return res.status(404).json({ error: 'Native output not available for this job' });
    res.setHeader('Content-Type', rows[0].translatedFileMime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${rows[0].translatedFileName || 'translated-document'}"`);
    res.send(rows[0].translatedFile);
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

  const engine = String(req.body.engine || 'llm').toLowerCase() === 'google' ? 'google' : 'llm';
  const pdfLayout = ['side-by-side', 'translation-only', 'bilingual-pages'].includes(req.body.pdfLayout)
    ? req.body.pdfLayout
    : 'side-by-side';

  // Optional per-job override — lets a user pick a different model for just this job
  // without touching their Settings default. Validated against their connected catalog
  // inside resolveTranslateModels; an invalid/unknown id is silently ignored there.
  const overrides = {
    translateModelId: req.body.translateModelId ? String(req.body.translateModelId).trim() : null,
    reviewModelId: req.body.reviewModelId ? String(req.body.reviewModelId).trim() : null,
  };

  if (engine === 'google') {
    if (!isGoogleTranslateConfigured()) {
      return res.status(503).json({ error: 'Google Translate API key not configured (GOOGLE_TRANSLATE_API_KEY)' });
    }
  } else {
    const models = await resolveTranslateModels({ userId: req.user.id, overrides });
    if (!models.ok || !models.translate?.modelId) {
      return res.status(503).json({
        error: models.errors?.[0] || 'Translate model not configured — set it in Settings → Translate agent',
      });
    }
  }

  const { targetLanguage } = req.body;
  let { glossaryId } = req.body;
  if (!targetLanguage) return res.status(400).json({ error: 'targetLanguage required' });

  const useGlobalGlossary = String(req.body.useGlobalGlossary || '') === 'true';
  if (useGlobalGlossary && !glossaryId) {
    const globalGlossary = await findOrCreateGlobalGlossary(req.user.id, targetLanguage);
    glossaryId = globalGlossary.id;
  }

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

  if (engine === 'llm' && !intakeAnswers.domain) {
    return res.status(400).json({ error: 'Please answer the intake questions (domain is required)' });
  }
  if (!intakeAnswers.domain) intakeAnswers.domain = 'general';

  // Google path: QA review is optional but off by default for speed
  const enableReview = engine === 'llm'
    ? String(req.body.enableReview ?? 'true') !== 'false'
    : String(req.body.enableReview ?? 'false') === 'true';

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

  intakeAnswers.engine = engine;
  intakeAnswers.pdfLayout = pdfLayout;
  if (overrides.translateModelId) intakeAnswers.translateModelId = overrides.translateModelId;
  if (overrides.reviewModelId) intakeAnswers.reviewModelId = overrides.reviewModelId;
  if (useGlobalGlossary) intakeAnswers.useGlobalGlossary = true;

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
    { filename: req.file.originalname, mimetype: req.file.mimetype, sourceFormat, engine, pdfLayout })
    .catch(err => markJobFailed(jobId, err.message));

  res.status(202).json({ jobId, sourceFormat, engine, pdfLayout });
});

// ── Submit batch job (multi-language fan-out) ──────────────────────────────────
// Same intake as a single job, but `targetLanguages` is a JSON array. Extraction (+ OCR) runs
// once and is shared across every language instead of repeating it per job.
//
// Deprecated: target language is now a single Settings-level choice (translate_target_language),
// not picked per job, so there's no UI path left to select more than one language per run.
// Route kept (unused by the client) rather than removed, since translate_jobs."batchId" and
// existing rows still reference it — deleting it is a bigger change than this ask needs.
router.post('/jobs/batch', sourceUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required (PDF, Word .docx, or Excel .xlsx)' });

  const sourceFormat = detectSourceFormat(req.file.originalname, req.file.mimetype);
  if (!sourceFormat) {
    return res.status(400).json({ error: 'Unsupported file type. Use PDF, Word (.docx), or Excel (.xlsx/.xls).' });
  }

  let targetLanguages;
  try {
    targetLanguages = JSON.parse(req.body.targetLanguages || '[]');
  } catch {
    return res.status(400).json({ error: 'Invalid targetLanguages JSON' });
  }
  targetLanguages = [...new Set((targetLanguages || []).map((l) => String(l).trim()).filter(Boolean))];
  if (targetLanguages.length < 2) {
    return res.status(400).json({ error: 'targetLanguages needs at least 2 languages — use POST /jobs for a single language' });
  }
  if (targetLanguages.length > 8) {
    return res.status(400).json({ error: 'Maximum 8 languages per batch' });
  }

  const engine = String(req.body.engine || 'llm').toLowerCase() === 'google' ? 'google' : 'llm';
  const pdfLayout = ['side-by-side', 'translation-only', 'bilingual-pages'].includes(req.body.pdfLayout)
    ? req.body.pdfLayout
    : 'side-by-side';
  const overrides = {
    translateModelId: req.body.translateModelId ? String(req.body.translateModelId).trim() : null,
    reviewModelId: req.body.reviewModelId ? String(req.body.reviewModelId).trim() : null,
  };

  if (engine === 'google') {
    if (!isGoogleTranslateConfigured()) {
      return res.status(503).json({ error: 'Google Translate API key not configured (GOOGLE_TRANSLATE_API_KEY)' });
    }
  } else {
    const models = await resolveTranslateModels({ userId: req.user.id, overrides });
    if (!models.ok || !models.translate?.modelId) {
      return res.status(503).json({
        error: models.errors?.[0] || 'Translate model not configured — set it in Settings → Translate agent',
      });
    }
  }

  const { glossaryId } = req.body;
  let intakeAnswers = {};
  try {
    intakeAnswers = req.body.intakeAnswers
      ? (typeof req.body.intakeAnswers === 'string' ? JSON.parse(req.body.intakeAnswers) : req.body.intakeAnswers)
      : {};
  } catch {
    return res.status(400).json({ error: 'Invalid intakeAnswers JSON' });
  }
  if (engine === 'llm' && !intakeAnswers.domain) {
    return res.status(400).json({ error: 'Please answer the intake questions (domain is required)' });
  }
  if (!intakeAnswers.domain) intakeAnswers.domain = 'general';

  const enableReview = engine === 'llm'
    ? String(req.body.enableReview ?? 'true') !== 'false'
    : String(req.body.enableReview ?? 'false') === 'true';

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

  intakeAnswers.engine = engine;
  intakeAnswers.pdfLayout = pdfLayout;
  if (overrides.translateModelId) intakeAnswers.translateModelId = overrides.translateModelId;
  if (overrides.reviewModelId) intakeAnswers.reviewModelId = overrides.reviewModelId;

  const batchId = uuidv4();
  const jobIds = [];
  for (const lang of targetLanguages) {
    const { rows } = await pool.query(
      `INSERT INTO translate_jobs
         ("userId", filename, status, "targetLanguage", "fileSizeBytes", "originalPdf",
          "glossaryId", "intakeAnswers", "enableReview", "batchId")
       VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        req.user.id, req.file.originalname, lang, req.file.size, req.file.buffer,
        glossaryId ? parseInt(glossaryId, 10) : null, JSON.stringify(intakeAnswers), enableReview, batchId,
      ]
    );
    jobIds.push(rows[0].id);
  }

  const fileMeta = { filename: req.file.originalname, mimetype: req.file.mimetype, sourceFormat, engine, pdfLayout };

  // Extract once (attributed to the first job for progress display), then translate every
  // language against the shared result. Runs in the background — response returns immediately.
  (async () => {
    let sharedExtraction;
    try {
      sharedExtraction = await extractAndOcr(jobIds[0], req.file.buffer, fileMeta, scannedImages, sourceFormat);
    } catch (err) {
      await Promise.all(jobIds.map((id) => markJobFailed(id, err.message)));
      return;
    }
    await mapPool(targetLanguages, 3, async (lang, i) => {
      const jobId = jobIds[i];
      try {
        await processTranslateJob(jobId, req.file.buffer, req.user.id, lang,
          glossaryId ? parseInt(glossaryId, 10) : null, scannedImages, intakeAnswers, enableReview,
          fileMeta, sharedExtraction);
      } catch (err) {
        await markJobFailed(jobId, err.message);
      }
    });
  })().catch((err) => console.error('[translate] batch failed:', err.message));

  res.status(202).json({ batchId, jobIds, targetLanguages, sourceFormat, engine, pdfLayout });
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

/** Run async work over items with limited concurrency; preserves result order. */
async function mapPool(items, concurrency, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function run() {
    while (true) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, () => run()));
  return results;
}

/** Extraction + OCR — the part of the pipeline that doesn't depend on target language.
 *  Factored out so a multi-language fan-out batch can run it once and reuse the result for
 *  every target language instead of re-extracting (and re-OCR'ing) per language. */
async function extractAndOcr(jobId, fileBuffer, fileMeta, scannedImages, sourceFormat) {
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

  return { pageCount, paragraphsByPage, pageLabels, pageTexts, scannedPages, avgOcrConfidence };
}

async function processTranslateJob(
  jobId, fileBuffer, userId, targetLanguage, glossaryId, scannedImages, intakeAnswers, enableReview,
  fileMeta = {}, sharedExtraction = null
) {
  const engine = fileMeta.engine === 'google' ? 'google' : 'llm';
  const pdfLayout = fileMeta.pdfLayout || intakeAnswers?.pdfLayout || 'side-by-side';
  const sourceFormat = fileMeta.sourceFormat
    || detectSourceFormat(fileMeta.filename, fileMeta.mimetype)
    || 'pdf';

  let translateModelId = null;
  let reviewModelId = null;
  if (engine === 'llm') {
    const overrides = {
      translateModelId: intakeAnswers?.translateModelId || null,
      reviewModelId: intakeAnswers?.reviewModelId || null,
    };
    const models = await resolveTranslateModels({ userId, overrides });
    if (!models.ok || !models.translate?.modelId) {
      throw new Error(models.errors?.[0] || 'Translate model not configured');
    }
    translateModelId = models.translate.modelId;
    reviewModelId = models.review?.modelId || translateModelId;
  } else if (!isGoogleTranslateConfigured()) {
    throw new Error('GOOGLE_TRANSLATE_API_KEY not configured');
  }

  // ── 1-2. Extract text + OCR scanned pages (skipped when a batch already did this) ──────────
  const {
    pageCount, paragraphsByPage, pageLabels, pageTexts, scannedPages, avgOcrConfidence,
  } = sharedExtraction || await extractAndOcr(jobId, fileBuffer, fileMeta, scannedImages, sourceFormat);

  if (sharedExtraction) {
    await setJobStatus(jobId, { pageCount, scannedPageCount: scannedPages.length, avgOcrConfidence });
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

  // ── 4. Glossary + translate (engine-specific) ───────────────────────────────
  await setJobStatus(jobId, {
    status: 'preparing',
    stage: engine === 'google' ? 'Preparing glossary…' : 'Building glossary from your answers…',
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

  const mustKeep = String(intakeAnswers?.mustKeepTerms || '')
    .split(/[,;\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(source => ({ source, target: '', doNotTranslate: true, note: 'User must-keep' }));

  const mergedExisting = (() => {
    const bySource = new Map();
    for (const t of [...lockedDoNotTranslateTerms(), ...existingTerms, ...mustKeep]) {
      if (!t?.source) continue;
      const key = String(t.source).toLowerCase();
      if (!bySource.has(key)) bySource.set(key, t);
    }
    return [...bySource.values()];
  })();

  let glossaryPrep;
  let sourceLanguage = 'auto';
  let glossaryTerms = mergedExisting;

  if (engine === 'llm') {
    // Recurring defined-term candidates (Warranty Schedule, Nominated Vehicle, Period, Make…) —
    // a pure string scan, no LLM cost — passed into proposeGlossary so it can assign each a
    // canonical rendering in the SAME call instead of a separate round-trip (removes one full
    // serial LLM barrier from every job before translation starts).
    const recurringCandidates = detectRepeatedTermCandidates(paragraphsByPage, mergedExisting);
    try {
      glossaryPrep = await proposeGlossary({
        modelId: translateModelId,
        userId,
        intakeAnswers,
        sourceSkim,
        targetLanguage,
        existingTerms: mergedExisting,
        recurringCandidates,
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
    sourceLanguage = glossaryPrep.sourceLanguage || 'auto';
    glossaryTerms = glossaryPrep.terms || mergedExisting;
  } else {
    // Google: detect language + use saved/must-keep glossary only (no LLM prep)
    try {
      sourceLanguage = await googleDetectLanguage(sourceSkim);
    } catch (err) {
      console.warn('[translate] Google detect failed:', err.message);
      sourceLanguage = 'auto';
    }
    glossaryPrep = {
      sourceLanguage,
      terms: mergedExisting,
      uncertainTerms: [],
      dialectalChoices: [],
      guidance: intakeAnswers?.notes || '',
    };
  }

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
      engine,
      pdfLayout,
    }),
  });

  // ── 4b. Translation memory lookup (exact match only) ────────────────────────
  // Paragraphs already translated for this user/language pair are reused verbatim instead of
  // being re-sent to the model — saves cost on repeat boilerplate and keeps wording identical
  // across jobs. Google-engine jobs still benefit (memory is keyed by language pair, not engine).
  let tmHits = new Map();
  try {
    const allPagesForTm = Object.keys(paragraphsByPage).map(Number);
    const allTexts = allPagesForTm.flatMap((p) => paragraphsByPage[p]);
    tmHits = await translateMemory.lookupExact({
      userId, sourceLang: sourceLanguage, targetLang: targetLanguage, texts: allTexts,
    });
  } catch (err) {
    console.warn('[translate] TM lookup failed:', err.message);
  }

  // ── 5. Translate ────────────────────────────────────────────────────────────
  await setJobStatus(jobId, {
    status: 'translating',
    stage: engine === 'google' ? 'Translating with Google Translate…' : 'Translating with Vault LLM…',
    progress: 48,
  });

  const translatedByPage = {};
  const allPages = Object.keys(paragraphsByPage).map(Number).sort((a, b) => a - b);
  const reviewPairs = [];
  let chunksDone = 0;
  let totalCharCount = 0;
  let tmReuseCount = 0;

  if (engine === 'google') {
    // Larger chunks — Google is fast and accepts up to ~20 qs / ~4500 chars
    const chunks = [];
    for (const pageNum of allPages) {
      const paras = paragraphsByPage[pageNum];
      let currentChunk = { paras: [], chars: 0 };
      for (const rawPara of paras) {
        for (const para of splitLongParagraph(rawPara, 4500)) {
          if (currentChunk.paras.length >= 20 || currentChunk.chars + para.length > 4500) {
            if (currentChunk.paras.length) { chunks.push(currentChunk); currentChunk = { paras: [], chars: 0 }; }
          }
          currentChunk.paras.push({ pageNum, text: para });
          currentChunk.chars += para.length;
        }
      }
      if (currentChunk.paras.length) chunks.push(currentChunk);
    }

    for (const chunk of chunks) {
      // Leaked code/template debris (e.g. object dumps, unresolved internal
      // tokens) must never go to the translator — copy through verbatim.
      const artifactFlags = chunk.paras.map(p => isCodeLikeArtifact(p.text));
      const tmFlags = chunk.paras.map(p => tmHits.has(translateMemory.normalize(p.text)));
      const translateIdxs = chunk.paras.map((_, i) => i).filter(i => !artifactFlags[i] && !tmFlags[i]);
      const texts = translateIdxs.map(i => wrapDoNotTranslate(chunk.paras[i].text, glossaryTerms));
      totalCharCount += texts.reduce((s, t) => s + t.length, 0);
      tmReuseCount += tmFlags.filter(Boolean).length;
      // default: TM reuse where matched, else passthrough (artifacts)
      let translations = chunk.paras.map((p, i) => tmFlags[i] ? tmHits.get(translateMemory.normalize(p.text)) : p.text);
      if (texts.length) {
        try {
          let translated = await googleTranslateTexts({
            texts,
            targetLanguage,
            sourceLanguage,
          });
          translated = translated.map((t) => stripDoNotTranslateSpans(t));
          translateIdxs.forEach((chunkIdx, i) => {
            translations[chunkIdx] = enforceRedactionPassThrough(
              chunk.paras[chunkIdx].text,
              applyGlossarySubstitutions(translated[i], glossaryTerms)
            );
          });
        } catch (err) {
          console.error('[translate] Google chunk failed:', err.message);
          translateIdxs.forEach((chunkIdx) => {
            translations[chunkIdx] = `[Translation error] ${chunk.paras[chunkIdx].text}`;
          });
        }
      }

      translations.forEach((t, i) => {
        const { pageNum, text } = chunk.paras[i];
        if (!translatedByPage[pageNum]) translatedByPage[pageNum] = [];
        const idxInPage = translatedByPage[pageNum].length;
        translatedByPage[pageNum].push(t);
        reviewPairs.push({ source: text, target: t, pageNum, idxInPage });
      });

      chunksDone++;
      const pct = 48 + Math.round((chunksDone / Math.max(chunks.length, 1)) * 32);
      await setJobStatus(jobId, {
        stage: `Translating: chunk ${chunksDone} of ${chunks.length}`,
        progress: pct,
        charCount: totalCharCount,
      });
    }
  } else {
    const runningGlossary = {};
    for (const t of glossaryTerms) {
      if (t.source && t.target && !t.doNotTranslate) {
        runningGlossary[t.source] = t.target;
      }
    }

    // Chunk: ~20 paragraphs / ~8000 chars. Bigger batches = fewer round trips.
    // Parallel pool makes wall-clock closer to Google.
    // Paragraphs are pre-stitched at extraction (see translateExtract.stitchFragments) so a
    // "paragraph" here is a real sentence/field, not a layout-broken line fragment — safe to
    // batch more of them per call without reintroducing segment-boundary grammar breaks.
    const chunks = [];
    for (const pageNum of allPages) {
      const paras = paragraphsByPage[pageNum];
      let currentChunk = { paras: [], chars: 0 };
      for (const rawPara of paras) {
        for (const para of splitLongParagraph(rawPara, 8000)) {
          if (currentChunk.paras.length >= 20 || currentChunk.chars + para.length > 8000) {
            if (currentChunk.paras.length) { chunks.push(currentChunk); currentChunk = { paras: [], chars: 0 }; }
          }
          currentChunk.paras.push({ pageNum, text: para });
          currentChunk.chars += para.length;
        }
      }
      if (currentChunk.paras.length) chunks.push(currentChunk);
    }

    const LLM_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.TRANSLATE_LLM_CONCURRENCY) || 6));
    let inFlight = 0;
    const chunkResults = await mapPool(chunks, LLM_CONCURRENCY, async (chunk, chunkIndex) => {
      inFlight += 1;
      const texts = chunk.paras.map(p => p.text);
      // Leaked code/template debris (e.g. object dumps, unresolved internal
      // tokens) must never go to the translator — copy through verbatim.
      const artifactFlags = texts.map(t => isCodeLikeArtifact(t));
      const tmFlags = texts.map(t => tmHits.has(translateMemory.normalize(t)));
      const translateIdxs = texts.map((_, i) => i).filter(i => !artifactFlags[i] && !tmFlags[i]);
      tmReuseCount += tmFlags.filter(Boolean).length;
      await setJobStatus(jobId, {
        stage: `Translating: ${chunksDone} of ${chunks.length} done · ${inFlight} in flight (×${LLM_CONCURRENCY})`,
        progress: 48 + Math.round((chunksDone / Math.max(chunks.length, 1)) * 32),
      });
      // default: TM reuse where matched, else passthrough (artifacts)
      let translations = texts.map((t, i) => tmFlags[i] ? tmHits.get(translateMemory.normalize(t)) : t);
      if (translateIdxs.length) {
        try {
          const translated = await translateParagraphBatch({
            modelId: translateModelId,
            userId,
            paragraphs: translateIdxs.map(i => texts[i]),
            sourceLanguage,
            targetLanguage,
            glossaryTerms,
            guidance: glossaryPrep.guidance,
            runningGlossary,
            intakeAnswers,
            onProgress: ({ phase, n }) => {
              setJobStatus(jobId, {
                stage: `Translating chunk ${chunkIndex + 1}/${chunks.length}: ${phase || 'working'} (${n || texts.length} paras)`,
              }).catch(() => {});
            },
          });
          translateIdxs.forEach((i, j) => { translations[i] = translated[j]; });
        } catch (err) {
          console.error('[translate] chunk failed:', err.message);
          translateIdxs.forEach((i) => { translations[i] = `[Translation error] ${texts[i]}`; });
        }
      }
      inFlight -= 1;
      chunksDone += 1;
      const chars = texts.reduce((s, t) => s + t.length, 0);
      totalCharCount += chars;
      const pct = 48 + Math.round((chunksDone / Math.max(chunks.length, 1)) * 32);
      await setJobStatus(jobId, {
        stage: `Translating: ${chunksDone} of ${chunks.length} done`,
        progress: pct,
        charCount: totalCharCount,
      });
      return { chunkIndex, paras: chunk.paras, translations };
    });

    // Apply in chunk order so page paragraph order stays stable
    for (const result of chunkResults) {
      result.translations.forEach((rawT, i) => {
        const { pageNum, text } = result.paras[i];
        const t = enforceRedactionPassThrough(
          text,
          applyGlossarySubstitutions(rawT, glossaryTerms)
        );
        if (!translatedByPage[pageNum]) translatedByPage[pageNum] = [];
        const idxInPage = translatedByPage[pageNum].length;
        translatedByPage[pageNum].push(t);
        reviewPairs.push({ source: text, target: t, pageNum, idxInPage });
      });
    }
  }

  // ── 5b. Repair incomplete segments (LLM retry → Google fallback) ────────────
  const incompleteBefore = reviewPairs.filter((p) =>
    /\[\s*translation\s+(incomplete|error)\s*\]/i.test(String(p.target || '')) || !String(p.target || '').trim()
  ).length;

  let repairStats = null;
  if (incompleteBefore > 0) {
    await setJobStatus(jobId, {
      stage: `Repairing ${incompleteBefore} incomplete segment(s)…`,
      progress: 78,
    });
    const runningGlossary = {};
    for (const t of glossaryTerms) {
      if (t.source && t.target && !t.doNotTranslate) runningGlossary[t.source] = t.target;
    }
    repairStats = await repairIncompletePairs({
      pairs: reviewPairs,
      modelId: engine === 'llm' ? translateModelId : null,
      userId,
      sourceLanguage,
      targetLanguage,
      glossaryTerms,
      guidance: glossaryPrep.guidance,
      runningGlossary,
      intakeAnswers,
      allowGoogleFallback: true,
      concurrency: 3,
      onProgress: ({ done, total }) => {
        setJobStatus(jobId, {
          stage: `Repairing incomplete: ${done + 1} of ${total}`,
          progress: 78 + Math.round(((done + 1) / Math.max(total, 1)) * 4),
        }).catch(() => {});
      },
    });
    // Sync repaired targets back into translatedByPage
    for (const pair of reviewPairs) {
      if (pair.pageNum != null && pair.idxInPage != null && translatedByPage[pair.pageNum]) {
        translatedByPage[pair.pageNum][pair.idxInPage] = pair.target;
      }
    }
    console.log('[translate] repair stats', repairStats);
  }

  // ── 5c. Glossary drift: auto-fix the safe case, report the rest ─────────────
  // Chunks translate in parallel with no shared state, so a forced term (user-declared or
  // auto-locked above) can still land differently per chunk. Two passes, both pure string
  // comparison — no LLM calls:
  //  1. autoFixGlossaryDrift — the common real case (confirmed on an actual job): a chunk left
  //     the source term untranslated, verbatim, inside the target. That's mechanically fixable
  //     with a direct string replace, so we just do it instead of only flagging it.
  //  2. Whatever's left (a genuinely different wrong rendering, not a plain leftover) still can't
  //     be safely auto-corrected — surfaced in the QA summary same as before.
  let glossaryDriftTerms = [];
  let glossaryDriftAutoFixedCount = 0;
  if (engine === 'llm') {
    const { fixedCount, remainingTerms } = autoFixGlossaryDrift({ pairs: reviewPairs, glossaryTerms });
    glossaryDriftAutoFixedCount = fixedCount;
    if (fixedCount > 0) {
      // Sync fixed targets back into translatedByPage (autoFixGlossaryDrift mutated pair.target).
      for (const pair of reviewPairs) {
        if (pair.pageNum != null && pair.idxInPage != null && translatedByPage[pair.pageNum]) {
          translatedByPage[pair.pageNum][pair.idxInPage] = pair.target;
        }
      }
      console.log(`[translate] glossary drift auto-fixed ${fixedCount} occurrence(s)`);
    }
    if (remainingTerms.length) {
      glossaryDriftTerms = remainingTerms.map((t) => ({
        source: t.source,
        renderedAs: '(varies)',
        issue: `Glossary term drift: ${t.count} occurrence(s) did not match the locked rendering "${t.target}" and weren't a plain untranslated leftover, so couldn't be auto-fixed (rows ${t.examples.join(', ')}${t.count > t.examples.length ? ', …' : ''}).`,
      }));
      console.log('[translate] glossary drift remaining (not auto-fixable)', remainingTerms);
    }
  }

  // ── 6. Hard sanity gate (string logic — not an LLM) ─────────────────────────
  const gate = hardSanityGate(reviewPairs, { sourceLanguage, targetLanguage });

  // ── 7. Review pass ──────────────────────────────────────────────────────────
  let qaSummary = {
    skipped: !enableReview,
    engine,
    pdfLayout,
    uncertainTerms: [...(glossaryPrep.uncertainTerms || []), ...glossaryDriftTerms],
    dialectalChoices: glossaryPrep.dialectalChoices || [],
    guidance: glossaryPrep.guidance || '',
    glossaryTermCount: glossaryTerms.length,
    tmReuseCount,
    glossaryDriftAutoFixedCount,
    translateModel: engine === 'llm' ? translateModelId : 'google-translate-v2',
    reviewModel: enableReview ? reviewModelId : null,
    repairStats,
    maoriPolicy: String(targetLanguage || '').toLowerCase() === 'mi'
      ? (intakeAnswers?.regionalAudience
        ? `Regional adaptation for: ${intakeAnswers.regionalAudience}`
        : 'Standard te reo Māori (Te Taura Whiri)')
      : null,
    completenessCheck: {
      ran: true,
      beforeSubjectiveReview: true,
      ...gate.stats,
      autoFlagged: (gate.garbledOrIncompleteRows || []).length,
    },
    garbledOrIncompleteRows: gate.garbledOrIncompleteRows || [],
  };

  if (!gate.ok) {
    qaSummary = {
      ...qaSummary,
      skipped: true,
      hardFail: true,
      hardFailCode: gate.code,
      overallNotes: gate.message,
      garbledOrIncompleteRows: gate.garbledOrIncompleteRows || [],
    };
    qaSummary = verifyQaCategoryClaims(qaSummary, reviewPairs, { sampleSize: 8 });
    await setJobStatus(jobId, {
      status: 'failed',
      stage: 'Hard QA gate failed',
      progress: 0,
      charCount: totalCharCount,
      errorMessage: gate.message,
      qaSummaryJson: JSON.stringify(qaSummary),
      translatedTextJson: JSON.stringify({
        sourceByPage: paragraphsByPage,
        translatedByPage,
        pageCount,
        pageLabels: pageLabels || {},
        sourceFormat,
        engine,
        pdfLayout,
        scannedPages,
        avgOcrConfidence,
        qaSummary,
        glossaryTerms,
        hardFail: true,
      }),
    });
    return;
  }

  if (gate.softFail) {
    qaSummary.softFail = true;
    qaSummary.softFailCode = gate.softFailCode;
    qaSummary.overallNotes = [gate.message, qaSummary.overallNotes].filter(Boolean).join(' ');
  }
  if (enableReview && reviewPairs.length) {
    // Subjective LLM review needs a review model (even for Google translate jobs)
    if (!reviewModelId) {
      try {
        const models = await resolveTranslateModels({
          userId,
          overrides: { reviewModelId: intakeAnswers?.reviewModelId || null },
        });
        reviewModelId = models.review?.modelId || models.translate?.modelId || null;
      } catch {}
    }
    if (!reviewModelId) {
      qaSummary.skipped = true;
      qaSummary.reviewError = 'No review model configured — skipped subjective QA';
      qaSummary = verifyQaCategoryClaims(qaSummary, reviewPairs, { sampleSize: 8 });
    } else {
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
          engine,
          pdfLayout,
          uncertainTerms: [
            ...((review.uncertainTerms?.length ? review.uncertainTerms : glossaryPrep.uncertainTerms) || []),
            ...glossaryDriftTerms,
          ],
          dialectalChoices: (review.dialectalChoices?.length
            ? review.dialectalChoices
            : glossaryPrep.dialectalChoices) || [],
          garbledOrIncompleteRows: mergeGarbledRows(
            gate.garbledOrIncompleteRows,
            review.garbledOrIncompleteRows
          ),
        };
      } catch (err) {
        console.error('[translate] review failed:', err.message);
        qaSummary.reviewError = err.message;
        qaSummary.garbledOrIncompleteRows = mergeGarbledRows(
          gate.garbledOrIncompleteRows,
          qaSummary.garbledOrIncompleteRows
        );
        qaSummary = verifyQaCategoryClaims(qaSummary, reviewPairs, { sampleSize: 8 });
      }
    }
  } else {
    const det = runDeterministicCompletenessCheck(reviewPairs, { sourceLanguage, targetLanguage });
    qaSummary.garbledOrIncompleteRows = det.garbledOrIncompleteRows;
    qaSummary.completenessCheck = {
      ran: true,
      beforeSubjectiveReview: true,
      reviewSkipped: true,
      ...det.stats,
      autoFlagged: det.garbledOrIncompleteRows.length,
    };
    qaSummary = verifyQaCategoryClaims(qaSummary, reviewPairs, { sampleSize: 8 });
  }

  // ── 7b. Translation memory: save this job's pairs, bump reuse counts ────────
  try {
    await translateMemory.savePairs({
      userId, sourceLang: sourceLanguage, targetLang: targetLanguage,
      domain: intakeAnswers?.domain || null, pairs: reviewPairs,
    });
    if (tmReuseCount > 0) {
      await translateMemory.bumpHitCounts({
        userId, sourceLang: sourceLanguage, targetLang: targetLanguage,
        sources: [...tmHits.keys()],
      });
    }
  } catch (err) {
    console.warn('[translate] TM save failed:', err.message);
  }

  // ── 7c. Native (editable) output for .docx/.xlsx sources ────────────────────
  // ── 7b. Learn back into the global glossary, if this job opted in ───────────
  // Best-effort — a glossary write failure should never fail an otherwise-complete job.
  if (engine === 'llm' && intakeAnswers?.useGlobalGlossary) {
    try {
      await upsertGlobalGlossaryTerms(userId, targetLanguage, glossaryTerms);
    } catch (err) {
      console.warn('[translate] global glossary learn-back failed:', err.message);
    }
  }

  // Best-effort, alongside the always-available PDF below — never blocks the job on failure.
  let nativeOutput = null;
  try {
    if (sourceFormat === 'xlsx' || sourceFormat === 'xls') {
      const buf = buildNativeXlsx({ originalBuffer: fileBuffer, paragraphsByPage, translatedByPage, pageLabels });
      if (buf) nativeOutput = { buffer: buf, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
    } else if (sourceFormat === 'docx') {
      const sourceParagraphs = paragraphsByPage[1] || [];
      const translatedParagraphs = translatedByPage[1] || [];
      const buf = await buildNativeDocx({ originalBuffer: fileBuffer, paragraphs: sourceParagraphs, translations: translatedParagraphs });
      if (buf) nativeOutput = { buffer: buf, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    }
  } catch (err) {
    console.warn('[translate] native output build failed:', err.message);
  }
  if (nativeOutput) {
    const base = (fileMeta.filename || 'document').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    await setJobStatus(jobId, {
      translatedFile: nativeOutput.buffer,
      translatedFileMime: nativeOutput.mime,
      translatedFileName: `translated-${base}.${nativeOutput.ext}`,
    });
  }

  // ── 8. Hand off to client PDF generation ────────────────────────────────────
  await setJobStatus(jobId, {
    status: 'generating',
    stage: pdfLayout === 'translation-only'
      ? 'Generating translated PDF…'
      : pdfLayout === 'side-by-side'
        ? 'Generating side-by-side PDF…'
        : 'Generating bilingual PDF…',
    progress: 90,
    charCount: totalCharCount,
    qaSummaryJson: JSON.stringify(qaSummary),
    translatedTextJson: JSON.stringify({
      sourceByPage: paragraphsByPage,
      translatedByPage,
      pageCount,
      pageLabels: pageLabels || {},
      sourceFormat,
      engine,
      pdfLayout,
      scannedPages,
      avgOcrConfidence,
      qaSummary,
      glossaryTerms,
    }),
  });
}

module.exports = router;
