'use strict';

/**
 * Milestone 4 — side-by-side compare + HITL₂ frontier approval gate.
 * No frontier / external API calls.
 */

const {
  loadJob,
  saveJob,
  loadOriginalDocx,
  loadRedactedDocx,
  loadLocalPassDocx,
  hasLocalPassDocx,
  saveRedactedDocx,
  loadEntityMap,
  hasSanitizedPdf,
  saveSanitizedPdf,
  deleteSanitizedPdf,
  hashSanitizedPdf,
  appendAudit,
} = require('./jobStore');
const { parseDocxBuffer, findOccurrences } = require('./docxParse');
const { applyReplacementsToDocx } = require('./applyDocx');
const { exportSanitizedPdf } = require('./pdfExport');

const CATEGORY_PALETTE = [
  { bg: '#fef3c7', color: '#92400e' }, // amber
  { bg: '#e0e7ff', color: '#3730a3' }, // indigo
  { bg: '#d1fae5', color: '#065f46' }, // emerald
  { bg: '#fce7f3', color: '#9d174d' }, // pink
  { bg: '#e0f2fe', color: '#075985' }, // sky
  { bg: '#ede9fe', color: '#5b21b6' }, // violet
  { bg: '#ffedd5', color: '#9a3412' }, // orange
  { bg: '#f3e8ff', color: '#6b21a8' }, // purple
];

/** Pass colors for three-way compare (local vs frontier-introduced spans). */
const PASS_COLORS = {
  local: { bg: '#dbeafe', color: '#1e3a8a', label: 'Local pass' },
  frontier: { bg: '#fce7f3', color: '#9d174d', label: 'Frontier suggestion' },
};

function categoryColor(categoryLabel) {
  const s = String(categoryLabel || 'other');
  let h = 0;
  for (let i = 0; i < s.length; i += 1) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CATEGORY_PALETTE[h % CATEGORY_PALETTE.length];
}

function findHighlightsForPass(text, entries, pass) {
  const out = [];
  for (const e of entries || []) {
    const entryPass = e.appliedPass === 'frontier' ? 'frontier' : 'local';
    if (pass && entryPass !== pass) continue;
    const needle = String(e.syntheticValue || '');
    if (!needle) continue;
    let from = 0;
    while (from < text.length) {
      const idx = text.indexOf(needle, from);
      if (idx < 0) break;
      const passColor = PASS_COLORS[entryPass] || PASS_COLORS.local;
      out.push({
        startOffset: idx,
        endOffset: idx + needle.length,
        categoryLabel: e.categoryLabel,
        synthetic: needle,
        pass: entryPass,
        color: passColor,
        kind: 'substitution',
      });
      from = idx + Math.max(1, needle.length);
    }
  }
  out.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));
  return out;
}

function requireJob(jobId, userId) {
  const job = loadJob(jobId, userId);
  if (!job) {
    const err = new Error('Job not found');
    err.status = 404;
    throw err;
  }
  return job;
}

function assertApplied(job, jobId) {
  const redacted = loadRedactedDocx(jobId);
  if (!redacted) {
    const err = new Error('No redacted.docx yet — run Apply redactions first');
    err.status = 400;
    err.code = 'NOT_APPLIED';
    throw err;
  }
  return redacted;
}

function findHighlights(text, synthetic, categoryLabel) {
  const needle = String(synthetic || '');
  if (!needle) return [];
  const out = [];
  let from = 0;
  while (from < text.length) {
    const idx = text.indexOf(needle, from);
    if (idx < 0) break;
    out.push({
      startOffset: idx,
      endOffset: idx + needle.length,
      categoryLabel,
      synthetic: needle,
      color: categoryColor(categoryLabel),
      kind: 'substitution',
    });
    from = idx + Math.max(1, needle.length);
  }
  return out;
}

/**
 * Find approved real values that still appear in redacted paragraph text.
 * Returns locations only — never realValue. The span is already visible in
 * the redacted pane text; we flag category + paragraph so the user can act.
 */
