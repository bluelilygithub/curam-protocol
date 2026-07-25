'use strict';

/**
 * Milestone 5 — frontier residual-risk analysis on sanitized.pdf only.
 * Resolves frontier model exclusively via document-redaction-agent card.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const {
  loadJob,
  saveJob,
  loadEntityMap,
  hasSanitizedPdf,
  loadCandidates,
  saveCandidates,
  appendAudit,
  jobDir,
  loadRedactedDocx,
  hashSanitizedPdf,
} = require('./jobStore');
const { resolveDocumentRedactionModels } = require('../documentRedactionModelResolver');
const { assertNoRealEntitiesInOutgoingPayload } = require('./frontierPayloadGuard');
const { callFrontierModel } = require('./frontierCall');
const { scanLeftoversInParagraphs } = require('./compareService');
const { parseDocxBuffer, findOccurrences, locateInParagraph } = require('./docxParse');
const { entityKeyFor } = require('./mergeCandidates');
const { parseFrontierJson } = require('./frontierParse');

const SYSTEM = `You are a residual-risk analyst reviewing a SANITIZED (already redacted) document.
The document you receive contains only synthetic substitutes — treat every name, figure, and identifier as fictional.
You must NEVER ask for or invent the original real values.

Return ONLY valid JSON (no markdown fences) with this shape:
{
  "analysis": "Your response to the user's analysis instructions (markdown allowed inside the string).",
  "suggestions": [
    {
      "entityText": "exact substring from the SANITIZED document that should be further redacted or edited",
      "categoryLabel": "short free-form category",
      "confidence": 0.0,
      "rationale": "why this is still identifying or inferable despite prior redaction",
      "suggestedReplacement": "plausible synthetic replacement",
      "paragraphHint": "optional short surrounding quote or page note"
    }
  ]
}
Rules:
- entityText MUST appear verbatim in the sanitized document (or extracted text).
- Flag residual identification risk separately from the analysis narrative.
- Do not propose black-bar placeholders; use plausible synthetics.
- If nothing residual remains, return "suggestions": [].`;

async function extractPdfText(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const getDocument = pdfjsLib.getDocument || pdfjsLib.default?.getDocument;
  if (!getDocument) throw new Error('pdfjs-dist getDocument unavailable');
  const doc = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages = [];
  for (let i = 1; i <= doc.numPages; i += 1) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items.map((item) => item.str).join(' ').trim();
    if (line) pages.push({ page: i, text: line });
  }
  const text = pages.map((p) => `[Page ${p.page}]\n${p.text}`).join('\n\n').trim();
  return { text, pageCount: pages.length };
}

function loadSanitizedPdfBuffer(jobId) {
  const dest = path.join(jobDir(jobId), 'sanitized.pdf');
  if (!fs.existsSync(dest)) return null;
  return fs.readFileSync(dest);
}

function mapSuggestionToCandidate(jobId, item, redIr) {
  const entityText = String(item.entityText || item.quote || '').trim();
  const categoryLabel = String(item.categoryLabel || 'residual_risk').trim() || 'residual_risk';
  let locations = [];
  if (entityText && redIr) {
    locations = findOccurrences(redIr, entityText);
  }
  if (!locations.length && item.paragraphHint && redIr) {
    const hint = String(item.paragraphHint).trim();
    for (const p of redIr.paragraphs || []) {
      if (p.text.includes(hint.slice(0, 40))) {
        const idx = entityText ? p.text.indexOf(entityText) : -1;
        if (idx >= 0) {
          locations = [locateInParagraph(p, idx, idx + entityText.length, entityText)];
        } else {
          locations = [{
            part: p.part,
            paragraphId: p.paragraphId,
            xmlPath: p.xmlPath,
            startOffset: 0,
            endOffset: Math.min(40, p.text.length),
            quote: p.text.slice(0, 40),
          }];
        }
        break;
      }
    }
  }

  const now = new Date().toISOString();
  const confidence = Math.max(0, Math.min(1, Number(item.confidence) || 0.55));
  return {
    id: crypto.randomUUID(),
    jobId,
    source: 'frontier_suggested',
    sourceLabel: 'frontier',
    categoryLabel,
    entityKey: entityKeyFor(entityText || categoryLabel, categoryLabel),
    entityText: entityText || '(unlocated residual risk)',
    surfaceForms: entityText ? [entityText] : [],
    locations,
    occurrenceCount: locations.length || 1,
    confidence,
    score: confidence,
    scoreBreakdown: { frontier: confidence },
    suggestedReplacement: String(item.suggestedReplacement || `REDACTED_${categoryLabel}`).trim(),
    decision: 'pending',
    rationale: String(item.rationale || '').trim(),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Run frontier analysis on an approved job.
 * @param {string} jobId
 * @param {number|string} userId
 * @param {{ instructions?: string }} opts
 */
