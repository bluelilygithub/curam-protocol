'use strict';

// Translate drafts: what happens after the translation itself. A finished translation is a DRAFT (status 'ready'): it can be read on
// the page, re-run in "passes" with requirements the person adds, and nothing is committed until they press "Keep this version".
// Keeping (finalizeJob) is what writes to the lasting places: translation memory, the learned glossary, the rules and words the person
// ticked "remember", the term-drift tally, and the files (PDF, Word/Excel). A job started with "Let me read it first" off is kept
// straight away by the pipeline. See docs/translate-agent.md "Drafts, passes and Keep".
//
// Pass 1 is the pipeline's own result. Every pass is a row in translate_job_passes with its whole translation and its check results,
// so earlier versions can be read and compared; the job row always holds the version being worked on.

const { pool } = require('../db');
const {
  translateParagraphBatch, reviewTranslation, applyGlossarySubstitutions, hardSanityGate, runDeterministicCompletenessCheck,
  repairIncompletePairs, autoFixGlossaryDrift, autoFixPartialReoTermDrift,
} = require('./translateLlmService');
const { enforceRedactionPassThrough, isCodeLikeArtifact, mergeGarbledRows } = require('./translateQaChecks');
const {
  isGoogleTranslateConfigured, translateTexts: googleTranslateTexts, wrapDoNotTranslate, stripDoNotTranslateSpans,
} = require('./googleTranslateService');
const { resolveTranslateModels } = require('./translateModelResolver');
const translateMemory = require('./translateMemory');
const { buildNativeXlsx, buildNativeDocx } = require('./translateNativeOutput');
const { buildTranslatedPdf } = require('./translatePdfServer');

const parse = (v) => (typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v);
const PASS_STALL_MINUTES = 30;
const MAX_REQUIREMENTS = 40;

// ── Small shared helpers (moved here from routes/translate.js, which uses them too) ─────────────────────────────────────────────────

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

/**
 * The translation as numbered parts: [{ i, page, idx, source, target }]. The pipeline splits a long paragraph into pieces (at 8000
 * characters for Vault AI, 4500 for Google) and stores one translation per piece, so the same split here lines the original up with
 * its translation. `i` is the same 0-based index the checks use for a row.
 */
function partsOf(payload, translatedByPage = payload?.translatedByPage) {
  const limit = payload?.engine === 'google' ? 4500 : 8000;
  const src = payload?.sourceByPage || {};
  const trn = translatedByPage || {};
  const pages = [...new Set([...Object.keys(src), ...Object.keys(trn)].map(Number))].filter(Number.isFinite).sort((a, b) => a - b);
  const parts = [];
  for (const page of pages) {
    const pieces = (src[page] || src[String(page)] || []).flatMap((p) => splitLongParagraph(String(p ?? ''), limit));
    const targets = trn[page] || trn[String(page)] || [];
    const n = Math.max(pieces.length, targets.length);
    for (let idx = 0; idx < n; idx++) {
      parts.push({ i: parts.length, page, idx, source: pieces[idx] ?? '', target: targets[idx] ?? '' });
    }
  }
  return parts;
}

// ── Glossary helpers (moved from routes/translate.js) ───────────────────────────────────────────────────────────────────────────────

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

// Cross-job drift tracking — see translate_term_drift in db.js. Only terms that DIDN'T reach a confirmed lock (no proposedTarget, or
// the '(varies)' placeholder) are worth tracking: a term that failed once is noise, one that recurs across jobs is a real pattern.
async function recordTermDrift(userId, targetLanguage, uncertainTerms, jobId) {
  const terms = (uncertainTerms || []).filter((t) => t?.source && (!t.proposedTarget || t.proposedTarget === '(varies)'));
  if (!terms.length) return;
  const seen = new Set();
  for (const t of terms) {
    const key = String(t.source).trim().toLowerCase();
    if (!key || seen.has(key)) continue; // one bump per job even if the term drifted on several rows
    seen.add(key);
    await pool.query(
      `INSERT INTO translate_term_drift ("userId", "targetLanguage", "termKey", term, "jobCount", "lastJobId", "lastSeenAt")
       VALUES ($1,$2,$3,$4,1,$5,NOW())
       ON CONFLICT ("userId", "targetLanguage", "termKey")
       DO UPDATE SET "jobCount"=translate_term_drift."jobCount"+1, "lastJobId"=$5, "lastSeenAt"=NOW(), term=$4`,
      [userId, targetLanguage, key, t.source, jobId]
    );
  }
}