function scanLeftoversInParagraphs(paragraphs, entityMap) {
  const leftovers = [];
  for (const entry of entityMap?.entries || []) {
    const real = String(entry.realValue || '').trim();
    if (!real || real.length < 3) continue;
    (paragraphs || []).forEach((p, paragraphIndex) => {
      const text = p?.text || '';
      let from = 0;
      while (from < text.length) {
        const idx = text.indexOf(real, from);
        if (idx < 0) break;
        const before = text.slice(Math.max(0, idx - 24), idx).replace(/\s+/g, ' ');
        const after = text.slice(idx + real.length, idx + real.length + 24).replace(/\s+/g, ' ');
        leftovers.push({
          paragraphIndex,
          paragraphId: p.paragraphId || null,
          part: p.part || null,
          categoryLabel: entry.categoryLabel,
          startOffset: idx,
          endOffset: idx + real.length,
          // Safe cues: what it should have become + context with span elided
          expectedSynthetic: entry.syntheticValue || null,
          context: `${before}‹${entry.categoryLabel || 'entity'}›${after}`.trim(),
        });
        from = idx + real.length;
      }
    });
  }
  return leftovers;
}

/** @deprecated use scanLeftoversInParagraphs — kept for tests */
function scanLeftovers(redactedText, entityMap) {
  return scanLeftoversInParagraphs([{ text: redactedText, paragraphId: 'full' }], entityMap);
}

/**
 * Build aligned paragraph pairs for compare UI.
 * Client-safe: no real→synthetic map values except synthetics used as highlight targets.
 */
