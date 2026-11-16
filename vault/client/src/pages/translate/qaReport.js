// The job's checks (stored on the job as qaSummaryJson) turned into things a person reads: the plain-text report and the
// one-line verdict the My translations list shows.

export function parseQa(job) {
  if (!job?.qaSummaryJson) return null;
  try {
    return typeof job.qaSummaryJson === 'string' ? JSON.parse(job.qaSummaryJson) : job.qaSummaryJson;
  } catch { return null; }
}

// Plain-text QA report for HITL review — the sections/order mirror what QaPanel renders on
// screen, so the download and the modal never drift apart.
export function buildQaReportText(job, qa, appVersion) {
  const lines = [];
  const push = (s = '') => lines.push(s);
  push(`Translation QA Report`);
  push(`File: ${job?.filename || '—'}`);
  push(`Target language: ${job?.targetLanguage || '—'}`);
  push(`Translate model: ${qa.translateModel || '—'} · Review model: ${qa.reviewModel || '—'}`);
  push(`Generated: ${new Date().toISOString()}`);
  // Deployed commit this report/agent logic ran on — check this before re-testing a fix; a
  // report from a stale build looks identical to a real bug otherwise.
  push(`Agent build: ${appVersion || 'unknown — check /api/health'}`);
  push('');

  if (qa.hardFail) {
    push(`HARD QA GATE FAILED${qa.hardFailCode ? ` (${qa.hardFailCode})` : ''}`);
    push(qa.overallNotes || 'Translation did not pass completeness checks.');
    push('');
  } else if (qa.softFail) {
    push(`COMPLETED WITH WARNINGS${qa.softFailCode ? ` (${qa.softFailCode})` : ''}`);
    push(qa.overallNotes || 'Some segments still need review (see Garbled / incomplete rows).');
    push('');
  } else if (qa.skipped) {
    push('Subjective review pass was skipped for this job.');
    push('');
  }

  if (qa.repairStats?.attempted > 0) {
    push(`Repair pass: attempted ${qa.repairStats.attempted}`
      + (qa.repairStats.llmRepaired != null ? ` · LLM fixed ${qa.repairStats.llmRepaired}` : '')
      + (qa.repairStats.googleRepaired != null ? ` · Google fixed ${qa.repairStats.googleRepaired}` : '')
      + (qa.repairStats.stillFailing != null ? ` · still failing ${qa.repairStats.stillFailing}` : ''));
    push('');
  }

  const cc = qa.completenessCheck;
  if (cc?.ran) {
    push(`Completeness (deterministic): ${cc.autoFlagged ?? 0} auto-flagged of ${cc.total ?? '—'}`
      + (cc.identicalCount != null ? ` · identical-to-source: ${cc.identicalCount}` : '')
      + (cc.placeholderCount != null ? ` · placeholders: ${cc.placeholderCount}` : '')
      + (cc.emptyCount != null ? ` · empty: ${cc.emptyCount}` : ''));
    if (qa.reviewedPairCount != null) {
      push(`Pairs compared: ${qa.reviewedPairCount}/${qa.totalPairCount ?? qa.reviewedPairCount}`);
    }
    push('');
  }

  if (qa.maoriPolicy) { push(`Māori policy: ${qa.maoriPolicy}`); push(''); }
  if (qa.glossaryTermCount != null) { push(`Glossary terms: ${qa.glossaryTermCount}`); push(''); }

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
        const body = (it.used && it.standardForm)
          ? `Used "${it.used}" (standard: "${it.standardForm}")${it.context ? ` — ${it.context}` : ''}`
          : [
            it.source || it.excerpt || it.target || JSON.stringify(it),
            it.issue || it.why || it.reason ? ` — ${it.issue || it.why || it.reason}` : '',
            it.renderedAs || it.proposedTarget ? ` → ${it.renderedAs || it.proposedTarget}` : '',
            it.check ? ` [${it.check}]` : '',
          ].join('');
        push(`  ${idx}${body}`);
      }
    }
    push('');
  }

  if (qa.claimVerification?.note) {
    push(`Claim verification: ${qa.claimVerification.note}`);
  }

  return lines.join('\n');
}

export function downloadQaReport(job, qa, appVersion) {
  const text = buildQaReportText(job, qa, appVersion);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qa-report-${(job.filename || 'document').replace(/\.[^.]+$/, '')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The one-line verdict shown beside a finished job and at the top of its result. It says which KINDS of problem the checks listed, not
 * how many (the number of items changes from run to run on the same document) and it is not an accuracy score.
 *   level: 'problem' | 'check' | 'look' | 'ok' | 'none'
 */
export function resultVerdict(qa) {
  if (!qa) return { level: 'none', label: 'No check results', detail: 'This job has no check results saved.' };
  if (qa.hardFail) return { level: 'problem', label: 'Failed its checks', detail: 'Too much of the translation was missing, empty or unchanged, so no PDF was made.' };
  const has = (k) => Array.isArray(qa[k]) && qa[k].length > 0;
  // Rows the completeness check adds for routine numbers and codes are not a defect; rows the second model adds are.
  const garbled = (qa.garbledOrIncompleteRows || []).some((r) => r && r.check !== 'deterministic_completeness');
  const kinds = [
    has('polarityOrSentenceTypeIssues') && 'meaning may have changed',
    garbled && 'garbled or unfinished parts',
    qa.softFail && 'some parts did not translate cleanly',
  ].filter(Boolean);
  if (kinds.length) return { level: 'check', label: 'Needs checking', detail: `The checks listed: ${kinds.join(', ')}.` };
  const minor = [
    has('uncertainTerms') && 'unsure terms',
    has('restructuredSentences') && 'sentences that were reshaped',
    has('audienceFlags') && 'wording that may not suit the reader',
    has('dialectalChoices') && 'regional word choices',
  ].filter(Boolean);
  if (minor.length) return { level: 'look', label: 'Worth a look', detail: `The checks listed: ${minor.join(', ')}.` };
  if (qa.skipped) return { level: 'none', label: 'Second check not run', detail: 'Only the checks for missing, empty and cut-short parts ran. Nothing was flagged.' };
  return { level: 'ok', label: 'No problems found', detail: 'The checks listed nothing. That is not proof the translation is right.' };
}

// Status colours are deliberately outside the theme (see client/DESIGN.md).
export const VERDICT_COLOURS = {
  problem: '#ef4444',
  check: '#b45309',
  look: '#b45309',
  ok: '#16a34a',
  none: 'var(--color-muted)',
};

/** A job that is neither finished nor running here: the page was closed (or the server restarted) while it ran. */
export function isStalled(job, activeJobId, now = Date.now()) {
  if (['done', 'failed', 'cancelled'].includes(job.status)) return false;
  if (job.id === activeJobId) return false;
  return now - new Date(job.createdAt).getTime() > 30 * 60 * 1000;
}