async function runFrontierAnalysis(jobId, userId, opts = {}) {
  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }

  const auditBlock = (code, extra = {}) => {
    appendAudit(jobId, {
      type: 'frontier_analysis_blocked',
      code,
      ts: new Date().toISOString(),
      ...extra,
    });
  };

  // Re-verify live job state — do not trust that the client "already approved"
  if (!job.frontierApprovedAt) {
    const err = new Error(
      'Frontier analysis requires a current HITL₂ approval. '
      + 'Approve for frontier analysis again after apply / fix-leftovers / PDF retry.',
    );
    err.status = 409;
    err.code = 'FRONTIER_NOT_APPROVED';
    auditBlock(err.code, { status: job.status });
    throw err;
  }

  if (!hasSanitizedPdf(jobId)) {
    const err = new Error('sanitized.pdf missing — cannot call frontier');
    err.status = 409;
    err.code = 'PDF_REQUIRED';
    auditBlock(err.code);
    throw err;
  }

  const pdfSha256 = hashSanitizedPdf(jobId);
  // Approval must bind to the exact PDF bytes that were present at HITL₂
  if (!job.frontierApprovedPdfSha256 || pdfSha256 !== job.frontierApprovedPdfSha256) {
    const err = new Error(
      'sanitized.pdf is missing a matching HITL₂ approval fingerprint (stale or cleared). '
      + 'Re-approve for frontier analysis against the current PDF.',
    );
    err.status = 409;
    err.code = 'PDF_STALE';
    auditBlock(err.code, {
      approvedSha: job.frontierApprovedPdfSha256 || null,
      currentSha: pdfSha256,
    });
    throw err;
  }

  const entityMap = loadEntityMap(jobId);
  const redactedBuf = loadRedactedDocx(jobId);
  if (redactedBuf) {
    const ir = await parseDocxBuffer(redactedBuf);
    const leftovers = scanLeftoversInParagraphs(ir.paragraphs || [], entityMap);
    if (leftovers.length) {
      const err = new Error(
        `Refusing frontier call: ${leftovers.length} leftover real value(s) still in redacted.docx`,
      );
      err.status = 409;
      err.code = 'UNRESOLVED_LEFTOVERS';
      err.leftoverCount = leftovers.length;
      auditBlock(err.code, {
        leftoverCount: leftovers.length,
        leftovers: leftovers.slice(0, 30).map((l) => ({
          paragraphIndex: l.paragraphIndex,
          categoryLabel: l.categoryLabel,
        })),
      });
      throw err;
    }
  }

  const resolved = await resolveDocumentRedactionModels({ userId, jobId });
  if (!resolved.frontier?.modelId) {
    const err = new Error(
      resolved.errors?.join('; ') || 'Frontier model not configured on document-redaction-agent card',
    );
    err.status = 400;
    err.resolver = resolved;
    auditBlock('FRONTIER_MODEL_MISSING', { errors: resolved.errors });
    throw err;
  }
  const modelId = resolved.frontier.modelId;

  const pdfBuffer = loadSanitizedPdfBuffer(jobId);
  const pdfBase64 = pdfBuffer.toString('base64');

  let pdfText = '';
  let pageCount = 0;
  try {
    const extracted = await extractPdfText(pdfBuffer);
    pdfText = extracted.text;
    pageCount = extracted.pageCount;
  } catch (err) {
    pdfText = '';
    console.warn('[document-redaction] PDF text extract failed:', err.message);
  }

  const instructions = String(opts.instructions || opts.analysisInstructions || '').trim()
    || 'Summarise residual identification risk and any content inconsistencies in this sanitized document.';

  const userPrompt = [
    '## Analysis instructions (from the human reviewer)',
    instructions,
    '',
    '## Your tasks',
    '1. Perform the analysis above on the sanitized document.',
    '2. Separately list residual redaction/edit suggestions for anything still identifiable or inferable.',
    '',
    'Return the JSON object specified in the system prompt.',
  ].join('\n');

  // Hard assertion before every API call — audit the catch without logging leaked content
  let guard;
  try {
    guard = assertNoRealEntitiesInOutgoingPayload(
      [userPrompt, SYSTEM, instructions, pdfText],
      entityMap,
    );
  } catch (err) {
    if (err.code === 'ENTITY_LEAK_IN_PAYLOAD') {
      appendAudit(jobId, {
        type: 'frontier_analysis_blocked',
        code: 'ENTITY_LEAK_IN_PAYLOAD',
        modelId,
        pdfSha256,
        pdfBytes: pdfBuffer.length,
        instructionsChars: instructions.length,
        // Masked hits only — never the leaking payload or real values
        hits: err.hits || [],
        guardBytesScanned: null,
      });
    }
    throw err;
  }

  const supportsNativePdf = !modelId.startsWith('ollama:') && !modelId.startsWith('deepseek-');
  let textPrompt = userPrompt;
  if (!supportsNativePdf) {
    if (!pdfText) {
      const err = new Error(
        'Frontier model cannot accept PDF bytes and PDF text extraction failed. '
        + 'Assign an Anthropic or Gemini frontier model, or ensure pdfjs can read sanitized.pdf.',
      );
      err.status = 400;
      err.code = 'PDF_TEXT_REQUIRED';
      auditBlock(err.code, { modelId });
      throw err;
    }
    textPrompt = `${userPrompt}\n\n## Sanitized document text (extracted from PDF)\n${pdfText}`;
    try {
      assertNoRealEntitiesInOutgoingPayload([textPrompt, SYSTEM], entityMap);
    } catch (err) {
      if (err.code === 'ENTITY_LEAK_IN_PAYLOAD') {
        appendAudit(jobId, {
          type: 'frontier_analysis_blocked',
          code: 'ENTITY_LEAK_IN_PAYLOAD',
          modelId,
          pdfSha256,
          pdfBytes: pdfBuffer.length,
          instructionsChars: instructions.length,
          phase: 'text_only_prompt',
          hits: err.hits || [],
        });
      }
      throw err;
    }
  }

  saveJob({ ...loadJob(jobId, userId), status: 'frontier_review' });

  const startedAt = new Date().toISOString();
  let modelResult;
  try {
    modelResult = await callFrontierModel(modelId, {
      system: SYSTEM,
      textPrompt,
      pdfBase64: supportsNativePdf ? pdfBase64 : null,
      maxTokens: 8000,
    });
  } catch (err) {
    appendAudit(jobId, {
      type: 'frontier_analysis_error',
      modelId,
      error: err.message,
      startedAt,
      pdfSha256,
      pdfBytes: pdfBuffer.length,
    });
    saveJob({ ...loadJob(jobId, userId), status: 'ready_for_frontier' });
    throw err;
  }

  let parsed;
  try {
    parsed = parseFrontierJson(modelResult.text);
  } catch (err) {
    parsed = {
      analysis: modelResult.text || '',
      suggestions: [],
      parseError: err.message,
    };
  }

  const redIr = redactedBuf ? await parseDocxBuffer(redactedBuf) : null;
  const newCandidates = (parsed.suggestions || []).map((s) => mapSuggestionToCandidate(jobId, s, redIr));

  const existing = loadCandidates(jobId);
  // Drop prior frontier_suggested pending from earlier runs (keep decided ones)
  const kept = existing.filter((c) => !(c.source === 'frontier_suggested' && (!c.decision || c.decision === 'pending')));
  const merged = [...kept, ...newCandidates];
  saveCandidates(jobId, merged);

  const finishedAt = new Date().toISOString();
  const frontierResult = {
    ranAt: finishedAt,
    modelId,
    provider: modelResult.provider,
    mode: modelResult.mode,
    analysis: parsed.analysis,
    suggestionCount: newCandidates.length,
    parseError: parsed.parseError || null,
    usage: {
      inputTokens: modelResult.inputTokens,
      outputTokens: modelResult.outputTokens,
    },
    pdfSha256,
    pdfBytes: pdfBuffer.length,
    pageCount,
    guard,
  };

  saveJob({
    ...loadJob(jobId, userId),
    status: 'hitl_frontier',
    frontierAnalysis: {
      ranAt: frontierResult.ranAt,
      modelId,
      suggestionCount: newCandidates.length,
      analysisPreview: String(parsed.analysis || '').slice(0, 500),
      parseError: parsed.parseError || null,
    },
  });

  // Full request/response in internal audit (no API keys; no PDF base64)
  appendAudit(jobId, {
    type: 'frontier_analysis',
    startedAt,
    finishedAt,
    modelId,
    provider: modelResult.provider,
    mode: modelResult.mode,
    pdfSha256,
    pdfBytes: pdfBuffer.length,
    pageCount,
    guard,
    request: {
      system: SYSTEM,
      userPrompt: textPrompt.slice(0, 200_000),
      instructions,
      pdfAttached: Boolean(supportsNativePdf),
    },
    response: {
      rawText: String(modelResult.text || '').slice(0, 200_000),
      analysis: parsed.analysis,
      suggestionCount: newCandidates.length,
      parseError: parsed.parseError || null,
      usage: frontierResult.usage,
    },
  });

  // Also stash last result under internal/ for local inspection (analysis is sanitized)
  const dest = path.join(jobDir(jobId), 'internal', 'frontier-last.json');
  fs.writeFileSync(dest, JSON.stringify({
    ...frontierResult,
    analysis: parsed.analysis,
    suggestions: newCandidates.map((c) => ({
      id: c.id,
      entityText: c.entityText,
      categoryLabel: c.categoryLabel,
      rationale: c.rationale,
      suggestedReplacement: c.suggestedReplacement,
    })),
  }, null, 2));

  return {
    ok: true,
    analysis: parsed.analysis,
    suggestions: newCandidates,
    suggestionCount: newCandidates.length,
    candidates: merged,
    frontier: {
      modelId,
      provider: modelResult.provider,
      mode: modelResult.mode,
      ranAt: finishedAt,
      usage: frontierResult.usage,
      parseError: parsed.parseError || null,
    },
    job: {
      id: jobId,
      status: 'hitl_frontier',
      frontierApprovedAt: job.frontierApprovedAt,
      frontierAnalysis: {
        ranAt: finishedAt,
        modelId,
        suggestionCount: newCandidates.length,
      },
    },
  };
}

module.exports = {
  runFrontierAnalysis,
  parseFrontierJson,
  extractPdfText,
};
