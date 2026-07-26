'use strict';

/**
 * Milestone 1 orchestrator: ingest → brief → local LLM + patterns → merge/dedupe.
 */

const { parseDocxBuffer, findOccurrences } = require('./docxParse');
const { extractPatternCandidates } = require('./patternCandidates');
const { extractLlmCandidates } = require('./llmCandidates');
const { mergeAndDeduplicateCandidates, expandOccurrencesWithIr } = require('./mergeCandidates');
const {
  createJobShell,
  saveJob,
  saveOriginalDocx,
  saveCandidates,
  saveIr,
} = require('./jobStore');
const { resolveDocumentRedactionModels } = require('../documentRedactionModelResolver');
const { normalizeUploadToDocx } = require('./ingestNormalize');
const { summarizeBriefIntents } = require('./bankLexicon');

/**
 * @param {object} opts
 * @param {number|string} opts.userId
 * @param {Buffer} opts.buffer
 * @param {string} opts.filename
 * @param {string} [opts.mimetype]
 * @param {string} opts.brief — free-text redaction instructions
 * @param {boolean} [opts.skipLlm=false] — pattern-only (debug)
 */
async function proposeRedactionCandidates({
  userId,
  buffer,
  filename,
  mimetype,
  brief,
  skipLlm = false,
}) {
  const briefText = String(brief || '').trim();
  if (!briefText) {
    const err = new Error('Redaction brief (context) is required');
    err.status = 400;
    throw err;
  }
  if (!buffer || !Buffer.isBuffer(buffer)) {
    const err = new Error('Upload file buffer required');
    err.status = 400;
    throw err;
  }

  const resolved = await resolveDocumentRedactionModels({ userId });
  if (!skipLlm && (!resolved.ok || !resolved.local?.modelId)) {
    const err = new Error(
      resolved.errors?.join('; ')
      || 'Document redaction candidate model is not configured. Assign a model on the agent card in Settings.',
    );
    err.status = 400;
    err.resolver = resolved;
    throw err;
  }

  const briefMeta = summarizeBriefIntents(briefText);

  const normalized = await normalizeUploadToDocx({ buffer, filename, mimetype });
  const workingBuffer = normalized.docxBuffer;

  let job = createJobShell(userId, {
    status: 'extracting',
    brief: briefMeta,
    originalFilename: normalized.originalFilename || filename || 'upload.docx',
    sourceExt: normalized.sourceExt,
    ingestConverted: normalized.converted,
    ingestNote: normalized.conversionNote,
  });

  const paths = saveOriginalDocx(job.id, workingBuffer, normalized.originalFilename);
  job = saveJob({
    ...job,
    ...paths,
    originalSha256: null,
    localModelId: resolved.local?.modelId || null,
    frontierModelId: resolved.frontier?.modelId || null,
  });

  const ir = await parseDocxBuffer(workingBuffer);
  saveIr(job.id, ir);
  job = saveJob({
    ...job,
    status: 'proposing',
    originalSha256: ir.sha256,
    documentStats: {
      paragraphCount: ir.paragraphCount,
      charCount: ir.charCount,
    },
  });

  const patternRaw = extractPatternCandidates(ir, job.id);
  let llmRaw = [];
  let llmMeta = { candidates: [], errors: [], chunks: 0, modelId: null };

  if (!skipLlm) {
    llmMeta = await extractLlmCandidates({
      ir,
      brief: briefText,
      modelId: resolved.local.modelId,
      jobId: job.id,
    });
    llmRaw = llmMeta.candidates || [];
  }

  let merged = mergeAndDeduplicateCandidates([...patternRaw, ...llmRaw], job.id);
  merged = expandOccurrencesWithIr(merged, ir, findOccurrences);

  // Brief asked for banks / lenders → keep bank lexicon hits highly visible
  if ((briefMeta.intents || []).some((i) => /bank/i.test(i))) {
    merged = merged.map((c) => {
      if (String(c.categoryLabel || '').toLowerCase() !== 'bank name') return c;
      const score = Math.min(1, Math.max(Number(c.score) || 0, 0.94));
      return {
        ...c,
        score,
        rationale: c.rationale
          ? `${c.rationale} | Brief asks for bank/lender names.`
          : 'Brief asks for bank/lender names.',
      };
    }).sort((a, b) => (b.score || 0) - (a.score || 0));
  }

  saveCandidates(job.id, merged);

  job = saveJob({
    ...job,
    status: 'proposing_complete',
    candidateCount: merged.length,
    sources: {
      deterministic: patternRaw.length,
      local_llm: llmRaw.length,
      merged: merged.length,
    },
    llm: {
      modelId: llmMeta.modelId,
      chunks: llmMeta.chunks,
      errors: llmMeta.errors || [],
    },
  });

  const payload = {
    ok: true,
    job,
    models: {
      local: resolved.local,
      frontier: resolved.frontier,
    },
    candidates: merged,
    stats: {
      paragraphs: ir.paragraphCount,
      chars: ir.charCount,
      patternCandidates: patternRaw.length,
      llmCandidates: llmRaw.length,
      mergedCandidates: merged.length,
    },
  };

  // Sanity-check log for Milestone 1 (no UI yet)
  console.log('[document-redaction] Milestone 1 candidates', JSON.stringify({
    jobId: job.id,
    brief: briefText.slice(0, 120),
    localModel: resolved.local?.modelId,
    stats: payload.stats,
    top: merged.slice(0, 15).map((c) => ({
      entityText: c.entityText,
      categoryLabel: c.categoryLabel,
      source: c.source,
      sourceLabel: c.sourceLabel,
      confidence: c.confidence,
      score: Number(c.score?.toFixed?.(3) ?? c.score),
      occurrenceCount: c.occurrenceCount,
      replacement: c.suggestedReplacement,
      locations: (c.locations || []).slice(0, 3).map((l) => l.paragraphId),
    })),
  }, null, 2));

  return payload;
}

module.exports = {
  proposeRedactionCandidates,
};