async function getComparePayload(jobId, userId) {
  const job = requireJob(jobId, userId);
  const originalBuf = loadOriginalDocx(jobId);
  const redactedBuf = assertApplied(job, jobId);
  if (!originalBuf) {
    const err = new Error('Original .docx missing');
    err.status = 400;
    throw err;
  }

  const [origIr, redIr] = await Promise.all([
    parseDocxBuffer(originalBuf),
    parseDocxBuffer(redactedBuf),
  ]);

  const entityMap = loadEntityMap(jobId);
  const synthetics = (entityMap?.entries || []).map((e) => ({
    synthetic: e.syntheticValue,
    categoryLabel: e.categoryLabel,
  }));

  const maxLen = Math.max(origIr.paragraphs.length, redIr.paragraphs.length);
  const rows = [];
  for (let i = 0; i < maxLen; i += 1) {
    const left = origIr.paragraphs[i] || null;
    const right = redIr.paragraphs[i] || null;
    const rightText = right?.text || '';
    const highlights = [];
    for (const s of synthetics) {
      highlights.push(...findHighlights(rightText, s.synthetic, s.categoryLabel));
    }
    // Prefer longer highlights when overlapping (sort desc length)
    highlights.sort((a, b) => (b.endOffset - b.startOffset) - (a.endOffset - a.startOffset));

    rows.push({
      index: i,
      original: left
        ? { paragraphId: left.paragraphId, part: left.part, text: left.text }
        : null,
      redacted: right
        ? { paragraphId: right.paragraphId, part: right.part, text: right.text, highlights }
        : null,
      changed: Boolean(left && right && left.text !== right.text)
        || Boolean(left && !right)
        || Boolean(!left && right),
    });
  }

  const leftoverHits = scanLeftoversInParagraphs(redIr.paragraphs || [], entityMap);

  // Attach leftover highlights onto matching rows (distinct from substitutions)
  const leftoverColor = { bg: '#fecaca', color: '#7f1d1d' };
  for (const hit of leftoverHits) {
    const row = rows[hit.paragraphIndex];
    if (!row?.redacted) continue;
    row.redacted.highlights = row.redacted.highlights || [];
    row.redacted.highlights.push({
      startOffset: hit.startOffset,
      endOffset: hit.endOffset,
      categoryLabel: hit.categoryLabel,
      kind: 'leftover',
      color: leftoverColor,
    });
    row.hasLeftover = true;
  }

  const pdfReady = hasSanitizedPdf(jobId) && (job.pdfStatus === 'ready' || job.status === 'pdf_ready' || job.status === 'ready_for_frontier' || job.status === 'ready_for_final' || job.status === 'completed' || job.status === 'hitl_frontier');
  const leftoversOutstanding = leftoverHits.length > 0;
  const canApproveForFrontier = pdfReady && !leftoversOutstanding && !job.finalApprovedAt;
  const threeWayAvailable = hasLocalPassDocx(jobId)
    && (job.lastApplyPass === 'frontier' || job.status === 'ready_for_final' || job.status === 'completed');
  const canApproveFinal = Boolean(
    pdfReady
    && !leftoversOutstanding
    && !job.finalApprovedAt
    && (job.status === 'ready_for_final' || job.lastApplyPass === 'frontier'),
  );

  let approveBlockedReason = null;
  if (leftoversOutstanding) {
    approveBlockedReason = `${leftoverHits.length} unresolved leftover(s): approved real values still appear in redacted.docx. `
      + 'Use Fix leftovers (targeted patch) or return to candidates and re-apply before frontier approval.';
  } else if (!pdfReady) {
    approveBlockedReason = 'Sanitized PDF is not ready yet. Use Retry PDF conversion, then approve for frontier analysis.';
  }

  const categories = [...new Set(synthetics.map((s) => s.categoryLabel).filter(Boolean))];
  const legend = categories.map((c) => ({ categoryLabel: c, color: categoryColor(c) }));

  let threeWay = null;
  if (threeWayAvailable) {
    const localBuf = loadLocalPassDocx(jobId);
    const localIr = localBuf ? await parseDocxBuffer(localBuf) : { paragraphs: [] };
    const entries = entityMap?.entries || [];
    const localEntries = entries.filter((e) => e.appliedPass !== 'frontier');
    const frontierEntries = entries.filter((e) => e.appliedPass === 'frontier');
    const max3 = Math.max(origIr.paragraphs.length, localIr.paragraphs.length, redIr.paragraphs.length);
    const threeRows = [];
    for (let i = 0; i < max3; i += 1) {
      const o = origIr.paragraphs[i] || null;
      const l = localIr.paragraphs[i] || null;
      const f = redIr.paragraphs[i] || null;
      const localText = l?.text || '';
      const finalText = f?.text || '';
      threeRows.push({
        index: i,
        original: o ? { paragraphId: o.paragraphId, part: o.part, text: o.text } : null,
        local: l
          ? {
              paragraphId: l.paragraphId,
              part: l.part,
              text: localText,
              highlights: findHighlightsForPass(localText, localEntries, 'local'),
            }
          : null,
        final: f
          ? {
              paragraphId: f.paragraphId,
              part: f.part,
              text: finalText,
              highlights: [
                ...findHighlightsForPass(finalText, localEntries, 'local'),
                ...findHighlightsForPass(finalText, frontierEntries, 'frontier'),
              ],
            }
          : null,
        changedLocal: Boolean(o && l && o.text !== l.text) || Boolean(o && !l) || Boolean(!o && l),
        changedFinal: Boolean(l && f && l.text !== f.text) || Boolean(l && !f) || Boolean(!l && f),
      });
    }
    threeWay = {
      available: true,
      passLegend: [
        { pass: 'local', ...PASS_COLORS.local },
        { pass: 'frontier', ...PASS_COLORS.frontier },
      ],
      rows: threeRows,
      stats: {
        paragraphPairs: threeRows.length,
        changedLocal: threeRows.filter((r) => r.changedLocal).length,
        changedFinal: threeRows.filter((r) => r.changedFinal).length,
      },
    };
  }

  const finalApproveBlockedReason = leftoversOutstanding
    ? approveBlockedReason
    : (!pdfReady
      ? 'Sanitized PDF is required before final approval.'
      : (!threeWayAvailable && job.lastApplyPass !== 'frontier'
        ? 'Apply at least one frontier suggestion (or complete a frontier apply pass) before final approval.'
        : null));

  return {
    ok: true,
    job: {
      id: job.id,
      status: job.status,
      pdfStatus: job.pdfStatus || (pdfReady ? 'ready' : 'pending'),
      originalFilename: job.originalFilename,
      frontierApprovedAt: job.frontierApprovedAt || null,
      localCompareApprovedAt: job.localCompareApprovedAt || null,
      finalApprovedAt: job.finalApprovedAt || null,
      lastApplyPass: job.lastApplyPass || null,
      coherence: job.coherence || null,
    },
    pdfReady,
    leftoversOutstanding,
    canApproveForFrontier,
    approveBlockedReason,
    threeWayAvailable,
    canApproveFinal,
    finalApproveBlockedReason: job.finalApprovedAt
      ? null
      : (canApproveFinal
        ? null
        : finalApproveBlockedReason),
    legend,
    rows,
    threeWay,
    stats: {
      paragraphPairs: rows.length,
      changedParagraphs: rows.filter((r) => r.changed).length,
      highlightSpans: rows.reduce((n, r) => n + (r.redacted?.highlights?.length || 0), 0),
      leftoverRealValueHits: leftoverHits.length,
    },
    leftovers: leftoverHits.slice(0, 50),
    remediation: {
      fixLeftovers: 'POST .../fix-leftovers — patch redacted.docx from entity map, then retry PDF',
      fullReapply: 'Back to candidates → ensure approvals → Apply redactions again',
    },
  };
}