// Merges newly-seen glossary terms into the global glossary for a language, keyed by source text (case-insensitive). Existing entries
// win, unless `overwrite` is set (a word the person fixed on purpose replaces the earlier rendering).
async function upsertGlobalGlossaryTerms(userId, targetLanguage, newTerms, { overwrite = false } = {}) {
  if (!Array.isArray(newTerms) || !newTerms.length) return;
  const glossary = await findOrCreateGlobalGlossary(userId, targetLanguage);
  const existing = Array.isArray(glossary.terms) ? glossary.terms : [];
  const bySource = new Map(existing.map((t) => [String(t.source || '').trim().toLowerCase(), t]));
  for (const t of newTerms) {
    const key = String(t?.source || '').trim().toLowerCase();
    if (!key || (bySource.has(key) && !overwrite)) continue;
    bySource.set(key, t);
  }
  await pool.query(
    `UPDATE translate_glossaries SET terms=$1, "updatedAt"=NOW() WHERE id=$2`,
    [JSON.stringify([...bySource.values()]), glossary.id]
  );
}

/**
 * Save rules (every future translation, every language) and words (one language's learned glossary), with a row each in the
 * lessons log. Used by Lessons learnt and by Keep for the requirements ticked "remember".
 */
async function applyLessons(userId, { targetLanguage, globalLines, terms, jobId, jobFilename, overwriteTerms = false }) {
  const cleanGlobalLines = (Array.isArray(globalLines) ? globalLines : []).map((l) => String(l || '').trim()).filter(Boolean);
  const cleanTerms = (Array.isArray(terms) ? terms : [])
    .filter((t) => t && String(t.source || '').trim())
    .map((t) => ({
      source: String(t.source).trim(),
      target: String(t.target || '').trim(),
      note: t.note ? String(t.note).trim() : undefined,
      doNotTranslate: !!t.doNotTranslate,
      disposition: t.disposition || 'Lock rendering',
    }));
  if (!cleanGlobalLines.length && !cleanTerms.length) return { globalApplied: 0, termsApplied: 0 };
  if (cleanTerms.length && !targetLanguage) throw Object.assign(new Error('targetLanguage is required to lock terms'), { status: 400 });

  const logRows = [];
  if (cleanGlobalLines.length) {
    const { rows } = await pool.query(`SELECT value FROM settings WHERE "userId"=$1 AND key='translate_custom_instructions'`, [userId]);
    const existing = rows[0]?.value || '';
    const merged = [existing, cleanGlobalLines.map((l) => `- ${l}`).join('\n')].filter(Boolean).join('\n\n');
    await pool.query(
      `INSERT INTO settings ("userId", key, value) VALUES ($1, 'translate_custom_instructions', $2)
       ON CONFLICT ("userId", key) DO UPDATE SET value=EXCLUDED.value`,
      [userId, merged]
    );
    for (const line of cleanGlobalLines) {
      logRows.push({ scope: 'global', targetLanguage: null, disposition: 'Global rule', sourceTerm: null, targetTerm: null, detail: line });
    }
  }
  if (cleanTerms.length) {
    await upsertGlobalGlossaryTerms(userId, targetLanguage, cleanTerms, { overwrite: overwriteTerms });
    for (const t of cleanTerms) {
      logRows.push({
        scope: 'language', targetLanguage, disposition: t.disposition,
        sourceTerm: t.source, targetTerm: t.doNotTranslate ? '(do not translate)' : t.target,
        detail: t.note || `${t.source} → ${t.doNotTranslate ? 'do not translate' : t.target}`,
      });
    }
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of logRows) {
      await client.query(
        `INSERT INTO translate_lessons_log
           ("userId", scope, "targetLanguage", disposition, "sourceTerm", "targetTerm", detail, "jobId", "jobFilename")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [userId, r.scope, r.targetLanguage, r.disposition, r.sourceTerm, r.targetTerm, r.detail,
          jobId ? parseInt(jobId, 10) : null, jobFilename || null]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  return { globalApplied: cleanGlobalLines.length, termsApplied: cleanTerms.length };
}

// ── Requirements ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A requirement the person adds for the next pass: a rule ("use the formal 'vous'") or a word ("Tier" → "Palier", or keep "Curam" as
 * written). `remember` saves it for future translations when the version is kept; `applied` marks one already saved, so a re-kept
 * translation does not save it twice.
 */
function cleanRequirements(list) {
  const out = [];
  for (const r of Array.isArray(list) ? list.slice(0, MAX_REQUIREMENTS) : []) {
    if (!r || typeof r !== 'object') continue;
    const id = String(r.id || '').slice(0, 40) || Math.random().toString(36).slice(2, 10);
    const remember = !!r.remember;
    const applied = !!r.applied;
    if (r.kind === 'word') {
      const source = String(r.source || '').trim().slice(0, 200);
      const keep = !!r.keep;
      const target = keep ? '' : String(r.target || '').trim().slice(0, 200);
      if (!source || (!keep && !target)) continue;
      out.push({ id, kind: 'word', source, target, keep, remember, applied });
    } else {
      const text = String(r.text || '').trim().slice(0, 600);
      if (!text) continue;
      out.push({ id, kind: 'rule', text, remember, applied });
    }
  }
  return out;
}

/** A list sent by the page, with the "already saved" marks the server holds kept: an older copy of the list on a page that was open
 * during a keep must not undo them (the requirement would then be saved a second time). */
function keepAppliedMarks(previous, next) {
  const saved = new Set(cleanRequirements(previous).filter((r) => r.applied).map((r) => r.id));
  return cleanRequirements(next).map((r) => (saved.has(r.id) ? { ...r, applied: true } : r));
}

/** The job's glossary for a pass: the terms it was translated with, with the person's word requirements laid over them. */
function glossaryWithRequirements(glossaryTerms, requirements) {
  const bySource = new Map((glossaryTerms || []).filter((t) => t?.source).map((t) => [String(t.source).toLowerCase(), t]));
  for (const r of requirements.filter((x) => x.kind === 'word')) {
    bySource.set(r.source.toLowerCase(), { source: r.source, target: r.keep ? '' : r.target, doNotTranslate: r.keep, note: 'Requirement for this translation' });
  }
  return [...bySource.values()];
}

function guidanceWithRequirements(guidance, requirements) {
  const rules = requirements.filter((r) => r.kind === 'rule').map((r) => `- ${r.text}`);
  const words = requirements.filter((r) => r.kind === 'word').map((r) => (r.keep ? `- Leave "${r.source}" exactly as written.` : `- Always translate "${r.source}" as "${r.target}".`));
  if (!rules.length && !words.length) return guidance || '';
  return [guidance || '', `The person reading this translation asked for these changes. Follow them exactly; they override anything above:\n${[...rules, ...words].join('\n')}`]
    .filter(Boolean).join('\n\n');
}

// ── Job and pass storage ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function setJob(jobId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `"${k}"=$${i + 2}`).join(', ');
  await pool.query(`UPDATE translate_jobs SET ${sets}${keys.length ? ', ' : ''}"updatedAt"=NOW() WHERE id=$1`, [jobId, ...Object.values(fields)]);
}

async function setPass(passId, fields) {
  const keys = Object.keys(fields);
  const sets = keys.map((k, i) => `"${k}"=$${i + 2}`).join(', ');
  await pool.query(`UPDATE translate_job_passes SET ${sets} WHERE id=$1`, [passId, ...Object.values(fields)]);
}

/** Pass 1: the pipeline's own result, so it can be compared with later passes. */
async function savePassOne({ jobId, userId, translatedByPage, qaSummary }) {
  await pool.query(
    `INSERT INTO translate_job_passes ("jobId", "userId", "passNo", status, progress, scope, requirements, "translatedByPage", "qaSummary", "completedAt")
     VALUES ($1,$2,1,'done',100,'all','[]',$3,$4,NOW())
     ON CONFLICT ("jobId", "passNo") DO UPDATE SET "translatedByPage"=EXCLUDED."translatedByPage", "qaSummary"=EXCLUDED."qaSummary"`,
    [jobId, userId, JSON.stringify(translatedByPage || {}), JSON.stringify(qaSummary || {})]
  );
}

/** A pass left 'running' by a server restart would block every later pass: after 30 minutes it is marked as stopped. */
async function clearStalledPasses(jobId) {
  await pool.query(
    `UPDATE translate_job_passes SET status='failed', "errorMessage"='Stopped part-way (the server restarted). Run the pass again.'
     WHERE "jobId"=$1 AND status='running' AND "createdAt" < NOW() - ($2 || ' minutes')::interval`,
    [jobId, String(PASS_STALL_MINUTES)]
  );
}

async function loadJob(jobId, userId) {
  const { rows } = await pool.query('SELECT * FROM translate_jobs WHERE id=$1 AND "userId"=$2', [jobId, userId]);
  return rows[0] || null;
}

// ── Keep this version ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Commit a draft: write translation memory, the learned glossary, the remembered requirements and the drift tally, then make the
 * files. `passNo` keeps an earlier pass instead of the current one. On failure the job goes back to 'ready' with the reason, so Keep
 * can be pressed again; nothing that was written before the failure is undone (each write is safe to repeat).
 */
async function finalizeJob(jobId, userId, { passNo = null } = {}) {
  const job = await loadJob(jobId, userId);
  if (!job) throw Object.assign(new Error('Not found'), { status: 404 });
  const payload = parse(job.translatedTextJson);
  if (!payload) throw new Error('This translation has no text to keep.');
  let qa = parse(job.qaSummaryJson) || {};
  if (passNo) {
    const { rows } = await pool.query('SELECT * FROM translate_job_passes WHERE "jobId"=$1 AND "passNo"=$2', [jobId, passNo]);
    const pass = rows[0];
    if (!pass || pass.status !== 'done') throw Object.assign(new Error('That version is not available.'), { status: 409 });
    payload.translatedByPage = parse(pass.translatedByPage) || payload.translatedByPage;
    qa = parse(pass.qaSummary) || qa;
    payload.currentPass = Number(passNo);
  }
  payload.qaSummary = qa;
  const intake = parse(job.intakeAnswers) || {};
  const engine = intake.engine === 'google' ? 'google' : 'llm';
  const targetLanguage = job.targetLanguage;
  const sourceLanguage = job.sourceLanguage || 'auto';

  try {
    await setJob(jobId, {
      status: 'generating', stage: 'Making the files…', progress: 95, errorMessage: null,
      translatedTextJson: JSON.stringify(payload), qaSummaryJson: JSON.stringify(qa),
    });

    // Translation memory: the kept version's pairs, so the next document reuses exactly this wording.
    const pairs = partsOf(payload).map((p) => ({ source: p.source, target: p.target }));
    try {
      await translateMemory.savePairs({ userId, sourceLang: sourceLanguage, targetLang: targetLanguage, domain: intake.domain || null, pairs });
      if (Array.isArray(payload.tmHitSources) && payload.tmHitSources.length) {
        await translateMemory.bumpHitCounts({ userId, sourceLang: sourceLanguage, targetLang: targetLanguage, sources: payload.tmHitSources });
      }
    } catch (err) { console.warn('[translate] TM save failed:', err.message); }

    // Learn back into the language's learned glossary, if this job uses it.
    if (engine === 'llm' && intake.useGlobalGlossary) {
      try { await upsertGlobalGlossaryTerms(userId, targetLanguage, payload.glossaryTerms || []); }
      catch (err) { console.warn('[translate] global glossary learn-back failed:', err.message); }
    }

    // The requirements ticked "remember", not saved before.
    const requirements = cleanRequirements(intake.requirements);
    const toSave = requirements.filter((r) => r.remember && !r.applied);
    if (toSave.length) {
      await applyLessons(userId, {
        targetLanguage,
        globalLines: toSave.filter((r) => r.kind === 'rule').map((r) => r.text),
        terms: toSave.filter((r) => r.kind === 'word').map((r) => ({
          source: r.source, target: r.target, doNotTranslate: r.keep,
          disposition: r.keep ? 'Do-not-translate rule' : 'Lock rendering',
          note: `From a requirement on "${job.filename}"`,
        })),
        jobId, jobFilename: job.filename, overwriteTerms: true,
      });
      for (const r of requirements) if (toSave.some((s) => s.id === r.id)) r.applied = true;
      intake.requirements = requirements;
      await setJob(jobId, { intakeAnswers: JSON.stringify(intake) });
    }

    recordTermDrift(userId, targetLanguage, qa.uncertainTerms, jobId)
      .catch((err) => console.error('[translate] recordTermDrift failed:', err.message));

    // Editable Word/Excel copy (best effort: the PDF is always made).
    const sourceFormat = payload.sourceFormat || 'pdf';
    let native = null;
    try {
      if (job.originalPdf && (sourceFormat === 'xlsx' || sourceFormat === 'xls')) {
        const buf = buildNativeXlsx({ originalBuffer: job.originalPdf, paragraphsByPage: payload.sourceByPage, translatedByPage: payload.translatedByPage, pageLabels: payload.pageLabels });
        if (buf) native = { buffer: buf, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: 'xlsx' };
      } else if (job.originalPdf && sourceFormat === 'docx') {
        const buf = await buildNativeDocx({
          originalBuffer: job.originalPdf,
          paragraphs: payload.sourceByPage?.[1] || payload.sourceByPage?.['1'] || [],
          translations: payload.translatedByPage?.[1] || payload.translatedByPage?.['1'] || [],
        });
        if (buf) native = { buffer: buf, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
      }
    } catch (err) { console.warn('[translate] native output build failed:', err.message); }
    const base = (job.filename || 'document').replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');

    const pdf = await buildTranslatedPdf(payload, { sourceLanguage, targetLanguage, engine });
    await setJob(jobId, {
      status: 'done', stage: 'Kept', progress: 100, completedAt: new Date(), translatedPdf: pdf,
      translatedFile: native ? native.buffer : null,
      translatedFileMime: native ? native.mime : null,
      translatedFileName: native ? `translated-${base}.${native.ext}` : null,
    });
  } catch (err) {
    console.error('[translate] keep failed:', err.message);
    await setJob(jobId, { status: 'ready', stage: 'Ready to read', progress: 100, errorMessage: `The files could not be made: ${err.message}. Press Keep this version to try again.` });
    throw err;
  }
}

// ── Another pass ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Remove check findings that are about the parts a pass re-translated (they are checked again); keep the rest. */
function keepFindingsOutside(prevQa, selectedParts) {
  const idx = new Set(selectedParts.map((p) => p.i));
  const texts = selectedParts.flatMap((p) => [p.source, p.target]).filter(Boolean);
  const touches = (item) => {
    if (typeof item?.index === 'number') return idx.has(item.index);
    const probe = [item?.source, item?.target, item?.excerpt, item?.sourceExcerpt, item?.targetExcerpt, item?.used]
      .filter((s) => typeof s === 'string' && s.trim().length > 2);
    return probe.some((s) => texts.some((t) => t.includes(s) || s.includes(t)));
  };
  const out = {};
  for (const key of ['uncertainTerms', 'restructuredSentences', 'polarityOrSentenceTypeIssues', 'garbledOrIncompleteRows', 'audienceFlags', 'dialectalChoices']) {
    out[key] = (Array.isArray(prevQa?.[key]) ? prevQa[key] : []).filter((item) => !touches(item));
  }
  return out;
}

/**
 * Re-translate the whole document, or the parts picked, with the requirements, and check the result. The job keeps showing the
 * version before until the pass succeeds; a failed or cancelled pass changes nothing.
 */
async function runPass(jobId, userId, passId) {
  const { rows: passRows } = await pool.query('SELECT * FROM translate_job_passes WHERE id=$1 AND "userId"=$2', [passId, userId]);
  const pass = passRows[0];
  const job = await loadJob(jobId, userId);
  if (!pass || !job) return;
  const passNo = pass.passNo;
  const stopped = async () => {
    const { rows } = await pool.query('SELECT status FROM translate_job_passes WHERE id=$1', [passId]);
    return rows[0]?.status === 'cancelled';
  };

  try {
    const payload = parse(job.translatedTextJson);
    if (!payload) throw new Error('This translation has no text to work from.');
    const intake = parse(job.intakeAnswers) || {};
    const proposed = parse(job.proposedGlossaryJson) || {};
    const prevQa = parse(job.qaSummaryJson) || {};
    const requirements = cleanRequirements(parse(pass.requirements));
    const targetLanguage = job.targetLanguage;
    const sourceLanguage = job.sourceLanguage || 'auto';
    const glossaryTerms = glossaryWithRequirements(payload.glossaryTerms, requirements);
    const guidance = guidanceWithRequirements(proposed.guidance, requirements);

    const parts = partsOf(payload);
    const wanted = pass.scope === 'parts' ? new Set((parse(pass.partIndexes) || []).map(Number)) : null;
    const selected = parts.filter((p) => !wanted || wanted.has(p.i));
    if (!selected.length) throw new Error('No parts were picked for this pass.');

    // Vault AI follows requirements; Google Translate cannot take instructions, so a Google job uses Vault AI for its passes when
    // a model is set up, and otherwise only the word requirements can apply.
    let models = null;
    try { models = await resolveTranslateModels({ userId }); } catch { models = null; }
    const llmModel = models?.ok ? models.translate?.modelId : null;
    const engineUsed = llmModel ? 'llm' : (isGoogleTranslateConfigured() ? 'google' : null);
    if (!engineUsed) throw new Error('No translator is set up, so another pass cannot run.');
    const reviewModel = models?.review?.modelId || llmModel || null;

    await setPass(passId, { stage: `Translating ${selected.length} part${selected.length === 1 ? '' : 's'}…`, progress: 10 });

    const runningGlossary = {};
    for (const t of glossaryTerms) if (t.source && t.target && !t.doNotTranslate) runningGlossary[t.source] = t.target;

    const work = selected.filter((p) => !isCodeLikeArtifact(p.source));
    const chunks = [];
    let current = [];
    let chars = 0;
    const limit = engineUsed === 'google' ? 4500 : 8000;
    const maxParas = 20;
    for (const p of work) {
      if (current.length && (current.length >= maxParas || chars + p.source.length > limit)) { chunks.push(current); current = []; chars = 0; }
      current.push(p);
      chars += p.source.length;
    }
    if (current.length) chunks.push(current);

    const newTargets = new Map(); // part index -> new target
    let done = 0;
    await mapPool(chunks, engineUsed === 'llm' ? 6 : 2, async (chunk) => {
      if (await stopped()) return;
      let translated;
      try {
        if (engineUsed === 'llm') {
          translated = await translateParagraphBatch({
            modelId: llmModel, userId, paragraphs: chunk.map((p) => p.source), sourceLanguage, targetLanguage,
            glossaryTerms, guidance, runningGlossary, intakeAnswers: intake,
          });
        } else {
          translated = (await googleTranslateTexts({ texts: chunk.map((p) => wrapDoNotTranslate(p.source, glossaryTerms)), targetLanguage, sourceLanguage }))
            .map((t) => stripDoNotTranslateSpans(t));
        }
      } catch (err) {
        console.error('[translate] pass chunk failed:', err.message);
        translated = chunk.map((p) => `[Translation error] ${p.source}`);
      }
      chunk.forEach((p, k) => newTargets.set(p.i, enforceRedactionPassThrough(p.source, applyGlossarySubstitutions(translated[k] ?? '', glossaryTerms))));
      done += 1;
      await setPass(passId, { stage: `Translating: ${done} of ${chunks.length} done`, progress: 10 + Math.round((done / chunks.length) * 60) });
    });
    if (await stopped()) return;

    // The whole document as it will be after this pass (unpicked parts keep the version before).
    const pairs = parts.map((p) => ({ source: p.source, target: newTargets.has(p.i) ? newTargets.get(p.i) : p.target, pageNum: p.page, idxInPage: p.idx, i: p.i }));
    const selectedPairs = pairs.filter((p) => newTargets.has(p.i));

    const incomplete = selectedPairs.filter((p) => /\[\s*translation\s+(incomplete|error)\s*\]/i.test(String(p.target || '')) || !String(p.target || '').trim());
    if (incomplete.length) {
      await setPass(passId, { stage: `Repairing ${incomplete.length} part${incomplete.length === 1 ? '' : 's'}…`, progress: 72 });
      await repairIncompletePairs({
        pairs: selectedPairs, modelId: engineUsed === 'llm' ? llmModel : null, userId, sourceLanguage, targetLanguage,
        glossaryTerms, guidance, runningGlossary, intakeAnswers: intake, allowGoogleFallback: true, concurrency: 3,
      });
    }
    if (engineUsed === 'llm') {
      autoFixGlossaryDrift({ pairs, glossaryTerms });
      autoFixPartialReoTermDrift({ pairs, glossaryTerms });
    }
    if (await stopped()) return;

    const gate = hardSanityGate(pairs, { sourceLanguage, targetLanguage, glossaryTerms });
    if (!gate.ok) throw new Error(`The new version failed the basic checks, so the version before is kept. ${gate.message || ''}`.trim());

    // Checks: the whole document after a whole-document pass; only the re-translated parts after a parts pass (findings about the
    // other parts are carried over from the version before).
    await setPass(passId, { stage: 'Checking…', progress: 80 });
    const reviewWanted = !!job.enableReview && !!reviewModel;
    const base = {
      engine: engineUsed, pdfLayout: payload.pdfLayout, passNo, scope: pass.scope, requirements,
      translateModel: engineUsed === 'llm' ? llmModel : 'google-translate-v2', reviewModel: reviewWanted ? reviewModel : null,
      glossaryTermCount: glossaryTerms.length, guidance, maoriPolicy: prevQa.maoriPolicy || null,
      completenessCheck: { ran: true, beforeSubjectiveReview: true, ...gate.stats, autoFlagged: (gate.garbledOrIncompleteRows || []).length },
    };
    let qa;
    if (pass.scope !== 'parts') {
      if (reviewWanted) {
        const review = await reviewTranslation({ modelId: reviewModel, userId, sourceLanguage, targetLanguage, pairs, glossaryTerms, intakeAnswers: intake });
        qa = { ...base, skipped: false, ...review, garbledOrIncompleteRows: mergeGarbledRows(gate.garbledOrIncompleteRows, review.garbledOrIncompleteRows) };
      } else {
        const det = runDeterministicCompletenessCheck(pairs, { sourceLanguage, targetLanguage, glossaryTerms });
        qa = { ...base, skipped: true, uncertainTerms: [], garbledOrIncompleteRows: det.garbledOrIncompleteRows };
      }
    } else {
      const carried = keepFindingsOutside(prevQa, parts.filter((p) => newTargets.has(p.i)));
      let fresh = {};
      if (reviewWanted && selectedPairs.length) {
        const review = await reviewTranslation({ modelId: reviewModel, userId, sourceLanguage, targetLanguage, pairs: selectedPairs, glossaryTerms, intakeAnswers: intake });
        // The review numbers the parts it was given from 0: put the document's own numbers back.
        fresh = { ...review, garbledOrIncompleteRows: (review.garbledOrIncompleteRows || []).map((r) => (typeof r?.index === 'number' && selectedPairs[r.index] ? { ...r, index: selectedPairs[r.index].i } : r)) };
      }
      const gateRows = (gate.garbledOrIncompleteRows || []).filter((r) => newTargets.has(r.index));
      qa = {
        ...base,
        skipped: !reviewWanted && !!prevQa.skipped,
        overallNotes: fresh.overallNotes || prevQa.overallNotes || '',
        uncertainTerms: [...carried.uncertainTerms, ...(fresh.uncertainTerms || [])],
        restructuredSentences: [...carried.restructuredSentences, ...(fresh.restructuredSentences || [])],
        polarityOrSentenceTypeIssues: [...carried.polarityOrSentenceTypeIssues, ...(fresh.polarityOrSentenceTypeIssues || [])],
        audienceFlags: [...carried.audienceFlags, ...(fresh.audienceFlags || [])],
        dialectalChoices: [...carried.dialectalChoices, ...(fresh.dialectalChoices || [])],
        garbledOrIncompleteRows: mergeGarbledRows(carried.garbledOrIncompleteRows, mergeGarbledRows(gateRows, fresh.garbledOrIncompleteRows || [])),
      };
    }
    if (gate.softFail) {
      qa.softFail = true;
      qa.softFailCode = gate.softFailCode;
      qa.overallNotes = [gate.message, qa.overallNotes].filter(Boolean).join(' ');
    }
    if (engineUsed !== (intake.engine === 'google' ? 'google' : 'llm') && intake.engine === 'google') {
      qa.overallNotes = [qa.overallNotes, 'This pass used Vault AI, because Google Translate cannot follow written requirements.'].filter(Boolean).join(' ');
    }
    if (!llmModel && requirements.some((r) => r.kind === 'rule')) {
      qa.overallNotes = [qa.overallNotes, 'Google Translate cannot follow written rules, so only the word requirements were applied.'].filter(Boolean).join(' ');
    }
    if (await stopped()) return;

    const translatedByPage = {};
    for (const p of pairs) {
      if (!translatedByPage[p.pageNum]) translatedByPage[p.pageNum] = [];
      translatedByPage[p.pageNum][p.idxInPage] = p.target;
    }
    const changedIndexes = parts.filter((p) => newTargets.has(p.i) && pairs[p.i].target !== p.target).map((p) => p.i);

    // The job shows this version first, and only then is the pass marked done, so anyone reading the moment it says done gets the
    // new text. A job kept while the pass ran (it should not be: Keep waits for passes) is left alone.
    const { rows } = await pool.query('SELECT "translatedTextJson" FROM translate_jobs WHERE id=$1 AND status=\'ready\'', [jobId]);
    if (rows[0]) {
      const latest = parse(rows[0].translatedTextJson) || payload;
      latest.translatedByPage = translatedByPage;
      latest.currentPass = passNo;
      latest.qaSummary = qa;
      await setJob(jobId, { translatedTextJson: JSON.stringify(latest), qaSummaryJson: JSON.stringify(qa), errorMessage: null });
    }
    await setPass(passId, {
      status: 'done', stage: 'Done', progress: 100, completedAt: new Date(),
      translatedByPage: JSON.stringify(translatedByPage), qaSummary: JSON.stringify(qa), changedIndexes: JSON.stringify(changedIndexes),
    });
  } catch (err) {
    console.error('[translate] pass failed:', err.message);
    await setPass(passId, { status: 'failed', stage: 'Failed', errorMessage: String(err.message || err).slice(0, 500), completedAt: new Date() });
  }
}

module.exports = {
  splitLongParagraph, mapPool, partsOf,
  findOrCreateGlobalGlossary, recordTermDrift, upsertGlobalGlossaryTerms, applyLessons,
  cleanRequirements, keepAppliedMarks, glossaryWithRequirements, guidanceWithRequirements, keepFindingsOutside,
  setJob, savePassOne, clearStalledPasses, loadJob, finalizeJob, runPass,
  PASS_STALL_MINUTES,
};
