'use strict';

const express = require('express');
const multer  = require('multer');
const { pool } = require('../db');
const { resolveTranslateModels, getTranslateAgentCardConfig, loadCustomInstructions } = require('../services/translateModelResolver');
const {
  proposeGlossary,
  autoFixGlossaryDrift,
  autoFixPartialReoTermDrift,
  translateParagraphBatch,
  reviewTranslation,
  applyGlossarySubstitutions,
  hardSanityGate,
  runDeterministicCompletenessCheck,
  repairIncompletePairs,
  dropHallucinatedTerms,
} = require('../services/translateLlmService');
const { verifyQaCategoryClaims, mergeGarbledRows, lockedDoNotTranslateTerms, enforceRedactionPassThrough, findPlaceholder, isCodeLikeArtifact, detectRepeatedTermCandidates, detectReoTermCandidates, paragraphContainsDoNotTranslateTerm } = require('../services/translateQaChecks');
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
const sendEmail = require('../utils/sendEmail');
const draft = require('../services/translateDraft');
const styles = require('../services/translateStyles');
const { requireAdmin } = require('../middleware/auth');
const { getModelsForUser } = require('../services/modelResolver');
const {
  splitLongParagraph, mapPool, findOrCreateGlobalGlossary, upsertGlobalGlossaryTerms, applyLessons,
  savePassOne, finalizeJob, runPass, cleanRequirements, partsOf, clearStalledPasses,
} = draft;

const router = express.Router();

// ── Tesseract worker pool: started on the first scanned page, shut down when idle (services/translateOcrPool.js). It used to be built at
// boot with four workers and kept forever, which was ~575 MB of the app's resting memory. ──────────────────────────────────────────────
const { getScheduler } = require('../services/translateOcrPool');