const COHERENCE_SYSTEM = `You review a redacted document for coherence problems caused by synthetic substitutions.
Return ONLY valid JSON (no markdown):
{
  "flags": [
    {
      "paragraphIndex": 0,
      "severity": "short quote from the redacted paragraph",
      "issue": "what looks wrong (grammar, agreement, totals that no longer add up, dangling references)",
      "severity": "low|medium|high"
    }
  ],
  "summary": "one sentence overall"
}
Rules:
- Only flag issues likely caused by redaction/substitution, not general writing quality.
- paragraphIndex is 0-based index in the provided list.
- If nothing is wrong, return {"flags":[],"summary":"No coherence issues detected."}.`;

function parseCoherenceJson(text) {
  const raw = String(text || '').trim();
  let jsonText = raw;
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) jsonText = fence[1].trim();
  const start = jsonText.indexOf('{');
  const end = jsonText.lastIndexOf('}');
  if (start >= 0 && end > start) jsonText = jsonText.slice(start, end + 1);
  return JSON.parse(jsonText);
}

async function runCoherenceCheck(jobId, userId) {
  const job = requireJob(jobId, userId);
  assertApplied(job, jobId);

  const { resolveDocumentRedactionModels } = require('../documentRedactionModelResolver');
  const { callModel } = require('../callModel');

  const resolved = await resolveDocumentRedactionModels({ userId, jobId });
  if (!resolved.ok || !resolved.local?.modelId) {
    const err = new Error(
      resolved.errors?.join('; ') || 'Local model not configured for document redaction',
    );
    err.status = 400;
    err.resolver = resolved;
    throw err;
  }

  const payload = await getComparePayload(jobId, userId);
  const changed = payload.rows
    .filter((r) => r.changed && r.redacted?.text)
    .slice(0, 40)
    .map((r) => `[${r.index}] ${r.redacted.text}`);

  const userPrompt = `Redacted paragraphs (changed ones). Check coherence:\n\n${changed.join('\n\n') || '(no changed paragraphs)'}`;

  let flags = [];
  let summary = 'No coherence issues detected.';
  let modelError = null;
  try {
    const text = await callModel(resolved.local.modelId, userPrompt, {
      system: COHERENCE_SYSTEM,
      maxTokens: 2500,
    });
    const parsed = parseCoherenceJson(text);
    flags = Array.isArray(parsed.flags) ? parsed.flags : [];
    summary = String(parsed.summary || summary);
  } catch (err) {
    modelError = err.message || String(err);
  }

  const coherence = {
    ranAt: new Date().toISOString(),
    modelId: resolved.local.modelId,
    summary,
    flags,
    error: modelError,
  };

  saveJob({
    ...loadJob(jobId, userId),
    coherence,
  });
  appendAudit(jobId, {
    type: 'coherence_check',
    flagCount: flags.length,
    modelId: resolved.local.modelId,
    error: modelError,
  });

  return { ok: true, coherence };
}