const upload = multer({
  storage: multer.memoryStorage(),
  // Demo-scale cap — size is a poor proxy for job runtime (page/char count matters more), but
  // it's the only pre-upload signal available. 5 MB keeps worst-case text (~150-250pp) and
  // scanned (~30-60pp, OCR-bound) jobs in the few-minutes range rather than tens of minutes.
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (isAllowedUpload(file.originalname, file.mimetype)) return cb(null, true);
    cb(new Error('Only PDF, Word (.docx), Excel (.xlsx/.xls), or plain text (.txt) files are accepted'));
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
  await pool.query(`UPDATE translate_jobs SET ${sets}, "updatedAt"=NOW() WHERE id=$1`, [jobId, ...values]);
}

async function markJobFailed(jobId, message) {
  // Don't stomp a user-initiated cancellation with 'failed' — a translate/review call already
  // in flight when cancel was clicked still throws/settles normally, and its .catch shouldn't
  // overwrite the status the cancel endpoint already set.
  await pool.query(
    `UPDATE translate_jobs SET status='failed', "errorMessage"=$2, progress=0
     WHERE id=$1 AND status <> 'cancelled'`,
    [jobId, message]
  );
}

const JOB_CANCELLED = 'JOB_CANCELLED';

/** Throws if the job has been cancelled since the last checkpoint — call between pipeline
 * stages so a long-running job stops promptly instead of continuing to completion unseen. */
async function checkJobCancelled(jobId) {
  const { rows } = await pool.query(`SELECT status FROM translate_jobs WHERE id=$1`, [jobId]);
  if (rows[0]?.status === 'cancelled') throw new Error(JOB_CANCELLED);
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
      `SELECT id, name, terms, "targetLanguage", "isGlobal", "createdAt", "updatedAt",
              jsonb_array_length(terms) AS "termCount"
       FROM translate_glossaries WHERE "userId"=$1 ORDER BY "isGlobal" DESC, name ASC`,
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

// Deleting a glossary puts it in the shared recycle bin for 30 days (docs/recycle-bin.md); the reply carries the bin id for Undo.
router.delete('/glossaries/:id', async (req, res) => {
  const bin = require('../services/recycleBin');
  const { GLOSSARY_TYPE } = require('../services/recycleBin/adapters/translate');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      `SELECT * FROM translate_glossaries WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [Number(req.params.id) || 0, req.user.id]);
    const g = rows[0];
    if (!g) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'That glossary was not found' }); }
    const count = Array.isArray(g.terms) ? g.terms.length : 0;
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: GLOSSARY_TYPE, id: g.id, title: g.name,
      detail: `${count} word${count === 1 ? '' : 's'}${g.isGlobal ? ' · learned' : ''}`,
      payload: { glossary: g },
    });
    await db.query(`DELETE FROM translate_glossaries WHERE id=$1 AND "userId"=$2`, [g.id, req.user.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally { db.release(); }
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

// Cross-job drift frequency for a language — how many jobs (not rows within one job) a term has
// drifted in without ever reaching a confirmed lock. The Lessons learnt report reads this to tell
// a one-off (ignore) from a recurring pattern (worth actually fixing).
router.get('/drift-frequency/:lang', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT "termKey", term, "jobCount", "lastSeenAt" FROM translate_term_drift
       WHERE "userId"=$1 AND "targetLanguage"=$2 ORDER BY "jobCount" DESC`,
      [req.user.id, req.params.lang]
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// "Lessons learnt" — HITL picks language-specific QA findings (uncertain terms, dialectal
// choices, glossary drift) from a finished job's QA report and locks them into that language's
// global glossary, same merge behaviour as the automatic top-up above (existing entries win).
router.post('/glossaries/global/:lang/terms', async (req, res) => {
  try {
    const { terms } = req.body || {};
    if (!Array.isArray(terms) || !terms.length) {
      return res.status(400).json({ error: 'terms array is required' });
    }
    const cleanTerms = terms
      .filter((t) => t && String(t.source || '').trim())
      .map((t) => ({
        source: String(t.source).trim(),
        target: String(t.target || '').trim(),
        note: t.note ? String(t.note).trim() : undefined,
        doNotTranslate: !!t.doNotTranslate,
      }));
    if (!cleanTerms.length) return res.status(400).json({ error: 'No valid terms in request' });
    await upsertGlobalGlossaryTerms(req.user.id, req.params.lang, cleanTerms);
    const glossary = await findOrCreateGlobalGlossary(req.user.id, req.params.lang);
    res.json(glossary);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Lessons learnt audit log ──────────────────────────────────────────────────
// "Lessons learnt" writes go to two places that carry no history of their own: a growing free-
// text Settings blob (translate_custom_instructions, global — applies to every job/language) and
// a per-language learned glossary's term list (translate_glossaries, isGlobal=TRUE). This table
// is the audit trail neither of those provides: one row per applied item, with a date and the
// job it came from, so "what did we apply, and when" is answerable without reconstructing it
// from a text blob and term `note` fields.
router.get('/lessons', async (req, res) => {
  try {
    const { scope, targetLanguage, limit } = req.query;
    const where = [`"userId"=$1`];
    const params = [req.user.id];
    if (scope === 'global' || scope === 'language') {
      params.push(scope);
      where.push(`scope=$${params.length}`);
    }
    if (targetLanguage) {
      params.push(targetLanguage);
      where.push(`"targetLanguage"=$${params.length}`);
    }
    params.push(Math.min(500, Math.max(1, parseInt(limit, 10) || 200)));
    const { rows } = await pool.query(
      `SELECT id, scope, "targetLanguage", disposition, "sourceTerm", "targetTerm", detail,
              "jobId", "jobFilename", "createdAt"
       FROM translate_lessons_log WHERE ${where.join(' AND ')}
       ORDER BY "createdAt" DESC LIMIT $${params.length}`,
      params
    );
    res.json(rows);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Single endpoint for the Lessons learnt modal's "Apply selected" action — replaces two separate
// client-side calls (POST /settings + POST /glossaries/global/:lang/terms) with one request that
// also writes the audit rows, so the write and its log entry can't drift apart (e.g. a client
// crash between the two old calls used to mean an applied change with no record of it).
router.post('/lessons/apply', async (req, res) => {
  try {
    const { targetLanguage, globalLines, terms, jobId, jobFilename } = req.body || {};
    const hasLines = (Array.isArray(globalLines) ? globalLines : []).some((l) => String(l || '').trim());
    const hasTerms = (Array.isArray(terms) ? terms : []).some((t) => t && String(t.source || '').trim());
    if (!hasLines && !hasTerms) return res.status(400).json({ error: 'Nothing to apply' });
    if (hasTerms && !targetLanguage) return res.status(400).json({ error: 'targetLanguage is required to lock terms' });
    const out = await applyLessons(req.user.id, { targetLanguage, globalLines, terms, jobId, jobFilename });
    res.json({ ok: true, ...out });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── House styles (services/translateStyles.js) ────────────────────────────────
// Workspace-wide: everyone can read them (New translation offers the sets for the chosen language); only admins change or test them.
router.get('/styles', async (req, res) => {
  try {
    res.json({ sets: await styles.listSets(), budget: styles.BLOCK_CHAR_BUDGET, maxExamples: styles.MAX_EXAMPLES_PER_SET });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/styles/:setId', async (req, res) => {
  try {
    const set = await styles.getSet(req.params.setId);
    if (!set) return res.status(404).json({ error: 'That house style was not found' });
    res.json(set);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/styles', requireAdmin, async (req, res) => {
  try {
    res.status(201).json(await styles.saveSet({ body: req.body, userId: req.user.id }));
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

router.put('/styles/:setId', requireAdmin, async (req, res) => {
  try {
    const set = await styles.saveSet({ id: req.params.setId, body: req.body, userId: req.user.id });
    if (!set) return res.status(404).json({ error: 'That house style was not found' });
    res.json(set);
  } catch (err) { res.status(err.status || 500).json({ error: err.message }); }
});

// Delete: into the deleting admin's recycle bin for 30 days, with its examples.
router.delete('/styles/:setId', requireAdmin, async (req, res) => {
  const bin = require('../services/recycleBin');
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const set = await styles.getSet(req.params.setId, db);
    if (!set) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'That house style was not found' }); }
    const binId = await bin.moveToBin(db, {
      userId: req.user.id, type: 'translate-style-set', id: set.id, title: set.name,
      detail: `House style · ${set.languageCode} · ${set.examples.length} example${set.examples.length === 1 ? '' : 's'}`,
      payload: { set },
    });
    await db.query('DELETE FROM translate_style_sets WHERE id=$1', [set.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally { db.release(); }
});

// Test a set: translate each example's original (up to 10) with the set's brief, leaving that example out so the translator cannot
// copy the answer, and return each result beside the approved translation. Calls the translation model once per example (paid).
router.post('/styles/:setId/test', requireAdmin, async (req, res) => {
  try {
    const set = await styles.getSet(req.params.setId);
    if (!set) return res.status(404).json({ error: 'That house style was not found' });
    if (!set.examples.length) return res.status(400).json({ error: 'Add at least one example first.' });
    const models = await resolveTranslateModels({ userId: req.user.id });
    if (!models.ok || !models.translate?.modelId) return res.status(503).json({ error: models.errors?.[0] || 'No translation model is set up.' });
    const sample = set.examples.slice(0, styles.MAX_TEST_EXAMPLES);
    const results = await mapPool(sample, 3, async (e) => {
      const block = await styles.buildStyleBlock({ setId: set.id, targetLanguage: set.languageCode, sourceLanguage: e.originalLanguage, skipExampleId: e.id });
      try {
        const [got] = await translateParagraphBatch({
          modelId: models.translate.modelId, userId: req.user.id, paragraphs: [e.original],
          sourceLanguage: e.originalLanguage, targetLanguage: set.languageCode, glossaryTerms: [], guidance: block.text, runningGlossary: {},
          intakeAnswers: {},
        });
        return { id: e.id, originalLanguage: e.originalLanguage, original: e.original, approved: e.approved, got, examplesShown: block.used };
      } catch (err) {
        return { id: e.id, originalLanguage: e.originalLanguage, original: e.original, approved: e.approved, error: err.message };
      }
    });
    res.json({ set: { id: set.id, name: set.name, languageCode: set.languageCode }, model: models.translate.modelId, tested: results.length, total: set.examples.length, results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

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
              "updatedAt",
              (SELECT json_build_object('passNo', p."passNo", 'stage', p.stage, 'progress', p.progress)
                 FROM translate_job_passes p WHERE p."jobId" = translate_jobs.id AND p.status = 'running'
                ORDER BY p."passNo" DESC LIMIT 1) AS "runningPass",
              (SELECT MAX(p."passNo") FROM translate_job_passes p WHERE p."jobId" = translate_jobs.id) AS "passCount",
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
              "updatedAt",
              (SELECT json_build_object('passNo', p."passNo", 'stage', p.stage, 'progress', p.progress)
                 FROM translate_job_passes p WHERE p."jobId" = translate_jobs.id AND p.status = 'running'
                ORDER BY p."passNo" DESC LIMIT 1) AS "runningPass",
              (SELECT MAX(p."passNo") FROM translate_job_passes p WHERE p."jobId" = translate_jobs.id) AS "passCount",
              "errorMessage", "completedAt", "createdAt"
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

const ORIGINAL_MIME_BY_EXT = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  txt: 'text/plain',
};

// Lets a reviewer pull up the untouched source alongside the translation/QA report — useful
// for HITL sanity-checking a flagged segment against the actual source wording.
router.get('/jobs/:id/download-original', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT filename, "originalPdf" FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]?.originalPdf) return res.status(404).json({ error: 'Original file not available' });
    const filename = rows[0].filename || 'document';
    const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
    res.setHeader('Content-Type', ORIGINAL_MIME_BY_EXT[ext] || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}"`);
    res.send(rows[0].originalPdf);
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

// Plain-text export of the translation itself (not the QA report) — for a reviewer who wants to
// paste the wording somewhere else, or diff it against another tool, without opening a PDF.
// Translation-only output, one paragraph per line, page/sheet breaks marked — no source column,
// no styling. Built fresh from translatedTextJson rather than re-parsing the stored PDF, so it's
// exactly the text the PDF was generated from, unaffected by anything a PDF viewer/extractor
// does to the rendered file.
router.get('/jobs/:id/download-text', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT filename, "translatedTextJson" FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    const row = rows[0];
    if (!row?.translatedTextJson) return res.status(404).json({ error: 'Translated text not available for this job' });
    const payload = typeof row.translatedTextJson === 'string'
      ? JSON.parse(row.translatedTextJson)
      : row.translatedTextJson;
    const translatedByPage = payload?.translatedByPage || {};
    const pageLabels = payload?.pageLabels || {};
    const pageCount = payload?.pageCount || Object.keys(translatedByPage).length;
    const sourceFormat = payload?.sourceFormat || 'pdf';
    const sectionWord = sourceFormat === 'xlsx' || sourceFormat === 'xls' ? 'Sheet' : 'Page';

    const sections = [];
    for (let pg = 1; pg <= pageCount; pg++) {
      const paras = translatedByPage[pg] || translatedByPage[String(pg)] || [];
      if (!paras.length) continue;
      const label = pageLabels[pg] || pageLabels[String(pg)] || `${sectionWord} ${pg}`;
      sections.push(pageCount > 1 ? `--- ${label} ---\n\n${paras.join('\n\n')}` : paras.join('\n\n'));
    }

    const base = (row.filename || 'document').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_') || 'document';
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="translated-${base}.txt"`);
    res.send(sections.join('\n\n'));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Condensed server-side mirror of the client's buildQaReportText (TranslatePage.jsx) — same
// purpose (a plain-text QA export for HITL review) but built here so the "email the three
// documents" action doesn't need the browser to have the job open to attach it.
function buildQaReportTextServer(job, qa) {
  const lines = [];
  const push = (s = '') => lines.push(s);
  push('Translation QA Report');
  push(`File: ${job.filename || '—'}`);
  push(`Target language: ${job.targetLanguage || '—'}`);
  push(`Translate model: ${qa.translateModel || '—'} · Review model: ${qa.reviewModel || '—'}`);
  push(`Generated: ${new Date().toISOString()}`);
  push('');
  if (qa.hardFail) push(`HARD QA GATE FAILED${qa.hardFailCode ? ` (${qa.hardFailCode})` : ''}: ${qa.overallNotes || ''}`);
  else if (qa.softFail) push(`COMPLETED WITH WARNINGS${qa.softFailCode ? ` (${qa.softFailCode})` : ''}: ${qa.overallNotes || ''}`);
  else if (qa.skipped) push('Subjective review pass was skipped for this job.');
  push('');
  const sections = [
    ['Uncertain terms', qa.uncertainTerms],
    ['Dialectal choices (vs standard)', qa.dialectalChoices],
    ['Polarity / sentence-type issues', qa.polarityOrSentenceTypeIssues],
    ['Restructured sentences', qa.restructuredSentences],
    ['Garbled / incomplete rows', qa.garbledOrIncompleteRows],
    ['Audience flags', qa.audienceFlags],
  ];
  for (const [title, items] of sections) {
    push(`${title} (${Array.isArray(items) ? items.length : 0})`);
    if (!items?.length) {
      push('  None flagged');
    } else {
      for (const it of items) {
        const idx = typeof it.index === 'number' ? `#${it.index} ` : '';
        const body = it.used && it.standardForm
          ? `Used "${it.used}" (standard: "${it.standardForm}")${it.context ? ` — ${it.context}` : ''}`
          : `${it.source || it.excerpt || it.target || JSON.stringify(it)}${it.issue || it.why || it.reason ? ` — ${it.issue || it.why || it.reason}` : ''}`;
        push(`  ${idx}${body}`);
      }
    }
    push('');
  }
  return lines.join('\n');
}

// Email the original source, translated PDF, and QA report together — for handing a job's full
// output to someone who doesn't have Vault access (e.g. a client or an external reviewer).
router.post('/jobs/:id/email', async (req, res) => {
  try {
    const to = String(req.body?.to || '').trim();
    if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return res.status(400).json({ error: 'Valid recipient email required' });
    }
    const { rows } = await pool.query(
      `SELECT filename, "originalPdf", "translatedPdf", "qaSummaryJson", "targetLanguage", status
       FROM translate_jobs WHERE id=$1 AND "userId"=$2`,
      [req.params.id, req.user.id]
    );
    const job = rows[0];
    if (!job) return res.status(404).json({ error: 'Not found' });

    const base = (job.filename || 'document').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    const ext = (job.filename || '').match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() || 'pdf';
    const attachments = [];

    if (job.originalPdf) {
      attachments.push({
        filename: job.filename || `original.${ext}`,
        content: job.originalPdf,
        contentType: ORIGINAL_MIME_BY_EXT[ext] || 'application/octet-stream',
      });
    }
    if (job.translatedPdf) {
      attachments.push({
        filename: `translated-${base}.pdf`,
        content: job.translatedPdf,
        contentType: 'application/pdf',
      });
    }
    let qa = null;
    try { qa = job.qaSummaryJson ? (typeof job.qaSummaryJson === 'string' ? JSON.parse(job.qaSummaryJson) : job.qaSummaryJson) : null; } catch { qa = null; }
    if (qa) {
      attachments.push({
        filename: `check-report-${base}.txt`,
        content: Buffer.from(buildQaReportTextServer(job, qa), 'utf8'),
        contentType: 'text/plain',
      });
    }

    if (!attachments.length) {
      return res.status(400).json({ error: 'Nothing to email yet — this job has no original file, translated PDF, or QA report.' });
    }

    await sendEmail({
      to,
      subject: `Translation job: ${job.filename || 'document'}`,
      html: `<p>Attached: ${attachments.map((a) => a.filename).join(', ')}.</p>`
        + `<p style="color:#888;font-size:12px">Sent from Curam Vault — Translate agent.</p>`,
      attachments,
    });

    res.json({ ok: true, attached: attachments.map((a) => a.filename) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Deleting a translation puts it, with its files, in the shared recycle bin for 30 days (docs/recycle-bin.md); the reply carries
// the bin id for Undo. Its files live in the row, so the snapshot can be big: one too big for the bin is refused with 413 and
// `tooLarge`, and the page then asks whether to delete it for good (?forever=1).
router.delete('/jobs/:id', async (req, res) => {
  const bin = require('../services/recycleBin');
  const { JOB_TYPE, JOB_MAX_BYTES, snapshotJob } = require('../services/recycleBin/adapters/translate');
  const forever = req.query.forever === '1';
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    const { rows } = await db.query(
      `SELECT * FROM translate_jobs WHERE id=$1 AND "userId"=$2 FOR UPDATE`, [Number(req.params.id) || 0, req.user.id]);
    const job = rows[0];
    if (!job) { await db.query('ROLLBACK'); return res.status(404).json({ error: 'That translation was not found' }); }
    let binId = null;
    if (!forever) {
      try {
        binId = await bin.moveToBin(db, {
          userId: req.user.id, type: JOB_TYPE, id: job.id, title: job.filename,
          detail: `Translation into ${job.targetLanguage}${job.status === 'done' ? '' : ` · ${job.status}`}`,
          payload: snapshotJob(job, (await db.query('SELECT * FROM translate_job_passes WHERE "jobId"=$1 ORDER BY "passNo"', [job.id])).rows),
          maxBytes: JOB_MAX_BYTES,
        });
      } catch (err) {
        if (err.code !== 'TOO_LARGE') throw err;
        await db.query('ROLLBACK');
        return res.status(413).json({ error: 'This translation is too big to keep in the recycle bin.', tooLarge: true });
      }
    }
    await db.query(`DELETE FROM translate_jobs WHERE id=$1 AND "userId"=$2`, [job.id, req.user.id]);
    await db.query('COMMIT');
    res.json({ ok: true, binId, retentionDays: bin.RETENTION_DAYS });
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    res.status(500).json({ error: err.message });
  } finally { db.release(); }
});

// Cancel a running job. Marks it 'cancelled' immediately; the background pipeline checks this
// status between stages (see checkJobCancelled in processTranslateJob) and stops on its own
// next checkpoint rather than being killed mid-call — a translate/review call already in flight
// still finishes, but no further stage starts.
router.post('/jobs/:id/cancel', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE translate_jobs SET status='cancelled', "errorMessage"='Cancelled by user'
       WHERE id=$1 AND "userId"=$2 AND status NOT IN ('done', 'failed', 'cancelled', 'ready', 'generating')
       RETURNING id`,
      [req.params.id, req.user.id]
    );
    if (!rows[0]) return res.status(409).json({ error: 'Job already finished or not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:id/fail', async (req, res) => {
  try {
    const message = req.body?.error || (req.file ? 'Client-side generation error' : 'Unknown error');
    // only the job's owner can mark it failed (this used to update by id alone)
    const { rows } = await pool.query(
      `UPDATE translate_jobs SET status='failed', "errorMessage"=$3 WHERE id=$1 AND "userId"=$2 RETURNING id`,
      [parseInt(req.params.id), req.user.id, message]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:id/complete', upload.single('translatedPdf'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'PDF required' });
    await pool.query(
      `UPDATE translate_jobs
       SET "translatedPdf"=$1, status='done', progress=100, "completedAt"=NOW(), "updatedAt"=NOW()
       WHERE id=$2 AND "userId"=$3 AND status='generating' AND "translatedPdf" IS NULL`,
      [req.file.buffer, req.params.id, req.user.id]
    );
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Drafts: read, requirements, passes, keep (services/translateDraft.js) ──────
const parseJson = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);

// The translation as parts (original beside translation), the versions (passes) and the requirements. ?pass=N shows that version.
router.get('/jobs/:id/read', async (req, res) => {
  try {
    const job = await draft.loadJob(Number(req.params.id) || 0, req.user.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const payload = parseJson(job.translatedTextJson);
    if (!payload) return res.status(409).json({ error: 'This translation has no text yet.' });
    await clearStalledPasses(job.id);
    const { rows: passRows } = await pool.query(
      `SELECT "passNo", status, stage, progress, scope, "partIndexes", requirements, "changedIndexes", "errorMessage", "createdAt", "completedAt"
         FROM translate_job_passes WHERE "jobId"=$1 ORDER BY "passNo"`, [job.id]);
    const passes = passRows.length ? passRows : [{ passNo: 1, status: 'done', scope: 'all', requirements: [], createdAt: job.createdAt, completedAt: job.completedAt }];
    const currentPass = Number(payload.currentPass) || 1;
    const wanted = Number(req.query.pass) || currentPass;
    let translatedByPage = payload.translatedByPage;
    let qaSummary = parseJson(job.qaSummaryJson);
    let changedIndexes = [];
    if (wanted !== currentPass || passRows.length) {
      const { rows } = await pool.query('SELECT * FROM translate_job_passes WHERE "jobId"=$1 AND "passNo"=$2', [job.id, wanted]);
      if (rows[0]?.status === 'done') {
        if (wanted !== currentPass) {
          translatedByPage = parseJson(rows[0].translatedByPage) || translatedByPage;
          qaSummary = parseJson(rows[0].qaSummary) || qaSummary;
        }
        changedIndexes = parseJson(rows[0].changedIndexes) || [];
      } else if (wanted !== currentPass) {
        return res.status(404).json({ error: 'That version is not available.' });
      }
    }
    const intake = parseJson(job.intakeAnswers) || {};
    res.json({
      id: job.id, filename: job.filename, status: job.status, errorMessage: job.errorMessage,
      sourceLanguage: job.sourceLanguage, targetLanguage: job.targetLanguage, engine: intake.engine || payload.engine || 'llm',
      sourceFormat: payload.sourceFormat, pageLabels: payload.pageLabels || {}, pdfLayout: payload.pdfLayout,
      currentPass, viewingPass: wanted, changedIndexes,
      parts: partsOf(payload, translatedByPage).map(({ i, page, idx, source, target }) => ({ i, page, idx, source, target })),
      qaSummary, passes, requirements: cleanRequirements(intake.requirements), enableReview: !!job.enableReview,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Save the requirement list (the "remember" ticks too) without running a pass.
router.put('/jobs/:id/requirements', async (req, res) => {
  try {
    const job = await draft.loadJob(Number(req.params.id) || 0, req.user.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    const intake = parseJson(job.intakeAnswers) || {};
    intake.requirements = draft.keepAppliedMarks(intake.requirements, req.body?.requirements);
    await draft.setJob(job.id, { intakeAnswers: JSON.stringify(intake) });
    res.json({ ok: true, requirements: intake.requirements });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Run another pass: { requirements, scope: 'all' | 'parts', parts: [part numbers] }. Only on a draft, one pass at a time.
router.post('/jobs/:id/passes', async (req, res) => {
  try {
    const job = await draft.loadJob(Number(req.params.id) || 0, req.user.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.status !== 'ready') return res.status(409).json({ error: job.status === 'done' ? 'This translation has been kept. Reopen it as a draft first.' : 'This translation is not ready yet.' });
    await clearStalledPasses(job.id);
    const scope = req.body?.scope === 'parts' ? 'parts' : 'all';
    const parts = scope === 'parts' ? [...new Set((Array.isArray(req.body?.parts) ? req.body.parts : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0))].slice(0, 5000) : null;
    if (scope === 'parts' && !parts.length) return res.status(400).json({ error: 'Pick the parts to translate again first.' });
    const intake = parseJson(job.intakeAnswers) || {};
    const requirements = draft.keepAppliedMarks(intake.requirements, req.body?.requirements);
    intake.requirements = requirements;
    await draft.setJob(job.id, { intakeAnswers: JSON.stringify(intake) });
    let row;
    try {
      const { rows } = await pool.query(
        `INSERT INTO translate_job_passes ("jobId", "userId", "passNo", status, stage, progress, scope, "partIndexes", requirements)
         SELECT $1, $2, COALESCE(MAX("passNo"), 1) + 1, 'running', 'Starting…', 0, $3, $4, $5
           FROM translate_job_passes WHERE "jobId"=$1
         HAVING NOT EXISTS (SELECT 1 FROM translate_job_passes WHERE "jobId"=$1 AND status='running')
         RETURNING id, "passNo"`,
        [job.id, req.user.id, scope, parts ? JSON.stringify(parts) : null, JSON.stringify(requirements)]);
      row = rows[0];
    } catch (err) {
      if (err.code === '23505') return res.status(409).json({ error: 'Another pass has just started. Wait for it to finish.' });
      throw err;
    }
    if (!row) return res.status(409).json({ error: 'A pass is already running on this translation. Wait for it to finish.' });
    runPass(job.id, req.user.id, row.id).catch((err) => console.error('[translate] pass crashed:', err.message));
    res.status(202).json({ ok: true, passNo: row.passNo });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/jobs/:id/passes/:passNo/cancel', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE translate_job_passes SET status='cancelled', stage='Cancelled', "completedAt"=NOW()
        WHERE "jobId"=$1 AND "passNo"=$2 AND "userId"=$3 AND status='running' RETURNING id`,
      [Number(req.params.id) || 0, Number(req.params.passNo) || 0, req.user.id]);
    if (!rows[0]) return res.status(409).json({ error: 'That pass is not running.' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Keep this version: { passNo } keeps an earlier version instead of the current one. Makes the files in the background.
router.post('/jobs/:id/keep', async (req, res) => {
  try {
    const job = await draft.loadJob(Number(req.params.id) || 0, req.user.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    if (job.status !== 'ready') return res.status(409).json({ error: job.status === 'done' ? 'This translation is already kept.' : 'This translation is not ready to keep.' });
    await clearStalledPasses(job.id);
    const { rows: running } = await pool.query(`SELECT 1 FROM translate_job_passes WHERE "jobId"=$1 AND status='running'`, [job.id]);
    if (running.length) return res.status(409).json({ error: 'A pass is still running. Wait for it, or cancel it, before keeping.' });
    const passNo = req.body?.passNo ? Number(req.body.passNo) : null;
    const { rows } = await pool.query(
      `UPDATE translate_jobs SET status='generating', stage='Making the files…', "updatedAt"=NOW() WHERE id=$1 AND status='ready' RETURNING id`, [job.id]);
    if (!rows[0]) return res.status(409).json({ error: 'This translation is not ready to keep.' });
    finalizeJob(job.id, req.user.id, { passNo }).catch(() => { /* the job is back to a draft with the reason on it */ });
    res.status(202).json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Reopen a kept translation as a draft, to run more passes ("Run again"). The kept files stay until it is kept again.
router.post('/jobs/:id/reopen', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE translate_jobs SET status='ready', stage='Ready to read', "errorMessage"=NULL, "updatedAt"=NOW()
        WHERE id=$1 AND "userId"=$2 AND status='done' AND "translatedTextJson" IS NOT NULL RETURNING id, "translatedTextJson", "qaSummaryJson"`,
      [Number(req.params.id) || 0, req.user.id]);
    if (!rows[0]) return res.status(409).json({ error: 'Only a kept translation can be reopened.' });
    // A translation from before drafts existed has no pass rows: its text becomes pass 1, so passes can be compared with it.
    const { rows: has } = await pool.query('SELECT 1 FROM translate_job_passes WHERE "jobId"=$1 LIMIT 1', [rows[0].id]);
    if (!has.length) {
      const payload = parseJson(rows[0].translatedTextJson) || {};
      await savePassOne({ jobId: rows[0].id, userId: req.user.id, translatedByPage: payload.translatedByPage || {}, qaSummary: parseJson(rows[0].qaSummaryJson) || {} });
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Submit job ────────────────────────────────────────────────────────────────
router.post('/jobs', sourceUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required (PDF, Word .docx, Excel .xlsx, or .txt)' });

  const sourceFormat = detectSourceFormat(req.file.originalname, req.file.mimetype);
  if (!sourceFormat) {
    return res.status(400).json({ error: 'Unsupported file type. Use PDF, Word (.docx), Excel (.xlsx/.xls), or plain text (.txt).' });
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
  intakeAnswers.reviewBeforeKeep = String(req.body.reviewBeforeKeep ?? 'true') !== 'false';

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
// Used by "Also translate into" on New translation. With the learned glossary ticked, each language uses (and later adds to) its
// own learned glossary; a glossary picked by hand is used for every language.
router.post('/jobs/batch', sourceUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File required (PDF, Word .docx, Excel .xlsx, or .txt)' });

  const sourceFormat = detectSourceFormat(req.file.originalname, req.file.mimetype);
  if (!sourceFormat) {
    return res.status(400).json({ error: 'Unsupported file type. Use PDF, Word (.docx), Excel (.xlsx/.xls), or plain text (.txt).' });
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
  const useGlobalGlossary = String(req.body.useGlobalGlossary || '') === 'true' && !glossaryId;
  if (useGlobalGlossary) intakeAnswers.useGlobalGlossary = true;
  intakeAnswers.reviewBeforeKeep = String(req.body.reviewBeforeKeep ?? 'true') !== 'false';

  const batchId = uuidv4();
  const jobIds = [];
  const glossaryByLang = {};
  const intakeByLang = {};
  for (const lang of targetLanguages) {
    glossaryByLang[lang] = useGlobalGlossary ? (await findOrCreateGlobalGlossary(req.user.id, lang)).id : (glossaryId ? parseInt(glossaryId, 10) : null);
    intakeByLang[lang] = { ...intakeAnswers, regionalAudience: lang === 'mi' ? (intakeAnswers.regionalAudience || '') : '' };
    const { rows } = await pool.query(
      `INSERT INTO translate_jobs
         ("userId", filename, status, "targetLanguage", "fileSizeBytes", "originalPdf",
          "glossaryId", "intakeAnswers", "enableReview", "batchId")
       VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        req.user.id, req.file.originalname, lang, req.file.size, req.file.buffer,
        glossaryByLang[lang], JSON.stringify(intakeByLang[lang]), enableReview, batchId,
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
          glossaryByLang[lang], scannedImages, intakeByLang[lang], enableReview,
          fileMeta, sharedExtraction);
      } catch (err) {
        await markJobFailed(jobId, err.message);
      }
    });
  })().catch((err) => console.error('[translate] batch failed:', err.message));

  res.status(202).json({ batchId, jobIds, targetLanguages, sourceFormat, engine, pdfLayout });
});

// ── Pipeline ──────────────────────────────────────────────────────────────────
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
      await checkJobCancelled(jobId); // OCR is the slowest stage on a scanned PDF — check between batches, not just once at the end
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
        : sourceFormat === 'txt'
          ? 'Preparing text…'
          : 'Preparing spreadsheet cells…',
    progress: 38,
  });

  const sourceFullText = Object.keys(paragraphsByPage)
    .map(Number).sort((a, b) => a - b)
    .flatMap(p => paragraphsByPage[p])
    .join('\n');
  const sourceSkim = sourceFullText.slice(0, 8000);

  if (!sourceSkim.trim()) {
    throw new Error('No extractable text found in this file');
  }

  await checkJobCancelled(jobId);

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
      // Self-heals a saved/global glossary that already picked up a hallucinated term (e.g. a
      // truncated macron fragment like "ōrero" from before dropHallucinatedTerms existed in
      // proposeGlossary) — checked against the FULL document text, not the 8000-char sourceSkim
      // below, so a legitimate carried-over term late in a long document isn't wrongly dropped
      // just for falling outside that truncated preview.
      existingTerms = dropHallucinatedTerms(rows[0]?.terms || [], sourceFullText);
    } catch {}
  }

  const mustKeep = String(intakeAnswers?.mustKeepTerms || '')
    .split(/[,;\n]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(source => ({ source, target: '', doNotTranslate: true, note: 'User must-keep' }));

  // Deterministic, zero-LLM-cost — scanned from the FULL document text, not the truncated skim,
  // so a "Reo <Language>" proper noun doesn't depend on an LLM call noticing it (that dependency
  // was the actual gap behind the confirmed multi-run non-determinism — see detectReoTermCandidates).
  const reoTermCandidates = detectReoTermCandidates(sourceFullText);
  console.log('[dnt-protect] detectReoTermCandidates', {
    jobId, found: reoTermCandidates.map((t) => t.source),
  });

  const mergedExisting = (() => {
    const bySource = new Map();
    for (const t of [...lockedDoNotTranslateTerms(), ...existingTerms, ...mustKeep, ...reoTermCandidates]) {
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

  // Admin/user-authored free-text instructions from Settings → Translation — appended to the
  // guidance block every translate/repair/review call already reads, so no separate prompt
  // plumbing is needed: one setting, inherited everywhere glossaryPrep.guidance flows.
  try {
    const customInstructions = await loadCustomInstructions(userId);
    if (customInstructions) {
      glossaryPrep.guidance = [glossaryPrep.guidance, customInstructions].filter(Boolean).join('\n\n');
    }
  } catch (err) {
    console.warn('[translate] loadCustomInstructions failed:', err.message);
  }

  // House style (services/translateStyles.js): the set picked on the form, or the closest one for this language pair. Its comment
  // and approved examples go to the translator in full (not summarised), and a short note to the checker. Translation memory is
  // skipped for such a job (below), so old wording cannot bypass the examples.
  let houseStyle = null;
  try {
    let lightModel = null;
    try { lightModel = (await getModelsForUser(userId))?.light || null; } catch { lightModel = null; }
    const chosen = await styles.chooseSet({
      choice: intakeAnswers?.styleSetId, targetLanguage, sourceLanguage, sample: sourceSkim, modelId: lightModel,
    });
    if (chosen?.set) {
      const block = await styles.buildStyleBlock({ setId: chosen.set.id, targetLanguage, sourceLanguage });
      if (block.text) {
        glossaryPrep.guidance = [glossaryPrep.guidance, block.text].filter(Boolean).join('\n\n');
        houseStyle = {
          id: chosen.set.id, name: chosen.set.name, languageCode: chosen.set.languageCode, how: chosen.how,
          examplesUsed: block.used, examplesTotal: block.total, note: styles.styleNoteForReview(block.set),
        };
        intakeAnswers = { ...intakeAnswers, houseStyleNote: houseStyle.note };
        console.log('[translate] house style', { jobId, set: houseStyle.name, how: houseStyle.how, examples: `${block.used}/${block.total}` });
      }
    }
  } catch (err) {
    console.warn('[translate] house style skipped:', err.message);
  }

  await setJobStatus(jobId, {
    sourceLanguage,
    proposedGlossaryJson: JSON.stringify({
      houseStyle,
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
  //
  // SERIOUS CONFIRMED ROOT CAUSE — this is what made every one of a long series of translate-
  // pipeline fixes appear to have zero effect on repeated real-job tests: TM is keyed only by
  // (userId, sourceLang, targetLang, exact source text) — NOT by engine, model, or any code-
  // version fingerprint. The very first run of a test document (before any of these fixes
  // existed) saved its paragraph-level translations, including the wrong "Tāone Reo Māori" ->
  // "Māori Language Town" pair, into translate_memory. EVERY subsequent run of the identical
  // document hit that exact-text cache and reused the stale bad pair verbatim — completely
  // bypassing translateParagraphBatch/translateOneParagraph (hence zero [dnt-protect] batch/
  // translateOneParagraph log lines despite detectReoTermCandidates firing correctly every
  // time) — and at job completion, savePairs below wrote that same stale pair straight back,
  // re-poisoning the cache for the next run. A self-perpetuating loop no downstream translation
  // logic fix could ever break, confirmed directly from Railway job logs (jobs 91-93: identical
  // "Māori Language Town" output on every run, zero protection-path log lines each time).
  //
  // Fix: any paragraph containing a doNotTranslate term's source text is excluded from the TM
  // lookup entirely, so it always goes through the live protected translate path instead of a
  // cached pair — do-not-translate correctness is exactly the class of thing that must never be
  // served from a cache that predates whatever protection logic exists today.
  let tmHits = new Map();
  try {
    const allPagesForTm = Object.keys(paragraphsByPage).map(Number);
    const allTexts = allPagesForTm.flatMap((p) => paragraphsByPage[p])
      .filter((t) => !paragraphContainsDoNotTranslateTerm(t, glossaryTerms));
    if (!houseStyle) tmHits = await translateMemory.lookupExact({
      userId, sourceLang: sourceLanguage, targetLang: targetLanguage, texts: allTexts,
    });
  } catch (err) {
    console.warn('[translate] TM lookup failed:', err.message);
  }

  await checkJobCancelled(jobId);

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
  // auto-locked above) can still land differently per chunk. Three passes, all pure string
  // comparison — no LLM calls:
  //  1. autoFixGlossaryDrift — the common real case (confirmed on an actual job): a chunk left
  //     the source term untranslated, verbatim, inside the target. That's mechanically fixable
  //     with a direct string replace, so we just do it instead of only flagging it.
  //  2. autoFixPartialReoTermDrift — a do-not-translate term shaped "<prefix> Reo <Language>"
  //     (e.g. "Tāone Reo Māori") gets partially obeyed: prefix left alone, but the embedded
  //     "Reo <Language>" still rendered as "<Language> language" (a normal, correct translation
  //     everywhere else in the document, which is exactly why the model's prior for it is strong
  //     even inside a locked name). Confirmed on a real job, benchmarked against Google
  //     Translate on the same document — both produced the identical hybrid at the same
  //     sentence, but this pipeline additionally flip-flopped between 3 different renderings of
  //     the same term across the document, unlike Google's one (still wrong) consistent choice.
  //     This closes that consistency gap.
  //  3. Whatever's left (a genuinely different wrong rendering, not a plain leftover or a
  //     reconstructable hybrid) still can't be safely auto-corrected — surfaced in the QA
  //     summary same as before.
  let glossaryDriftTerms = [];
  let glossaryDriftAutoFixedCount = 0;
  if (engine === 'llm') {
    const { fixedCount, remainingTerms } = autoFixGlossaryDrift({ pairs: reviewPairs, glossaryTerms });
    const { fixedCount: reoFixedCount } = autoFixPartialReoTermDrift({ pairs: reviewPairs, glossaryTerms });
    glossaryDriftAutoFixedCount = fixedCount + reoFixedCount;
    if (glossaryDriftAutoFixedCount > 0) {
      // Sync fixed targets back into translatedByPage (both passes mutate pair.target).
      for (const pair of reviewPairs) {
        if (pair.pageNum != null && pair.idxInPage != null && translatedByPage[pair.pageNum]) {
          translatedByPage[pair.pageNum][pair.idxInPage] = pair.target;
        }
      }
      console.log(`[translate] glossary drift auto-fixed ${fixedCount} occurrence(s), partial-reo-term drift auto-fixed ${reoFixedCount} occurrence(s)`);
    }
    if (remainingTerms.length) {
      // NOT a new-term proposal — `t.target` is already the glossary's existing locked
      // rendering; these rows just failed to use it and weren't a plain untranslated leftover
      // (autoFixGlossaryDrift already fixed those). Row refs kept as their own field (not just
      // baked into the issue string) so the client can list them without re-parsing prose.
      glossaryDriftTerms = remainingTerms.map((t) => ({
        source: t.source,
        lockedTarget: t.target,
        rows: t.examples,
        issue: `${t.count} occurrence(s) did not match the locked rendering "${t.target}" and weren't a plain untranslated leftover, so couldn't be auto-fixed (rows ${t.examples.join(', ')}${t.count > t.examples.length ? ', …' : ''}).`,
      }));
      console.log('[translate] glossary drift remaining (not auto-fixable)', remainingTerms);
    }
  }

  // ── 6. Hard sanity gate (string logic — not an LLM) ─────────────────────────
  const gate = hardSanityGate(reviewPairs, { sourceLanguage, targetLanguage, glossaryTerms });

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
    houseStyle,
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
  await checkJobCancelled(jobId);

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
    const det = runDeterministicCompletenessCheck(reviewPairs, { sourceLanguage, targetLanguage, glossaryTerms });
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

  // ── 8. A draft to read, or kept straight away ────────────────────────────────
  // Nothing lasting is written here. Translation memory, the learned glossary, the drift tally and the files (PDF, Word/Excel) are
  // written when the person keeps a version (services/translateDraft.js finalizeJob), so a draft they reject leaves no trace. The
  // PDF is made on the server now: the page can be closed while a translation runs.
  const payload = {
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
    currentPass: 1,
    tmHitSources: [...tmHits.keys()],
  };
  await checkJobCancelled(jobId);
  await savePassOne({ jobId, userId, translatedByPage, qaSummary });
  await setJobStatus(jobId, {
    status: 'ready',
    stage: 'Ready to read',
    progress: 100,
    charCount: totalCharCount,
    qaSummaryJson: JSON.stringify(qaSummary),
    translatedTextJson: JSON.stringify(payload),
  });
  if (intakeAnswers?.reviewBeforeKeep === false) {
    // A failure leaves it as a draft with the reason on it, and Keep this version can be pressed again.
    await finalizeJob(jobId, userId).catch(() => {});
  }
}

module.exports = router;