/**
 * Convert-only PDF retry — does not re-apply redactions.
 */
async function retryPdfConversion(jobId, userId) {
  const job = requireJob(jobId, userId);
  const redactedBuf = assertApplied(job, jobId);

  const pdfResult = await exportSanitizedPdf(redactedBuf);
  if (!pdfResult.buffer) {
    const err = new Error(pdfResult.error || 'LibreOffice PDF conversion failed');
    err.status = 503;
    err.code = 'PDF_CONVERSION_FAILED';
    appendAudit(jobId, { type: 'pdf_retry_failed', error: err.message });
    saveJob({
      ...loadJob(jobId, userId),
      status: 'docx_ready_pdf_pending',
      pdfStatus: 'pending',
      sanitizedPdf: null,
      apply: {
        ...(job.apply || {}),
        pdfStatus: 'pending',
        pdfExported: false,
        pdfError: err.message,
      },
    });
    throw err;
  }

  saveSanitizedPdf(jobId, pdfResult.buffer);
  // New PDF bytes invalidate any prior HITL₂ approval (SHA no longer matches)
  const updated = saveJob({
    ...loadJob(jobId, userId),
    status: 'pdf_ready',
    pdfStatus: 'ready',
    sanitizedPdf: 'sanitized.pdf',
    frontierApprovedAt: null,
    frontierApprovedPdfSha256: null,
    apply: {
      ...(job.apply || {}),
      pdfStatus: 'ready',
      pdfExported: true,
      pdfError: null,
    },
  });
  appendAudit(jobId, { type: 'pdf_retry_ok', frontierApprovalCleared: true });

  return {
    ok: true,
    pdfStatus: 'ready',
    frontierApprovedAt: null,
    job: {
      id: updated.id,
      status: updated.status,
      pdfStatus: updated.pdfStatus,
      sanitizedPdf: updated.sanitizedPdf,
      frontierApprovedAt: null,
    },
    artifacts: { sanitizedPdf: 'sanitized.pdf' },
  };
}

/**
 * Targeted leftover remediation: replace remaining real→synthetic spans in
 * redacted.docx using the entity map (no full re-HITL). Invalidates PDF +
 * any prior frontier approval — user must retry PDF before approving again.
 */
async function fixLeftovers(jobId, userId) {
  const job = requireJob(jobId, userId);
  const redactedBuf = assertApplied(job, jobId);
  const entityMap = loadEntityMap(jobId);
  if (!entityMap?.entries?.length) {
    const err = new Error('No entity map — cannot patch leftovers');
    err.status = 400;
    err.code = 'NO_ENTITY_MAP';
    throw err;
  }

  const ir = await parseDocxBuffer(redactedBuf);
  const before = scanLeftoversInParagraphs(ir.paragraphs || [], entityMap);
  if (!before.length) {
    return {
      ok: true,
      fixed: 0,
      remaining: 0,
      message: 'No leftovers to fix',
      compare: await getComparePayload(jobId, userId),
    };
  }

  const ops = [];
  for (const entry of entityMap.entries) {
    const real = String(entry.realValue || '').trim();
    const synthetic = String(entry.syntheticValue || '').trim();
    if (!real || !synthetic || real === synthetic) continue;
    for (const loc of findOccurrences(ir, real)) {
      ops.push({
        ...loc,
        quote: real,
        synthetic,
      });
    }
  }

  const { buffer } = await applyReplacementsToDocx(redactedBuf, ops, {
    acceptTrackedChanges: true, // already scrubbed; allow no-op if clean
  });
  saveRedactedDocx(jobId, buffer);
  deleteSanitizedPdf(jobId);

  const afterIr = await parseDocxBuffer(buffer);
  const remaining = scanLeftoversInParagraphs(afterIr.paragraphs || [], entityMap);

  const updated = saveJob({
    ...loadJob(jobId, userId),
    status: 'docx_ready_pdf_pending',
    pdfStatus: 'pending',
    sanitizedPdf: null,
    frontierApprovedAt: null,
    frontierApprovedPdfSha256: null,
    apply: {
      ...(job.apply || {}),
      pdfStatus: 'pending',
      pdfExported: false,
      pdfError: 'Invalidated after leftover fix — retry PDF conversion',
      leftoversFixedAt: new Date().toISOString(),
      leftoversFixedCount: before.length - remaining.length,
    },
  });

  appendAudit(jobId, {
    type: 'fix_leftovers',
    beforeCount: before.length,
    afterCount: remaining.length,
    replacementsWritten: ops.length,
  });

  return {
    ok: true,
    fixed: before.length - remaining.length,
    remaining: remaining.length,
    replacementsWritten: ops.length,
    pdfStatus: 'pending',
    job: {
      id: updated.id,
      status: updated.status,
      pdfStatus: updated.pdfStatus,
      sanitizedPdf: null,
      frontierApprovedAt: null,
    },
    message: remaining.length
      ? `${before.length - remaining.length} leftover(s) patched; ${remaining.length} remain — check entity map / re-apply from candidates.`
      : `${before.length} leftover(s) patched. Retry PDF conversion, then approve for frontier.`,
    compare: await getComparePayload(jobId, userId),
  };
}

/**
 * Explicit HITL₂ gate before Milestone 5 frontier analysis.
 * Requires sanitized.pdf AND zero leftover real-value hits (server-side).
 */
async function approveForFrontier(jobId, userId, { confirm = true } = {}) {
  const job = requireJob(jobId, userId);
  const redactedBuf = assertApplied(job, jobId);

  if (!confirm) {
    const err = new Error('confirm must be true to approve for frontier analysis');
    err.status = 400;
    err.code = 'CONFIRM_REQUIRED';
    throw err;
  }

  const entityMap = loadEntityMap(jobId);
  const ir = await parseDocxBuffer(redactedBuf);
  const leftovers = scanLeftoversInParagraphs(ir.paragraphs || [], entityMap);
  if (leftovers.length) {
    const err = new Error(
      `Cannot approve for frontier analysis: ${leftovers.length} unresolved leftover(s) — `
      + 'approved real values still appear in redacted.docx. '
      + 'Run Fix leftovers or re-apply from candidates first.',
    );
    err.status = 409;
    err.code = 'UNRESOLVED_LEFTOVERS';
    err.leftoverCount = leftovers.length;
    err.leftovers = leftovers.slice(0, 30).map((l) => ({
      paragraphIndex: l.paragraphIndex,
      paragraphId: l.paragraphId,
      categoryLabel: l.categoryLabel,
    }));
    throw err;
  }

  if (!hasSanitizedPdf(jobId)) {
    const err = new Error(
      'Cannot approve for frontier analysis: sanitized.pdf is missing. '
      + 'Retry PDF conversion first (job is docx-only until PDF is ready).',
    );
    err.status = 409;
    err.code = 'PDF_REQUIRED';
    throw err;
  }

  const pdfSha256 = hashSanitizedPdf(jobId);
  const now = new Date().toISOString();
  const updated = saveJob({
    ...loadJob(jobId, userId),
    status: 'ready_for_frontier',
    pdfStatus: 'ready',
    frontierApprovedAt: now,
    frontierApprovedPdfSha256: pdfSha256,
    localCompareApprovedAt: now,
    sanitizedPdf: 'sanitized.pdf',
  });

  appendAudit(jobId, {
    type: 'approve_for_frontier',
    approvedAt: now,
    pdfSha256,
  });

  return {
    ok: true,
    approvedAt: now,
    pdfSha256,
    job: {
      id: updated.id,
      status: updated.status,
      pdfStatus: updated.pdfStatus,
      frontierApprovedAt: updated.frontierApprovedAt,
      frontierApprovedPdfSha256: pdfSha256,
    },
  };
}

module.exports = {
  getComparePayload,
  runCoherenceCheck,
  retryPdfConversion,
  fixLeftovers,
  approveForFrontier,
  categoryColor,
  findHighlights,
  findHighlightsForPass,
  scanLeftovers,
  scanLeftoversInParagraphs,
  PASS_COLORS,
};
