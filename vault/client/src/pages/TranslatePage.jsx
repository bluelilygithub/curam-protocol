import React, { useState, useEffect, useRef, useCallback } from 'react';
import { pdf, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { useIcon } from '../providers/IconProvider';
import { LANGUAGES, orderLanguages, languageOptionLabel } from '../utils/translateLanguages';
import { pickPdfFontUrl, needsNotoFont } from '../utils/translatePdfFonts';

// Deployed commit shown on QA/Lessons-learnt reports so a stale build is checkable at a glance
// instead of re-testing a fix against a report that never actually deployed — see /api/health.
// Module-level cache: one fetch per page load, not one per modal open.
let _appVersionCache = null;
function useAppVersion() {
  const [version, setVersion] = useState(_appVersionCache);
  useEffect(() => {
    if (_appVersionCache) return;
    api.get('/api/health').then(r => r.json()).then(d => {
      const v = d.commit ? `${d.commit.slice(0, 7)}${d.branch ? ` (${d.branch})` : ''}` : 'unknown';
      _appVersionCache = v;
      setVersion(v);
    }).catch(() => setVersion('unknown'));
  }, []);
  return version;
}

let _pdfjsLib = null;
async function getPdfJs() {
  if (_pdfjsLib) return _pdfjsLib;
  _pdfjsLib = await import('pdfjs-dist');
  if (_pdfjsLib.GlobalWorkerOptions) {
    _pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url
    ).toString();
  }
  return _pdfjsLib;
}

// Job stage order mirrors server pipeline stages (see docs/translate-agent.md § Pipeline):
// pending → extracting → ocr → preparing → translating → reviewing → generating → done/failed.
const PROGRESS_STAGE_ORDER = ['pending', 'extracting', 'ocr', 'preparing', 'translating', 'reviewing', 'generating'];
const PROGRESS_STEP_LABELS = [
  'Extracting document text',
  'OCR on scanned pages',
  'Preparing glossary',
  'Translating',
  'QA review',
  'Generating PDF',
];

const ACCEPT_UPLOAD =
  '.pdf,.docx,.xlsx,.xls,.txt,application/pdf,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document,'
  + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,'
  + 'application/vnd.ms-excel,text/plain';

function detectUploadKind(file) {
  if (!file) return null;
  const name = (file.name || '').toLowerCase();
  const type = (file.type || '').toLowerCase();
  if (name.endsWith('.pdf') || type === 'application/pdf') return 'pdf';
  if (name.endsWith('.docx')
    || type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (name.endsWith('.xlsx')
    || type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx';
  if (name.endsWith('.xls') || type === 'application/vnd.ms-excel') return 'xls';
  if (name.endsWith('.txt') || type === 'text/plain') return 'txt';
  return null;
}

// ── Shared UI ─────────────────────────────────────────────────────────────────
function Btn({ onClick, disabled, variant = 'primary', children, className = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-opacity hover:opacity-80 disabled:opacity-40 ${className}`}
      style={{
        background: variant === 'primary' ? 'var(--color-primary)' : 'transparent',
        color: variant === 'primary' ? '#fff' : 'var(--color-text)',
        border: variant === 'secondary' ? '1px solid var(--color-border)' : 'none',
      }}
    >
      {children}
    </button>
  );
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-12 px-4"
      style={{ background: 'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div
        className={`relative w-full ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-xl shadow-xl overflow-y-auto`}
        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', maxHeight: '85vh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>{title}</span>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded hover:opacity-60"
            style={{ color: 'var(--color-muted)' }}>✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function Field({ label, children, hint }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{label}</label>
      {children}
      {hint && <p className="text-xs" style={{ color: 'var(--color-muted)', opacity: 0.8 }}>{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, placeholder, type = 'text', ...rest }) {
  return (
    <input type={type} value={value}
      onChange={e => onChange(typeof e === 'string' ? e : e.target.value)}
      placeholder={placeholder}
      className="text-sm px-3 py-2 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
      {...rest}
    />
  );
}

function Sel({ value, onChange, children, ...rest }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-sm px-3 py-2 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
      {...rest}>
      {children}
    </select>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending:    { label: 'Pending',     color: 'var(--color-muted)', bg: 'rgba(0,0,0,0.06)' },
    extracting: { label: 'Extracting',  color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    ocr:        { label: 'OCR',         color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
    preparing:  { label: 'Glossary',    color: '#9333ea', bg: 'rgba(147,51,234,0.1)' },
    translating:{ label: 'Translating', color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
    reviewing:  { label: 'Reviewing',   color: '#c2410c', bg: 'rgba(194,65,12,0.1)' },
    generating: { label: 'Generating',  color: '#d97706', bg: 'rgba(217,119,6,0.1)'  },
    done:       { label: 'Done',        color: '#16a34a', bg: 'rgba(22,163,74,0.1)'  },
    failed:     { label: 'Failed',      color: '#dc2626', bg: 'rgba(220,38,38,0.1)'  },
    cancelled:  { label: 'Cancelled',   color: 'var(--color-muted)', bg: 'rgba(0,0,0,0.06)' },
  };
  const s = map[status] || map.pending;
  return (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium"
      style={{ color: s.color, background: s.bg }}>{s.label}</span>
  );
}

const DOMAIN_OPTIONS = [
  { value: 'ai_compliance', label: 'AI / compliance / IT governance' },
  { value: 'legal', label: 'Legal / contracts' },
  { value: 'finance', label: 'Finance / accounting' },
  { value: 'medical', label: 'Medical / clinical' },
  { value: 'general', label: 'General business' },
  { value: 'other', label: 'Other' },
];

const AUDIENCE_OPTIONS = [
  { value: 'auditor', label: 'Auditor / regulator' },
  { value: 'insurer', label: 'Insurer' },
  { value: 'client', label: 'External client' },
  { value: 'internal', label: 'Internal team' },
  { value: 'other', label: 'Other' },
];

function parseQa(job) {
  if (!job?.qaSummaryJson) return null;
  try {
    return typeof job.qaSummaryJson === 'string' ? JSON.parse(job.qaSummaryJson) : job.qaSummaryJson;
  } catch { return null; }
}

// Plain-text QA report for HITL review — the sections/order mirror what QaPanel renders on
// screen, so the download and the modal never drift apart.
function buildQaReportText(job, qa, appVersion) {
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

function downloadQaReport(job, qa, appVersion) {
  const text = buildQaReportText(job, qa, appVersion);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qa-report-${(job.filename || 'document').replace(/\.[^.]+$/, '')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function QaPanel({ qa, onClose, job, onDownload, onDownloadNative, onDownloadOriginal, onDownloadText }) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [lessonsOpen, setLessonsOpen] = useState(false);
  const addToast = useToastStore(s => s.addToast);
  const appVersion = useAppVersion();

  const sendEmail = async () => {
    if (!emailTo.trim()) { addToast('Enter a recipient email', 'error'); return; }
    setEmailSending(true);
    try {
      const res = await api.post(`/api/translate/jobs/${job.id}/email`, { to: emailTo.trim() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Failed to send');
      addToast(`Emailed ${body.attached?.length || 3} document(s) to ${emailTo.trim()}`, 'success');
      setEmailOpen(false);
      setEmailTo('');
    } catch (e) { addToast(e.message, 'error'); }
    finally { setEmailSending(false); }
  };

  if (!qa) return null;
  const sections = [
    ['Uncertain terms', qa.uncertainTerms],
    ['Dialectal choices (vs standard)', qa.dialectalChoices],
    ['Polarity / sentence-type issues', qa.polarityOrSentenceTypeIssues],
    ['Restructured sentences', qa.restructuredSentences],
    ['Garbled / incomplete rows', qa.garbledOrIncompleteRows],
    ['Audience flags', qa.audienceFlags],
  ];
  const cc = qa.completenessCheck;
  const cv = qa.claimVerification;
  const showBody = qa.hardFail || qa.softFail || !qa.skipped || (qa.garbledOrIncompleteRows?.length > 0);

  return (
    <Modal title="Translation QA summary" onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--color-text)' }}>
        <p className="text-xs font-mono" style={{ color: 'var(--color-muted)' }} title="Deployed commit this report was generated by — check this before re-testing a fix against a stale build">
          Agent build: {appVersion || 'checking…'}
        </p>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => downloadQaReport(job, qa, appVersion)}
            className="text-sm px-4 py-2 rounded-lg font-medium hover:opacity-90"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>
            Download QA report
          </button>
          <button onClick={() => onDownloadOriginal?.(job)}
            className="text-sm px-4 py-2 rounded-lg border font-medium hover:opacity-70"
            title="Download the untouched source file, as uploaded"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            Download original
          </button>
          <button onClick={() => setEmailOpen(v => !v)}
            className="text-sm px-4 py-2 rounded-lg border font-medium hover:opacity-70"
            title="Email the original, translated PDF, and QA report together"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            Email these documents
          </button>
          <button onClick={() => setLessonsOpen(true)}
            className="text-sm px-4 py-2 rounded-lg border font-medium hover:opacity-70"
            title="Turn this job's QA findings into global instructions or glossary terms"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
            Lessons learnt
          </button>
          {job?.status === 'done' && (
            <>
              <button onClick={() => onDownload?.(job)}
                className="text-sm px-4 py-2 rounded-lg border font-medium hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                Download translated PDF
              </button>
              <button onClick={() => onDownloadText?.(job)}
                className="text-sm px-4 py-2 rounded-lg border font-medium hover:opacity-70"
                title="Plain-text export of the translation only — no source column, no styling"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                Download plain text
              </button>
              {job.hasNativeOutput && (
                <button onClick={() => onDownloadNative?.(job)}
                  className="text-sm px-4 py-2 rounded-lg border font-medium hover:opacity-70"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                  Download {/\.xlsx?$/i.test(job.filename || '') ? 'Excel' : 'Word'}
                </button>
              )}
            </>
          )}
        </div>
        {emailOpen && (
          <div className="flex gap-2 items-center flex-wrap">
            <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)}
              placeholder="recipient@example.com"
              className="text-sm px-3 py-2 rounded-lg border flex-1 min-w-48"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
            <button onClick={sendEmail} disabled={emailSending}
              className="text-sm px-4 py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: '#fff' }}>
              {emailSending ? 'Sending…' : 'Send'}
            </button>
            <p className="text-xs w-full" style={{ color: 'var(--color-muted)' }}>
              Sends whichever of the original file, translated PDF, and QA report exist for this job.
            </p>
          </div>
        )}
        {qa.hardFail && (
          <p className="text-xs px-2 py-2 rounded border"
            style={{ borderColor: '#fecaca', background: '#fef2f2', color: '#991b1b' }}>
            Hard QA gate failed{qa.hardFailCode ? ` (${qa.hardFailCode})` : ''}:{' '}
            {qa.overallNotes || 'Translation did not pass completeness checks.'}
          </p>
        )}

        {qa.softFail && !qa.hardFail && (
          <p className="text-xs px-2 py-2 rounded border"
            style={{ borderColor: '#fde68a', background: '#fffbeb', color: '#92400e' }}>
            Completed with warnings{qa.softFailCode ? ` (${qa.softFailCode})` : ''}:{' '}
            {qa.overallNotes || 'Some segments still need review (see Garbled / incomplete rows).'}
          </p>
        )}

        {qa.repairStats && (qa.repairStats.attempted > 0) && (
          <p className="text-xs px-2 py-1.5 rounded border"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
            Repair pass: attempted {qa.repairStats.attempted}
            {qa.repairStats.llmRepaired != null ? ` · LLM fixed ${qa.repairStats.llmRepaired}` : ''}
            {qa.repairStats.googleRepaired != null ? ` · Google fixed ${qa.repairStats.googleRepaired}` : ''}
            {qa.repairStats.stillFailing != null ? ` · still failing ${qa.repairStats.stillFailing}` : ''}
          </p>
        )}

        {qa.skipped && !qa.hardFail && !qa.softFail && (
          <p style={{ color: 'var(--color-muted)' }}>
            Subjective review pass was skipped for this job.
            {cc?.ran ? ' Deterministic completeness still ran on every segment.' : ''}
          </p>
        )}

        {showBody && (
          <>
            {cc?.ran && (
              <p className="text-xs px-2 py-1.5 rounded border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                Completeness (deterministic, before subjective checks):{' '}
                {cc.autoFlagged ?? 0} auto-flagged of {cc.total ?? '—'}
                {cc.identicalCount != null ? ` · identical-to-source: ${cc.identicalCount}` : ''}
                {cc.placeholderCount != null ? ` · placeholders: ${cc.placeholderCount}` : ''}
                {cc.emptyCount != null ? ` · empty: ${cc.emptyCount}` : ''}
                {qa.reviewedPairCount != null
                  ? ` · pairs compared: ${qa.reviewedPairCount}/${qa.totalPairCount ?? qa.reviewedPairCount}`
                  : ''}
              </p>
            )}
            {qa.maoriPolicy && (
              <p className="text-xs px-2 py-1.5 rounded border"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                Māori policy: {qa.maoriPolicy}
              </p>
            )}
            {qa.overallNotes && !qa.hardFail && (
              <p className="text-xs leading-relaxed" style={{ color: 'var(--color-muted)' }}>{qa.overallNotes}</p>
            )}
            {qa.guidance && (
              <p className="text-xs"><strong>Guidance used:</strong> {qa.guidance}</p>
            )}
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
              Translate: {qa.translateModel || '—'} · Review: {qa.reviewModel || '—'}
              {qa.glossaryTermCount != null ? ` · Glossary terms: ${qa.glossaryTermCount}` : ''}
            </p>
            {sections.map(([title, items]) => {
              const empty = !items?.length;
              const isGarbled = title.startsWith('Garbled');
              return (
                <div key={title}>
                  <p className="text-xs font-semibold mb-1">{title} ({Array.isArray(items) ? items.length : 0})</p>
                  {empty ? (
                    <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      None flagged
                      {!isGarbled && cv?.note ? (
                        <span style={{ opacity: 0.85 }}> — treat as unverified claim until spot-checked</span>
                      ) : null}
                    </p>
                  ) : (
                    <ul className="text-xs space-y-1 pl-4 list-disc" style={{ color: 'var(--color-muted)' }}>
                      {items.slice(0, 30).map((it, i) => (
                        <li key={i}>
                          {typeof it.index === 'number' ? `#${it.index} ` : ''}
                          {it.used && it.standardForm
                            ? `Used “${it.used}” (standard: “${it.standardForm}”)${it.context ? ` — ${it.context}` : ''}`
                            : (
                              <>
                                {it.source || it.excerpt || it.target || JSON.stringify(it)}
                                {it.issue || it.why || it.reason ? ` — ${it.issue || it.why || it.reason}` : ''}
                                {it.renderedAs || it.proposedTarget ? ` → ${it.renderedAs || it.proposedTarget}` : ''}
                                {it.check ? ` [${it.check}]` : ''}
                              </>
                            )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {cv?.note && (
              <p className="text-xs px-2 py-1.5 rounded border"
                style={{
                  borderColor: cv.corrections ? '#fde68a' : 'var(--color-border)',
                  background: cv.corrections ? '#fffbeb' : 'transparent',
                  color: 'var(--color-muted)',
                }}>
                Claim verification: {cv.note}
              </p>
            )}
            <p className="text-xs pt-2" style={{ color: 'var(--color-muted)', opacity: 0.85 }}>
              Language-body recommendations (e.g. Te Taura Whiri) are updated over time — verify critical te reo Māori output against current guidance.
            </p>
          </>
        )}
      </div>
      {lessonsOpen && <LessonsLearntModal qa={qa} job={job} appVersion={appVersion} onClose={() => setLessonsOpen(false)} />}
    </Modal>
  );
}

// Severity is a property of the CONTENT (what went wrong), independent of which bucket an item
// landed in — an omission is CRITICAL whether or not it happened to carry a proposedTarget.
// Reason CODES (the machine-generated tokens from translateQaChecks.js, e.g.
// "dnt_term_missing:X", "hallucinated_redaction") are checked first and are authoritative —
// they say exactly what broke. Free-text keyword match is only a fallback for LLM-authored prose
// (issue/reason/why strings) that carries no reason code at all.
const SEVERITY = {
  CRITICAL: { level: 'CRITICAL', color: '#dc2626' },
  MODERATE: { level: 'MODERATE', color: '#d97706' },
  MINOR: { level: 'MINOR', color: 'var(--color-muted)' },
};
const SEVERITY_RANK = { CRITICAL: 3, MODERATE: 2, MINOR: 1 };
const CODE_SEVERITY_RULES = [
  { level: 'CRITICAL', re: /dnt_term_missing|hallucinated_redaction|redaction_token_missing|empty_target/ },
  { level: 'MODERATE', re: /stray_source_word|truncated_short|too_many_identical/ },
];
const TEXT_SEVERITY_RULES = [
  { level: 'CRITICAL', re: /omit|omitted|missing|dropped|redact|coercive|legal|compliance/i },
  { level: 'MODERATE', re: /meaning|logic|revers|shift|mistranslat|incorrect|wrong|drift|truncat/i },
];
function tagSeverity(text, { floor } = {}) {
  const t = String(text || '');
  let level = 'MINOR';
  for (const rule of CODE_SEVERITY_RULES) { if (rule.re.test(t)) { level = rule.level; break; } }
  if (level === 'MINOR') {
    for (const rule of TEXT_SEVERITY_RULES) { if (rule.re.test(t)) { level = rule.level; break; } }
  }
  if (floor && SEVERITY_RANK[floor] > SEVERITY_RANK[level]) level = floor;
  return SEVERITY[level];
}

// Turn a finished job's QA findings into HITL-reviewable "lessons" — process-level fixes for
// the global instruction prompt (every future job, every language) vs. term-level fixes for
// this job's target-language glossary (this language only). Nothing is written until the user
// checks a box and hits Apply — this only proposes. Every item carries a `disposition` (the
// recommended action, in one short phrase) alongside its evidence, so the reviewer isn't
// re-deriving what to do from prose each time.
//
// Findings are grouped by ROOT CAUSE, not flattened to sibling checkboxes:
//  - DNT: every garbledOrIncompleteRows row flagging the SAME missing do-not-translate term
//    (e.g. "21 News" leaking as "21 Actualités" across several rows) is one enforcement-rule
//    finding with N instances, not N separate "lock this rendering" checkboxes — the real fix is
//    a doNotTranslate:true glossary rule, not per-occurrence locks a reviewer could check some of
//    and miss others.
//  - LOCK: only from a genuine `proposedTarget` (proposeGlossary's own suggestion). Gating on
//    this field, and only this field, is deliberate — `target = it.proposedTarget || it.renderedAs`
//    used to fall through to `renderedAs`, which is "what the model actually (wrongly) rendered",
//    turning "here's what's wrong" into "here's what to do" the moment proposedTarget was empty.
//  - DRIFT, split by what the reader actually needs to do next:
//    - enforcement: glossaryDriftTerms — the term is already locked (`lockedTarget`), some rows
//      just didn't apply it. Not a glossary problem; a pipeline/engineering one.
//    - linguistic: review-pass uncertainTerms (`renderedAs`/`issue`, no proposedTarget) — genuine
//      ambiguity with no confirmed correction. Needs a human linguistic call, not a ticket.
//  - STYLE: dialectalChoices — an accepted regional choice, not an error; lockable as-is.
// The model saying a term is already glossary-mandated means "lock" is a no-op, not a suggestion.
const ALREADY_IN_GLOSSARY_RE = /already (?:in |mandated by |present in |part of )?(?:the )?glossary|already (?:standard|locked|mandated)/i;

// A real term/short phrase, not a sentence of explanation. Catches the same field-conflation
// failure the original proposedTarget/renderedAs bug had — this time the MODEL putting
// explanatory prose ("Dre is Quebec French feminine for Dr; in European French...") into a field
// meant to hold a short rendering, rather than client code picking the wrong field. Length +
// explanatory-language heuristics; not perfect, but "42-char sentence with a semicolon" is never
// a real term to lock.
function looksMalformedTerm(s) {
  const t = String(s || '').trim();
  if (!t) return false;
  if (t.length > 40) return true;
  if (/[;]/.test(t)) return true;
  if (/\b(is|means|refers to|in European|in Quebec|standard form|feminine for|masculine for)\b/i.test(t)) return true;
  return false;
}

function buildLessonCandidates(qa) {
  if (!qa) return { global: [], dnt: [], lock: [], driftEnforcement: [], driftLinguistic: [], alreadyStandard: [], style: [] };

  const excerptOf = (it) => it.issue || it.reason || it.why || it.excerpt || it.source || '';
  const snippetOf = (it) => (it.sourceExcerpt || it.targetExcerpt)
    ? { source: it.sourceExcerpt, target: it.targetExcerpt }
    : (it.source && it.target ? { source: it.source, target: it.target } : null);

  // ── DNT root-cause grouping — pull matching rows out of garbledOrIncompleteRows first ──────
  const dntGroups = new Map();
  const dntRowKeys = new Set();
  (qa.garbledOrIncompleteRows || []).forEach((it, i) => {
    const m = String(it.issue || '').match(/dnt_term_missing:([^;]+)/);
    if (!m) return;
    const term = m[1].trim();
    if (!term) return;
    dntRowKeys.add(i);
    const key = term.toLowerCase();
    const g = dntGroups.get(key) || { term, instances: [] };
    g.instances.push({ index: it.index, source: it.source, target: it.target, excerpt: it.excerpt });
    dntGroups.set(key, g);
  });
  const dnt = [...dntGroups.values()].map((g, i) => ({
    id: `dnt-${i}`,
    disposition: 'Do-not-translate rule',
    detail: `"${g.term}" leaked into the translation in ${g.instances.length} row(s) instead of staying untranslated — a per-row lock wouldn't stop the next occurrence; the fix is one doNotTranslate rule.`,
    instances: g.instances,
    severity: SEVERITY.CRITICAL,
    term: { source: g.term, target: '', doNotTranslate: true, note: 'Added from Lessons learnt — do-not-translate enforcement gap' },
  }));
  // Same term can independently surface from garbledOrIncompleteRows (above, grouped into `dnt`)
  // AND from the review pass's own uncertainTerms — two different data sources describing the
  // same root cause. Without this, e.g. "21 News" showed up once as a grouped DNT finding and
  // again as a standalone "needs linguistic decision" item: same story, two disconnected bullets.
  const dntTermKeys = new Set(dntGroups.keys());

  const global = (qa.polarityOrSentenceTypeIssues || []).map((it, i) => ({
    id: `polarity-${i}`,
    disposition: 'Global rule',
    text: `Watch for meaning/logic reversals — e.g. "${excerptOf(it)}".`,
    severity: tagSeverity(excerptOf(it), { floor: 'MODERATE' }),
  })).concat((qa.restructuredSentences || []).map((it, i) => ({
    id: `restructured-${i}`,
    disposition: 'Global rule',
    text: `Keep original sentence structure where the source allows it — flagged: "${excerptOf(it)}".`,
    severity: tagSeverity(excerptOf(it)),
  }))).concat((qa.audienceFlags || []).map((it, i) => ({
    id: `audience-${i}`,
    disposition: 'Global rule',
    text: `Grammar/localization flag for this audience — "${excerptOf(it)}".`,
    severity: tagSeverity(excerptOf(it)),
  }))).concat((qa.garbledOrIncompleteRows || [])
    .filter((it, i) => it?.check !== 'deterministic_completeness' && !dntRowKeys.has(i))
    .map((it, i) => ({
      id: `garbled-${i}`,
      disposition: 'Global rule',
      text: `Don't leave source markup/content untranslated — seen: "${excerptOf(it)}".`,
      severity: tagSeverity(excerptOf(it)),
    })));

  const lock = [];
  const driftEnforcement = [];
  const driftLinguistic = [];
  const alreadyStandard = [];
  (qa.uncertainTerms || []).forEach((it, i) => {
    if (!it?.source) return;
    if (dntTermKeys.has(it.source.trim().toLowerCase())) return; // already covered by the dnt group above
    if (ALREADY_IN_GLOSSARY_RE.test(it.reason || '')) {
      // The model's own reason says this is already glossary-mandated — locking it "again" is
      // not a new suggestion, it's a no-op dressed up as one. Route to informational, not Lock.
      alreadyStandard.push({
        id: `already-${i}`,
        disposition: 'No action — already in glossary',
        source: it.source,
        detail: it.reason,
        severity: SEVERITY.MINOR,
      });
    } else if (it.proposedTarget && it.proposedTarget !== '(varies)') {
      if (looksMalformedTerm(it.source) || looksMalformedTerm(it.proposedTarget)) {
        // Same field-conflation failure mode as the original proposedTarget/renderedAs bug, just
        // from the model itself this time: explanatory prose landed in a value field that's
        // supposed to hold a short term. Don't trust it as a lockable pair — flag it instead.
        driftLinguistic.push({
          id: `malformed-lock-${i}`,
          disposition: 'Needs manual entry (malformed field)',
          source: it.source,
          detail: `Looks like explanatory text landed in a term field, not a real term — raw: source="${it.source}", proposedTarget="${it.proposedTarget}".`,
          snippet: snippetOf(it),
          severity: SEVERITY.MODERATE,
        });
      } else {
        lock.push({
          id: `lock-${i}`,
          disposition: 'Lock rendering',
          label: `Lock "${it.source}" → "${it.proposedTarget}"${it.reason ? ` (${it.reason})` : ''}`,
          severity: tagSeverity(it.reason),
          snippet: snippetOf(it),
          term: { source: it.source, target: it.proposedTarget, note: it.reason || undefined },
        });
      }
    } else if (it.lockedTarget) {
      // glossaryDriftTerms — a KNOWN, already-locked glossary term some rows didn't apply.
      // Not a glossary action; an enforcement/pipeline bug to ticket.
      driftEnforcement.push({
        id: `drift-enf-${i}`,
        disposition: 'Enforcement gap (engineering)',
        source: it.source,
        detail: `Already locked to "${it.lockedTarget}" — some rows didn't use it${it.rows?.length ? ` (rows ${it.rows.join(', ')})` : ''}.`,
        severity: tagSeverity(it.issue, { floor: 'MODERATE' }),
      });
    } else {
      // renderedAs/issue shape — flagged, no confirmed correction. Genuine linguistic call.
      driftLinguistic.push({
        id: `drift-ling-${i}`,
        disposition: 'Needs linguistic decision',
        source: it.source,
        detail: it.issue || `Rendered as "${it.renderedAs}" — flagged, no confirmed correction.`,
        snippet: snippetOf(it),
        severity: tagSeverity(it.issue),
      });
    }
  });

  const style = [];
  (qa.dialectalChoices || []).filter((it) => it.used).forEach((it, i) => {
    const sourceVal = it.standardForm || it.used;
    if (ALREADY_IN_GLOSSARY_RE.test(it.context || '')) {
      alreadyStandard.push({
        id: `already-dialect-${i}`,
        disposition: 'No action — already in glossary',
        source: it.used,
        detail: it.context,
        severity: SEVERITY.MINOR,
      });
      return;
    }
    if (looksMalformedTerm(sourceVal) || looksMalformedTerm(it.used)) {
      driftLinguistic.push({
        id: `malformed-dialect-${i}`,
        disposition: 'Needs manual entry (malformed field)',
        source: it.used,
        detail: `Looks like explanatory text landed in a term field, not a real term — raw: standardForm="${it.standardForm || ''}", used="${it.used}".`,
        snippet: snippetOf(it),
        severity: SEVERITY.MODERATE,
      });
      return;
    }
    style.push({
      id: `dialect-${i}`,
      disposition: 'Lock regional form',
      label: `Lock "${sourceVal}" → "${it.used}" as the standard rendering${it.context ? ` (${it.context})` : ''}`,
      severity: SEVERITY.MINOR,
      snippet: snippetOf(it),
      term: { source: sourceVal, target: it.used, note: it.context || undefined },
    });
  });

  return { global, dnt, lock, driftEnforcement, driftLinguistic, alreadyStandard, style };
}

function SeverityBadge({ severity }) {
  if (!severity) return null;
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
      style={{ color: severity.color, border: `1px solid ${severity.color}`, opacity: 0.9 }}>
      {severity.level}
    </span>
  );
}

function DispositionTag({ text }) {
  if (!text) return null;
  return (
    <span className="text-xs font-medium shrink-0" style={{ color: 'var(--color-primary)' }}>
      [{text}]
    </span>
  );
}

// A term drifting once is noise; the same term recurring across jobs (2+) is a pattern worth
// actually fixing rather than re-triaging by eye every time. Only shown once frequency data has
// loaded (driftFreq !== null) and only when it's actually recurred.
function FrequencyBadge({ count }) {
  if (!count || count < 2) return null;
  return (
    <span className="text-xs font-medium px-1.5 py-0.5 rounded shrink-0"
      style={{ color: '#7c3aed', border: '1px solid #7c3aed', opacity: 0.9 }}
      title="How many separate jobs this exact term has drifted in">
      seen in {count} jobs
    </span>
  );
}

function Snippet({ snippet }) {
  if (!snippet || (!snippet.source && !snippet.target)) return null;
  return (
    <div className="text-xs mt-0.5 pl-2 border-l-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
      {snippet.source && <div>SRC: {snippet.source}</div>}
      {snippet.target && <div>TGT: {snippet.target}</div>}
    </div>
  );
}

function LessonsLearntModal({ qa, job, appVersion, onClose }) {
  const addToast = useToastStore(s => s.addToast);
  const { global, dnt, lock, driftEnforcement, driftLinguistic, alreadyStandard, style } = buildLessonCandidates(qa);
  const [checkedGlobal, setCheckedGlobal] = useState(() => new Set());
  const [checkedDnt, setCheckedDnt] = useState(() => new Set());
  const [checkedLock, setCheckedLock] = useState(() => new Set());
  const [checkedStyle, setCheckedStyle] = useState(() => new Set());
  const [applying, setApplying] = useState(false);
  // Cross-job frequency (termKey -> jobCount) — a term drifting once is noise, drifting across
  // several jobs is a pattern. Tells the reader which enforcement/linguistic items are worth
  // acting on without them eyeballing single reports over time.
  const [driftFreq, setDriftFreq] = useState(null);
  const [confirmDrafts, setConfirmDrafts] = useState({}); // id -> typed "confirmed standard" value
  const [confirming, setConfirming] = useState(null); // id currently saving

  useEffect(() => {
    if (!job?.targetLanguage) return;
    api.get(`/api/translate/drift-frequency/${job.targetLanguage}`)
      .then(r => r.json())
      .then(rows => {
        const map = {};
        (rows || []).forEach(r => { map[r.termKey] = r.jobCount; });
        setDriftFreq(map);
      })
      .catch(() => setDriftFreq({}));
  }, [job?.targetLanguage]);

  const freqFor = (source) => driftFreq?.[String(source || '').trim().toLowerCase()] || 0;

  const toggle = (setSet, id) => {
    setSet(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Select-all / clear toggle for a section — flips based on current state (if everything's
  // already checked, clicking clears instead of re-checking, so it's one button either way).
  const selectAll = (setSet, items) => {
    setSet(prev => (prev.size === items.length ? new Set() : new Set(items.map(i => i.id))));
  };

  const [logOpen, setLogOpen] = useState(false);

  // "Confirm as standard" — for a Needs-linguistic-decision item, the reviewer (a human who
  // actually knows the target language) supplies the correct rendering the tool couldn't
  // determine on its own; that becomes a real glossary lock, same destination as Lock/style, just
  // gated on explicit human confirmation instead of the model's own proposedTarget.
  const confirmAsStandard = async (item) => {
    const value = (confirmDrafts[item.id] || '').trim();
    if (!value) { addToast('Enter the confirmed rendering first', 'error'); return; }
    if (!job?.targetLanguage) return;
    setConfirming(item.id);
    try {
      const res = await api.post('/api/translate/lessons/apply', {
        targetLanguage: job.targetLanguage,
        terms: [{
          source: item.source, target: value, disposition: 'Confirmed as standard',
          note: 'Confirmed as standard from Lessons learnt',
        }],
        jobId: job?.id,
        jobFilename: job?.filename,
      });
      if (!res.ok) throw new Error('Could not save glossary term');
      addToast(`"${item.source}" → "${value}" locked into the glossary`, 'success');
      setConfirmDrafts(prev => { const n = { ...prev }; delete n[item.id]; return n; });
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setConfirming(null);
    }
  };

  const nothingToShow = global.length === 0 && dnt.length === 0 && lock.length === 0
    && driftEnforcement.length === 0 && driftLinguistic.length === 0
    && alreadyStandard.length === 0 && style.length === 0;
  const nothingChecked = checkedGlobal.size === 0 && checkedDnt.size === 0
    && checkedLock.size === 0 && checkedStyle.size === 0;

  const apply = async () => {
    setApplying(true);
    try {
      const globalLines = global.filter(g => checkedGlobal.has(g.id)).map(g => g.text);
      const checkedTerms = [
        ...dnt.filter(d => checkedDnt.has(d.id)).map(d => ({ ...d.term, disposition: d.disposition })),
        ...lock.filter(l => checkedLock.has(l.id)).map(l => ({ ...l.term, disposition: l.disposition })),
        ...style.filter(s => checkedStyle.has(s.id)).map(s => ({ ...s.term, disposition: s.disposition })),
      ];
      const res = await api.post('/api/translate/lessons/apply', {
        targetLanguage: job?.targetLanguage,
        globalLines,
        terms: checkedTerms,
        jobId: job?.id,
        jobFilename: job?.filename,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not apply selected items');

      const parts = [];
      if (data.globalApplied) parts.push(`${data.globalApplied} added to global instructions`);
      if (data.termsApplied) parts.push(`${data.termsApplied} added to ${job?.targetLanguage || 'language'} glossary`);
      addToast(parts.length ? parts.join(' · ') : 'Nothing selected', parts.length ? 'success' : 'error');
      if (parts.length) onClose();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setApplying(false);
    }
  };

  return (
    <Modal title="Lessons learnt" onClose={onClose} wide>
      <div className="flex flex-col gap-4 text-sm" style={{ color: 'var(--color-text)' }}>
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs font-mono" style={{ color: 'var(--color-muted)' }} title="Deployed commit this checklist's grouping/severity/disposition logic ran on — check this before re-testing a fix against a stale build">
            Agent build: {appVersion || 'checking…'}
          </p>
          <button onClick={() => setLogOpen(true)}
            className="text-xs font-medium hover:opacity-70 shrink-0"
            style={{ color: 'var(--color-primary)' }}>
            View lessons log
          </button>
        </div>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Findings from this job's QA review, grouped by root cause with a recommended action per
          item. Checkable items add to the shared instruction prompt or the{' '}
          {job?.targetLanguage || 'target-language'} glossary; the rest need a human call this
          panel can't make for you.
        </p>

        {nothingToShow ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>No QA findings on this job to learn from.</p>
        ) : (
          <>
            {dnt.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold">Do-not-translate rules — {dnt.length}</p>
                  <button onClick={() => selectAll(setCheckedDnt, dnt)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedDnt.size === dnt.length ? 'Clear' : 'Select all'}
                  </button>
                </div>
                <ul className="space-y-2">
                  {dnt.map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedDnt.has(d.id)}
                        onChange={() => toggle(setCheckedDnt, d.id)} />
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={d.severity} />
                          <DispositionTag text={d.disposition} />
                          <span className="text-xs">
                            <strong>"{d.term.source}"</strong> — {d.detail}
                          </span>
                        </div>
                        <div className="text-xs mt-1 pl-2 border-l-2" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                          {d.instances.slice(0, 3).map((inst, i) => (
                            <div key={i}>
                              {typeof inst.index === 'number' ? `#${inst.index} ` : ''}
                              {inst.target ? `TGT: ${inst.target.slice(0, 140)}` : (inst.excerpt || '').slice(0, 140)}
                            </div>
                          ))}
                          {d.instances.length > 3 && <div>…and {d.instances.length - 3} more</div>}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold">Global suggestions (instruction prompt) — {global.length}</p>
                {global.length > 0 && (
                  <button onClick={() => selectAll(setCheckedGlobal, global)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedGlobal.size === global.length ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {global.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None flagged.</p>
              ) : (
                <ul className="space-y-1.5">
                  {global.map(g => (
                    <li key={g.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedGlobal.has(g.id)}
                        onChange={() => toggle(setCheckedGlobal, g.id)} />
                      <SeverityBadge severity={g.severity} />
                      <DispositionTag text={g.disposition} />
                      <span className="text-xs">{g.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold">
                  Lock into glossary ({job?.targetLanguage || '—'}) — {lock.length}
                </p>
                {lock.length > 0 && (
                  <button onClick={() => selectAll(setCheckedLock, lock)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedLock.size === lock.length ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {lock.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None flagged.</p>
              ) : (
                <ul className="space-y-1.5">
                  {lock.map(l => (
                    <li key={l.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedLock.has(l.id)}
                        onChange={() => toggle(setCheckedLock, l.id)} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={l.severity} />
                          <DispositionTag text={l.disposition} />
                          <span className="text-xs">{l.label}</span>
                        </div>
                        <Snippet snippet={l.snippet} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold">
                  Regional/style choices to lock ({job?.targetLanguage || '—'}) — {style.length}
                </p>
                {style.length > 0 && (
                  <button onClick={() => selectAll(setCheckedStyle, style)} className="text-xs font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
                    {checkedStyle.size === style.length ? 'Clear' : 'Select all'}
                  </button>
                )}
              </div>
              {style.length === 0 ? (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None flagged.</p>
              ) : (
                <ul className="space-y-1.5">
                  {style.map(s => (
                    <li key={s.id} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-0.5" checked={checkedStyle.has(s.id)}
                        onChange={() => toggle(setCheckedStyle, s.id)} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={s.severity} />
                          <DispositionTag text={s.disposition} />
                          <span className="text-xs">{s.label}</span>
                        </div>
                        <Snippet snippet={s.snippet} />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {driftEnforcement.length > 0 && (
              <details>
                <summary className="text-xs font-semibold mb-2 cursor-pointer select-none">
                  Enforcement gap — engineering ({driftEnforcement.length}) — term already locked, not a glossary edit
                </summary>
                {driftFreq && (
                  <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                    Ignore one-offs; a "seen in N jobs" badge means it's a real pattern, not this job's noise.
                  </p>
                )}
                <ul className="space-y-1.5">
                  {[...driftEnforcement].sort((a, b) => freqFor(b.source) - freqFor(a.source)).map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <SeverityBadge severity={d.severity} />
                      <DispositionTag text={d.disposition} />
                      <FrequencyBadge count={freqFor(d.source)} />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        <strong style={{ color: 'var(--color-text)' }}>{d.source}</strong> — {d.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {driftLinguistic.length > 0 && (
              <div>
                <p className="text-xs font-semibold mb-2">
                  Needs linguistic decision ({driftLinguistic.length}) — no confirmed correction yet
                </p>
                <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                  If you (or a translator) know the right rendering, type it and confirm — that locks it into the {job?.targetLanguage || 'target-language'} glossary immediately, same as Lock above.
                </p>
                <ul className="space-y-1.5">
                  {[...driftLinguistic].sort((a, b) => freqFor(b.source) - freqFor(a.source)).map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <SeverityBadge severity={d.severity} />
                          <DispositionTag text={d.disposition} />
                          <FrequencyBadge count={freqFor(d.source)} />
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                            <strong style={{ color: 'var(--color-text)' }}>{d.source}</strong> — {d.detail}
                          </span>
                        </div>
                        <Snippet snippet={d.snippet} />
                        <div className="flex items-center gap-2 mt-1">
                          <input type="text" placeholder="Confirmed standard rendering…"
                            value={confirmDrafts[d.id] || ''}
                            onChange={(e) => setConfirmDrafts(prev => ({ ...prev, [d.id]: e.target.value }))}
                            className="text-xs px-2 py-1 rounded border flex-1 min-w-40"
                            style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                          <button onClick={() => confirmAsStandard(d)} disabled={confirming === d.id || !(confirmDrafts[d.id] || '').trim()}
                            className="text-xs px-2.5 py-1 rounded font-medium hover:opacity-90 disabled:opacity-50"
                            style={{ background: 'var(--color-primary)', color: '#fff' }}>
                            {confirming === d.id ? 'Saving…' : 'Confirm as standard'}
                          </button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {alreadyStandard.length > 0 && (
              <details>
                <summary className="text-xs font-semibold mb-2 cursor-pointer select-none">
                  Already in glossary ({alreadyStandard.length}) — no action needed
                </summary>
                <ul className="space-y-1.5">
                  {alreadyStandard.map(d => (
                    <li key={d.id} className="flex items-start gap-2">
                      <SeverityBadge severity={d.severity} />
                      <DispositionTag text={d.disposition} />
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        <strong style={{ color: 'var(--color-text)' }}>{d.source}</strong> — {d.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="flex justify-end">
              <button onClick={apply} disabled={applying || nothingChecked}
                className="text-sm px-4 py-2 rounded-lg font-medium hover:opacity-90 disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: '#fff' }}>
                {applying ? 'Applying…' : 'Apply selected'}
              </button>
            </div>
          </>
        )}
      </div>
      {logOpen && <LessonsLogModal defaultLanguage={job?.targetLanguage} onClose={() => setLogOpen(false)} />}
    </Modal>
  );
}

// Audit trail for everything applied via "Lessons learnt" — the apply action itself only writes
// to a free-text Settings blob (global) or a learned glossary's term list (per language), neither
// of which carries history. This reads translate_lessons_log, one row per applied item, so
// "what did we apply, and when" doesn't require reconstructing it from a growing text blob and
// term `note` fields.
function LessonsLogModal({ defaultLanguage, onClose }) {
  const [scope, setScope] = useState('all'); // 'all' | 'global' | 'language'
  const [lang, setLang] = useState(defaultLanguage || '');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setRows(null);
    setError('');
    const params = new URLSearchParams();
    if (scope !== 'all') params.set('scope', scope);
    if (scope !== 'global' && lang) params.set('targetLanguage', lang);
    api.get(`/api/translate/lessons?${params.toString()}`)
      .then(r => r.json())
      .then(setRows)
      .catch(() => setError('Could not load the lessons log'));
  }, [scope, lang]);

  return (
    <Modal title="Lessons log" onClose={onClose} wide>
      <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--color-text)' }}>
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Every item ever applied from a "Lessons learnt" panel, newest first — global instruction
          lines and per-language glossary locks, each with the job it came from.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-44">
            <Sel value={scope} onChange={setScope}>
              <option value="all">All</option>
              <option value="global">Global rules only</option>
              <option value="language">Language locks only</option>
            </Sel>
          </div>
          {scope !== 'global' && (
            <div className="w-44">
              <Sel value={lang} onChange={setLang}>
                <option value="">Any language</option>
                {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
              </Sel>
            </div>
          )}
        </div>

        {error && <p className="text-xs" style={{ color: '#dc2626' }}>{error}</p>}
        {!error && rows === null && <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Loading…</p>}
        {!error && rows && rows.length === 0 && (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Nothing applied yet for this filter.</p>
        )}
        {!error && rows && rows.length > 0 && (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-xs">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Date', 'Scope', 'Disposition', 'Applied', 'Job'].map(h => (
                    <th key={h} className="text-left px-2 py-1.5 font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-muted)' }}>
                      {new Date(r.createdAt).toLocaleDateString('en-AU')}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.scope === 'global' ? 'Global' : (LANGUAGES.find(l => l.code === r.targetLanguage)?.label || r.targetLanguage)}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-primary)' }}>{r.disposition}</td>
                    <td className="px-2 py-1.5">
                      {r.sourceTerm ? <strong>"{r.sourceTerm}"{r.targetTerm ? ` → "${r.targetTerm}"` : ''}</strong> : null}
                      {r.detail && <div style={{ color: r.sourceTerm ? 'var(--color-muted)' : 'var(--color-text)' }}>{r.detail}</div>}
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: 'var(--color-muted)' }} title={r.jobFilename || ''}>
                      {r.jobId ? `#${r.jobId}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── PDF generation (client-side) ──────────────────────────────────────────────
// Font-selection logic lives in translatePdfFonts.js (plain JS, unit-tested with node — see
// translatePdfFonts.test.js) so the font-fallback regression it guards against (mi → en font
// selection checking target only, missing that source needed Noto) can be tested without a
// bundler/JSX. Imported here, not duplicated, so the test suite verifies the logic this page
// actually runs.
// react-pdf/textkit runs every word through a hyphenation callback to compute line-wrap
// candidates — by default an English-syllable hyphenator. Fed a word in a language it
// doesn't recognise (te reo Māori, Polish, etc.), it can split and reconstruct the word
// wrong, corrupting letters around the break — not only at actual wrap points, since the
// callback also runs during width-fitting for words that never end up wrapping. Confirmed
// on a real mi → en job: "Māori" rendered as "M ori" and "Kōhanga" as "KMhanga" throughout
// the PDF even though the correct Noto font was already selected and its glyphs are all
// present — the corruption was happening in text-layout, not glyph rendering. Disabling
// hyphenation (treat every word as unbreakable) removes the callback from the picture
// entirely. Registered once; @react-pdf de-dupes repeat calls internally. This is a
// module-level Font singleton local to THIS bundle — server-side PDF generators
// (textToPdf.js, webExtractorPdf.js, propertyScenarioPdf.js, invoicePdf.js) are separate
// processes and each needs (or already has) its own registerHyphenationCallback call; this
// one only protects client-side renders in this page.
let hyphenationDisabled = false;
function disableHyphenation() {
  if (hyphenationDisabled) return;
  hyphenationDisabled = true;
  try {
    Font.registerHyphenationCallback((word) => [word]);
  } catch {}
}

async function registerFonts(targetLanguage, sourceLanguage) {
  disableHyphenation();
  const fontUrl = pickPdfFontUrl(targetLanguage, sourceLanguage);
  if (!fontUrl) return;
  try {
    Font.register({ family: 'NotoTarget', src: fontUrl });
  } catch {}
}

function buildBilingualPdf({ sourceByPage, translatedByPage, pageCount, scannedPages = [],
    avgOcrConfidence, sourceLanguage, targetLanguage, pageLabels = {}, sourceFormat = 'pdf',
    pdfLayout = 'side-by-side', engine = 'llm' }) {
  const isLowConf = (pg) => scannedPages.includes(pg) && avgOcrConfidence != null && avgOcrConfidence < 0.7;
  const footerText = engine === 'google'
    ? 'Google Translate · for reference only · not legally certified'
    : 'AI-generated translation (Vault LLM) · for reference only · not legally certified';
  const useNoto = needsNotoFont(targetLanguage, sourceLanguage);
  const layout = ['side-by-side', 'translation-only', 'bilingual-pages'].includes(pdfLayout)
    ? pdfLayout
    : 'side-by-side';

  const styles = StyleSheet.create({
    page:     { padding: 40, fontFamily: useNoto ? 'NotoTarget' : 'Helvetica' },
    header:   { fontSize: 9, color: '#6b7280', marginBottom: 12, paddingBottom: 6,
                borderBottom: '1px solid #e5e7eb', flexDirection: 'row', justifyContent: 'space-between' },
    langBadge:{ fontSize: 8, backgroundColor: '#f3f4f6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    warning:  { backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4,
                padding: 6, marginBottom: 10, fontSize: 8, color: '#92400e' },
    para:     { fontSize: 10, color: '#1f2937', marginBottom: 6, lineHeight: 1.6 },
    paraSm:   { fontSize: 9, color: '#1f2937', marginBottom: 5, lineHeight: 1.5 },
    footer:   { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7,
                color: '#9ca3af', textAlign: 'center', borderTop: '1px solid #e5e7eb', paddingTop: 4 },
    sourceHeader: { fontSize: 9, fontWeight: 'bold', color: '#374151' },
    transHeader:  { fontSize: 9, fontWeight: 'bold', color: '#1d4ed8' },
    columns:  { flexDirection: 'row', gap: 12, flexGrow: 1 },
    col:      { width: '48%', paddingRight: 6 },
    colRight: { width: '48%', paddingLeft: 6, borderLeft: '1px solid #e5e7eb' },
    colTitle: { fontSize: 8, fontWeight: 'bold', marginBottom: 8, color: '#6b7280' },
    colTitleTrans: { fontSize: 8, fontWeight: 'bold', marginBottom: 8, color: '#1d4ed8' },
  });

  const langLabel = LANGUAGES.find(l => l.code === targetLanguage)?.label || targetLanguage;
  const srcLabel  = sourceLanguage && sourceLanguage !== 'auto'
    ? (LANGUAGES.find(l => l.code === sourceLanguage)?.label || sourceLanguage)
    : 'Original';

  const sectionLabel = (pg) => pageLabels[pg] || pageLabels[String(pg)]
    || (sourceFormat === 'xlsx' || sourceFormat === 'xls' ? `Sheet ${pg}` : `Page ${pg}`);

  const pages = [];
  for (let pg = 1; pg <= pageCount; pg++) {
    const srcParas  = sourceByPage[pg]  || sourceByPage[String(pg)] || [];
    const trnParas  = translatedByPage[pg] || translatedByPage[String(pg)] || [];
    const lowConf   = isLowConf(pg);
    const label     = sectionLabel(pg);

    if (layout === 'translation-only') {
      pages.push(
        <Page key={`trn-${pg}`} size="A4" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.transHeader}>TRANSLATION · {label}</Text>
            <Text style={styles.langBadge}>{langLabel}</Text>
          </View>
          {lowConf && (
            <View style={styles.warning}>
              <Text>⚠ Source page had low OCR confidence — translation may be inaccurate</Text>
            </View>
          )}
          {trnParas.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
          <Text style={styles.footer}>{footerText}</Text>
        </Page>
      );
      continue;
    }

    if (layout === 'side-by-side') {
      pages.push(
        <Page key={`sbs-${pg}`} size="A4" style={styles.page}>
          <View style={styles.header}>
            <Text style={styles.sourceHeader}>SIDE BY SIDE · {label}</Text>
            <Text style={styles.langBadge}>{srcLabel} → {langLabel}</Text>
          </View>
          {lowConf && (
            <View style={styles.warning}>
              <Text>⚠ Low OCR confidence on this page — review carefully</Text>
            </View>
          )}
          <View style={styles.columns}>
            <View style={styles.col}>
              <Text style={styles.colTitle}>ORIGINAL</Text>
              {srcParas.map((p, i) => <Text key={i} style={styles.paraSm}>{p}</Text>)}
            </View>
            <View style={styles.colRight}>
              <Text style={styles.colTitleTrans}>TRANSLATION</Text>
              {trnParas.map((p, i) => <Text key={i} style={styles.paraSm}>{p}</Text>)}
            </View>
          </View>
          <Text style={styles.footer}>{footerText}</Text>
        </Page>
      );
      continue;
    }

    // bilingual-pages: original page then translation page
    pages.push(
      <Page key={`src-${pg}`} size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.sourceHeader}>ORIGINAL · {label}</Text>
          </View>
          <Text style={styles.langBadge}>{srcLabel}</Text>
        </View>
        {lowConf && (
          <View style={styles.warning}>
            <Text>⚠ Low OCR confidence on this page — review carefully</Text>
          </View>
        )}
        {srcParas.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
        <Text style={styles.footer}>AI-generated translation · for reference only · not legally certified</Text>
      </Page>
    );

    pages.push(
      <Page key={`trn-${pg}`} size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.transHeader}>TRANSLATION · {label}</Text>
          </View>
          <Text style={styles.langBadge}>{langLabel}</Text>
        </View>
        {lowConf && (
          <View style={styles.warning}>
            <Text>⚠ Source page had low OCR confidence — translation may be inaccurate</Text>
          </View>
        )}
        {trnParas.map((p, i) => <Text key={i} style={styles.para}>{p}</Text>)}
        <Text style={styles.footer}>AI-generated translation · for reference only · not legally certified</Text>
      </Page>
    );
  }

  return <Document>{pages}</Document>;
}

// ── Translations tab ──────────────────────────────────────────────────────────
function TranslationsTab({ glossaries }) {
  const [jobs, setJobs]             = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [file, setFile]             = useState(null);
  const [dragOver, setDragOver]     = useState(false);
  const [pasteMode, setPasteMode]   = useState(false);
  const [pasteText, setPasteText]   = useState('');
  // Target language is a Settings-level choice (Settings → AI & Chat → Translate agent), not
  // picked per job — loaded once below and used read-only here.
  const [targetLang, setTargetLang] = useState('fr');
  const [languageOptions, setLanguageOptions] = useState(LANGUAGES); // admin-orderable, see Settings → Translate agent
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [glossaryId, setGlossaryId] = useState('');
  // Default on: every job contributes to (and benefits from) that language's learned glossary
  // unless a manual glossary is picked instead. Was opt-in before — nothing accumulated because
  // nobody thought to tick a checkbox on every run.
  const [useGlobalGlossary, setUseGlobalGlossary] = useState(true);
  const [globalGlossary, setGlobalGlossary] = useState(null); // { termCount } for the current targetLang, or null if none yet
  const [domain, setDomain] = useState('general');
  const [audience, setAudience] = useState('client');
  const [tone, setTone] = useState('natural');
  const [mustKeepTerms, setMustKeepTerms] = useState('');
  const [intakeNotes, setIntakeNotes] = useState('');
  const [regionalAudience, setRegionalAudience] = useState('');
  const [enableReview, setEnableReview] = useState(true);
  const [engine, setEngine] = useState('llm'); // llm | google
  const [pdfLayout, setPdfLayout] = useState('translation-only'); // translation-only | bilingual-pages
  const [engineAvailability, setEngineAvailability] = useState({ llm: true, google: false });
  const [qaJob, setQaJob] = useState(null);
  const [preflight, setPreflight]   = useState(null); // { pageCount, scannedCount, scannedImages }
  const [preflighting, setPreflighting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [activeJobId, setActiveJobId] = useState(null);
  const [activeJob, setActiveJob]   = useState(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const fileRef = useRef(null);
  const addToast = useToastStore(s => s.addToast);
  const pollRef = useRef(null);
  const { startProcessing, stopProcessing, setProcessingSteps, updateProcessingDetail } = useProcessingStore();

  const loadJobs = useCallback(() => {
    api.get('/api/translate/jobs').then(r => r.json()).then(setJobs).catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Look up whether a global (auto-learned) glossary already exists for the chosen target
  // language — surfaced as an opt-in checkbox rather than forcing the manual glossary picker.
  useEffect(() => {
    if (!targetLang) { setGlobalGlossary(null); return; }
    api.get(`/api/translate/glossaries/global/${targetLang}`).then(r => r.json()).then(setGlobalGlossary).catch(() => setGlobalGlossary(null));
  }, [targetLang]);

  useEffect(() => {
    api.get('/api/translate/config').then(r => r.json()).then((d) => {
      const llmOk = d.engines?.llm?.available !== false && (d.engines?.llm?.available || d.configured);
      const googleOk = Boolean(d.engines?.google?.available);
      setEngineAvailability({ llm: Boolean(d.engines?.llm?.available ?? llmOk), google: googleOk });
      if (!d.engines?.llm?.available && googleOk) {
        setEngine('google');
        setEnableReview(false);
      }
    }).catch(() => {});
    api.get('/api/settings').then(r => r.json()).then((s) => {
      if (s.translate_target_language) setTargetLang(s.translate_target_language);
    }).catch(() => {});
    api.get('/api/settings/translate-language-order').then(r => r.json()).then((d) => {
      if (Array.isArray(d.order) && d.order.length) setLanguageOptions(orderLanguages(d.order));
    }).catch(() => {});
  }, []);

  // Preflight: PDF → page/OCR scan; Word/Excel → lightweight metadata only
  const runPreflight = async (selectedFile) => {
    setPreflighting(true);
    setPreflight(null);
    const kind = detectUploadKind(selectedFile);
    try {
      if (kind === 'pdf') {
        const pdfjs = await getPdfJs();
        const buf = await selectedFile.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        const pageCount = doc.numPages;
        let scannedCount = 0;
        const scannedImages = {};

        for (let pg = 1; pg <= pageCount; pg++) {
          const page = await doc.getPage(pg);
          const tc = await page.getTextContent();
          const chars = tc.items.reduce((s, i) => s + (i.str || '').length, 0);

          if (chars < 20) {
            scannedCount++;
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const ctx = canvas.getContext('2d');
            await page.render({ canvasContext: ctx, viewport }).promise;
            scannedImages[pg] = canvas.toDataURL('image/png');
          }
        }

        setPreflight({ kind: 'pdf', pageCount, scannedCount, scannedImages, unitLabel: 'pages' });
        return;
      }

      if (kind === 'docx') {
        setPreflight({
          kind: 'docx',
          pageCount: 1,
          scannedCount: 0,
          scannedImages: {},
          unitLabel: 'document',
          summary: 'Word document — text will be extracted on the server',
        });
        return;
      }

      if (kind === 'xlsx' || kind === 'xls') {
        setPreflight({
          kind,
          pageCount: null,
          scannedCount: 0,
          scannedImages: {},
          unitLabel: 'sheets',
          summary: 'Spreadsheet — text cells will be translated (numbers skipped)',
        });
        return;
      }

      if (kind === 'txt') {
        setPreflight({
          kind: 'txt',
          pageCount: 1,
          scannedCount: 0,
          scannedImages: {},
          unitLabel: 'document',
          summary: 'Plain text — sent to the server as-is',
        });
        return;
      }

      addToast('Unsupported file type', 'error');
      setFile(null);
    } catch (e) {
      addToast('Could not read file: ' + (e.message || 'Unknown error'), 'error');
      setFile(null);
    } finally {
      setPreflighting(false);
    }
  };

  const handleFileSelect = (f) => {
    if (!f) return;
    const kind = detectUploadKind(f);
    if (!kind) {
      addToast('Please select a PDF, Word (.docx), Excel (.xlsx), or text (.txt) file', 'error');
      return;
    }
    if (f.size > 5 * 1024 * 1024) { addToast('File exceeds 5 MB limit', 'error'); return; }
    setFile(f);
    runPreflight(f);
  };

  const usePastedText = () => {
    if (!pasteText.trim()) return;
    const blob = new Blob([pasteText], { type: 'text/plain' });
    const f = new File([blob], 'pasted-text.txt', { type: 'text/plain' });
    setPasteMode(false);
    handleFileSelect(f);
  };

  const handleDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0];
    handleFileSelect(f);
  };

  const handleSubmit = async () => {
    if (!file || !preflight || submitting) return;
    if (engine === 'llm' && !domain) { addToast('Please choose a document domain', 'error'); return; }
    if (engine === 'google' && !engineAvailability.google) {
      addToast('Google Translate is not configured on the server', 'error');
      return;
    }
    if (engine === 'llm' && !engineAvailability.llm) {
      addToast('Vault LLM translate model is not configured', 'error');
      return;
    }
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('targetLanguage', targetLang);
      fd.append('engine', engine);
      fd.append('pdfLayout', pdfLayout);
      if (glossaryId) fd.append('glossaryId', glossaryId);
      if (useGlobalGlossary) fd.append('useGlobalGlossary', 'true');
      fd.append('scannedPageImages', JSON.stringify(preflight.scannedImages || {}));
      fd.append('enableReview', enableReview ? 'true' : 'false');
      fd.append('intakeAnswers', JSON.stringify({
        domain: domain || 'general',
        audience,
        tone,
        mustKeepTerms,
        notes: intakeNotes,
        regionalAudience: targetLang === 'mi' ? regionalAudience.trim() : '',
      }));

      const res  = await api.postForm('/api/translate/jobs', fd);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Submission failed');

      startProcessing('Translating document…', 'Please don’t navigate away while this runs.', {
        steps: PROGRESS_STEP_LABELS,
        onCancel: () => cancelJob(body.jobId),
      });
      setActiveJobId(body.jobId);
      setFile(null); setPreflight(null); setEstimate(null);
      // Reset the native file input's value — selecting the *same* file again (e.g. re-running
      // the same document into another language) doesn't fire a change event otherwise, so the
      // dropzone looks like it silently ignored the click and only a page refresh "fixes" it.
      if (fileRef.current) fileRef.current.value = '';
      loadJobs();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Poll active job — drives the global ProcessingModal (see processingStore) instead of an
  // inline progress row, so a long translation reads the same way as other blocking agent runs
  // (e.g. Property Scenario).
  useEffect(() => {
    if (!activeJobId) return;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res  = await api.get(`/api/translate/jobs/${activeJobId}/status`);
        const data = await res.json();
        setActiveJob(data);

        const stageIdx = PROGRESS_STAGE_ORDER.indexOf(data.status) - 1;
        if (stageIdx >= 0) {
          setProcessingSteps(PROGRESS_STEP_LABELS.map((label, i) => ({
            label,
            status: i < stageIdx ? 'done' : i === stageIdx ? 'active' : 'pending',
          })));
        }
        updateProcessingDetail(data.stage
          ? `${data.stage}${data.progress != null ? ` — ${data.progress}%` : ''}`
          : null);

        if (data.status === 'generating' && data.translatedTextJson && !generatingPdf) {
          clearInterval(pollRef.current);
          generateAndUploadPdf(data);
        }
        if (data.status === 'failed' || data.status === 'done' || data.status === 'cancelled') {
          clearInterval(pollRef.current);
          stopProcessing();
          setActiveJobId(null);
          if (data.status === 'failed') addToast(data.errorMessage || 'Translation failed', 'error');
          if (data.status === 'cancelled') addToast('Translation cancelled');
          loadJobs();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [activeJobId, generatingPdf]);

  const cancelJob = async (jobId) => {
    try {
      const res = await api.post(`/api/translate/jobs/${jobId}/cancel`, {});
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Could not cancel — it may have already finished');
      }
      if (jobId === activeJobId) {
        clearInterval(pollRef.current);
        stopProcessing();
        setActiveJobId(null);
      }
      addToast('Cancelling…');
      loadJobs();
    } catch (e) { addToast(e.message, 'error'); }
  };

  const runEstimate = async () => {
    if (!file) return;
    setEstimating(true);
    setEstimate(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('targetLanguage', targetLang);
      const res = await api.postForm('/api/translate/estimate', fd);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Estimate failed');
      setEstimate(data);
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setEstimating(false);
    }
  };

  const generateAndUploadPdf = async (jobData) => {
    setGeneratingPdf(true);
    setProcessingSteps(PROGRESS_STEP_LABELS.map((label, i) => ({
      label, status: i < PROGRESS_STEP_LABELS.length - 1 ? 'done' : 'active',
    })));
    updateProcessingDetail('Generating bilingual PDF in browser…');
    try {
      // JSONB columns come back from pg already parsed; handle both string and object
      const payload = typeof jobData.translatedTextJson === 'string'
        ? JSON.parse(jobData.translatedTextJson)
        : jobData.translatedTextJson;

      if (!payload || typeof payload !== 'object') throw new Error('Translation data missing or invalid');

      await registerFonts(jobData.targetLanguage, jobData.sourceLanguage);
      const jobIntake = typeof jobData.intakeAnswers === 'string'
        ? JSON.parse(jobData.intakeAnswers)
        : jobData.intakeAnswers;
      const doc = buildBilingualPdf({
        ...payload,
        sourceLanguage: jobData.sourceLanguage,
        targetLanguage: jobData.targetLanguage,
        engine: jobIntake?.engine === 'google' ? 'google' : 'llm',
      });
      const blob = await pdf(doc).toBlob();
      const fd = new FormData();
      fd.append('translatedPdf', blob, 'translated.pdf');
      const res = await api.postForm(`/api/translate/jobs/${jobData.id}/complete`, fd);
      if (!res.ok) throw new Error('Failed to save PDF');
      loadJobs();
      addToast('Translation complete — ready to download', 'success');
    } catch (e) {
      addToast('PDF generation failed: ' + e.message, 'error');
      // Mark failed on server via the dedicated status endpoint
      api.postForm(`/api/translate/jobs/${jobData.id}/fail`, (() => {
        const fd = new FormData(); fd.append('error', e.message); return fd;
      })()).catch(() => {});
    } finally {
      setGeneratingPdf(false);
      setActiveJobId(null);
      setActiveJob(null);
      stopProcessing();
    }
  };

  const deleteJob = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/api/translate/jobs/${id}`);
      setJobs(prev => prev.filter(j => j.id !== id));
    } catch (e) { addToast(e.message, 'error'); }
    finally { setDeletingId(null); }
  };

  const downloadJob = async (job) => {
    try {
      const res = await api.get(`/api/translate/jobs/${job.id}/download`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translated-${(job.filename || 'document').replace(/\.[^.]+$/, '')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { addToast(e.message, 'error'); }
  };

  const downloadOriginalJob = async (job) => {
    try {
      const res = await api.get(`/api/translate/jobs/${job.id}/download-original`);
      if (!res.ok) throw new Error('Original file not available');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = job.filename || 'document';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { addToast(e.message, 'error'); }
  };

  const downloadNativeJob = async (job) => {
    try {
      const res = await api.get(`/api/translate/jobs/${job.id}/download-native`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const ext = /\.xlsx?$/i.test(job.filename || '') ? 'xlsx' : 'docx';
      const a = document.createElement('a');
      a.href = url;
      a.download = `translated-${(job.filename || 'document').replace(/\.[^.]+$/, '')}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { addToast(e.message, 'error'); }
  };

  const downloadTextJob = async (job) => {
    try {
      const res = await api.get(`/api/translate/jobs/${job.id}/download-text`);
      if (!res.ok) throw new Error('Text not available for this job');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `translated-${(job.filename || 'document').replace(/\.[^.]+$/, '')}.txt`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { addToast(e.message, 'error'); }
  };


  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">

      {/* Upload zone */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>New Translation</h2>
          {!file && (
            <button
              onClick={() => setPasteMode(m => !m)}
              className="text-xs font-medium hover:opacity-70"
              style={{ color: 'var(--color-primary)' }}
            >
              {pasteMode ? 'Upload a file instead' : 'Paste text instead'}
            </button>
          )}
        </div>

        {!file && pasteMode ? (
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
            <textarea
              value={pasteText}
              onChange={e => setPasteText(e.target.value)}
              placeholder="Paste the text you want translated…"
              className="w-full text-sm px-3 py-2 rounded-lg border outline-none"
              style={{ minHeight: 220, resize: 'vertical', background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
            />
            <div className="flex justify-end mt-3">
              <Btn onClick={usePastedText} disabled={!pasteText.trim()}>Use this text</Btn>
            </div>
          </div>
        ) : (
          <div
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
            onClick={() => !file && fileRef.current?.click()}
            className="rounded-xl border-2 border-dashed p-8 text-center transition-colors cursor-pointer"
            style={{
              borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)',
              background:  dragOver ? 'rgba(var(--color-primary-rgb, 99,102,241),0.04)' : 'var(--color-surface)',
            }}
          >
            <input ref={fileRef} type="file" accept={ACCEPT_UPLOAD} className="hidden"
              onChange={e => handleFileSelect(e.target.files[0])} />
            {!file ? (
              <>
                <div className="text-3xl mb-2">🌐</div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                  Drop a PDF, Word, Excel, or text file here — or click to browse
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Max 5 MB · PDF · .docx · .xlsx · .txt · scanned PDFs supported via OCR
                </p>
              </>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <div className="text-2xl">📄</div>
                <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{file.name}</p>
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                  {detectUploadKind(file) ? ` · ${detectUploadKind(file).toUpperCase()}` : ''}
                </p>
                <button onClick={e => { e.stopPropagation(); setFile(null); setPreflight(null); setPasteText(''); }}
                  className="text-xs" style={{ color: 'var(--color-muted)' }}>Remove</button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Preflight info + options */}
      {file && (
        <div className="flex flex-col gap-3">
          {preflighting ? (
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {file && detectUploadKind(file) === 'pdf' ? 'Analysing PDF…' : 'Preparing file…'}
            </p>
          ) : preflight && (
            <>
              <div className="flex gap-4 text-sm flex-wrap">
                {preflight.summary ? (
                  <span style={{ color: 'var(--color-muted)' }}>{preflight.summary}</span>
                ) : (
                  <span style={{ color: 'var(--color-muted)' }}>
                    <strong style={{ color: 'var(--color-text)' }}>{preflight.pageCount}</strong>{' '}
                    {preflight.unitLabel || 'pages'}
                  </span>
                )}
                {preflight.scannedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs"
                    style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>
                    {preflight.scannedCount} scanned page{preflight.scannedCount !== 1 ? 's' : ''} — OCR will be applied
                  </span>
                )}
                {preflight.kind === 'pdf' && preflight.pageCount > 50 && preflight.scannedCount > 0 && (
                  <span className="text-xs" style={{ color: '#d97706' }}>
                    ⚠ Large scanned document — may take several minutes
                  </span>
                )}
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-40">
                  <Field label="Translate to"
                    hint={targetLang === 'mi'
                      ? 'Defaults to standard te reo Māori (Te Taura Whiri), not a specific iwi dialect.'
                      : languageOptions.find(l => l.code === targetLang)?.lowResource
                        ? '⚠ Lower-quality output expected — sparse training examples for this language.'
                        : 'Defaults from Settings → AI & Chat → Translate agent; change here for this job only.'}>
                    <Sel value={targetLang} onChange={(v) => { setTargetLang(v); if (v !== 'mi') setRegionalAudience(''); }}>
                      {languageOptions.map(l => <option key={l.code} value={l.code}>{languageOptionLabel(l)}</option>)}
                    </Sel>
                  </Field>
                </div>
                <div className="flex-1 min-w-40">
                  <Field label="Saved glossary (optional)"
                    hint={useGlobalGlossary
                      ? 'Disabled — using the global glossary for this language instead.'
                      : engine === 'llm'
                        ? 'Merged with terms the model proposes from your answers.'
                        : 'Applied as do-not-translate / substitutions for Google Translate.'}>
                    <Sel value={glossaryId} onChange={setGlossaryId} disabled={useGlobalGlossary}>
                      <option value="">None</option>
                      {glossaries.map(g => (
                        <option key={g.id} value={g.id}>{g.name} ({g.termCount} terms)</option>
                      ))}
                    </Sel>
                  </Field>
                  <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer" style={{ color: 'var(--color-text)' }}>
                    <input type="checkbox" checked={useGlobalGlossary}
                      onChange={(e) => setUseGlobalGlossary(e.target.checked)} />
                    Build/use the learned glossary for {LANGUAGES.find(l => l.code === targetLang)?.label || targetLang}
                    {globalGlossary
                      ? ` — ${globalGlossary.termCount} term${globalGlossary.termCount === 1 ? '' : 's'} learned so far (view/edit in the Glossaries tab)`
                      : ' — nothing learned yet; this job starts it'}
                  </label>
                </div>
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-40">
                  <Field label="Translation engine"
                    hint={engine === 'google'
                      ? 'Faster machine translation. Best for drafts and common languages.'
                      : 'Vault LLM — slower, better for domain tone, glossaries, and te reo Māori policy.'}>
                    <Sel value={engine} onChange={(v) => {
                      setEngine(v);
                      if (v === 'google') setEnableReview(false);
                      else setEnableReview(true);
                    }}>
                      <option value="llm" disabled={!engineAvailability.llm}>
                        Vault LLM{!engineAvailability.llm ? ' (not configured)' : ''}
                      </option>
                      <option value="google" disabled={!engineAvailability.google}>
                        Google Translate{!engineAvailability.google ? ' (not configured)' : ''}
                      </option>
                    </Sel>
                  </Field>
                </div>
                <div className="flex-1 min-w-40">
                  <Field label="PDF layout"
                    hint="How the download PDF presents source and translation.">
                    <div className="flex flex-col gap-1.5 pt-1">
                      {[
                        { v: 'translation-only', label: 'Separate translated document' },
                        { v: 'bilingual-pages', label: 'Bilingual pages (original then translation)' },
                      ].map(({ v, label }) => (
                        <label key={v} className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                          <input type="radio" name="pdfLayout" value={v} checked={pdfLayout === v} onChange={() => setPdfLayout(v)} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </Field>
                </div>
              </div>

              {targetLang === 'mi' && (
                <Field label="Iwi / rohe audience (optional)"
                  hint="Leave blank for standard te reo Māori. Specify only if vocabulary should be adapted for a particular audience (e.g. Ngāi Tahu). Dialectal choices will be flagged in QA.">
                  <Input value={regionalAudience} onChange={setRegionalAudience}
                    placeholder="e.g. Ngāi Tahu audience, Tāmaki Makaurau" />
                </Field>
              )}

              {engine === 'llm' ? (
              <div className="rounded-xl border p-4 flex flex-col gap-3"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                  Before translating — help the model
                </p>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
                  <Field label="Document domain">
                    <Sel value={domain} onChange={setDomain}>
                      {DOMAIN_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Sel>
                  </Field>
                  <Field label="Intended reader">
                    <Sel value={audience} onChange={setAudience}>
                      {AUDIENCE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Sel>
                  </Field>
                  <Field label="Tone">
                    <Sel value={tone} onChange={setTone}>
                      <option value="natural">Natural / fluent</option>
                      <option value="literal">Literal / close to source</option>
                    </Sel>
                  </Field>
                </div>
                <Field label="Must-keep terms (comma-separated)"
                  hint="Brand names, product codes, acronyms that must not be translated.">
                  <Input value={mustKeepTerms} onChange={setMustKeepTerms}
                    placeholder="e.g. Curam, Masterspec, ABN" />
                </Field>
                <Field label="Notes for the translator (optional)">
                  <textarea
                    value={intakeNotes}
                    onChange={e => setIntakeNotes(e.target.value)}
                    rows={2}
                    placeholder="e.g. Prefer TPS not TVA for NZ GST; keep English section headings"
                    className="text-sm px-3 py-2 rounded-lg border w-full resize-none"
                    style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}
                  />
                </Field>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                  <input type="checkbox" checked={enableReview} onChange={e => setEnableReview(e.target.checked)} />
                  Run second-model QA review after translation (recommended)
                </label>
              </div>
              ) : (
              <div className="rounded-xl border p-4 flex flex-col gap-3"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
                  Google Translate options
                </p>
                <Field label="Must-keep terms (comma-separated)"
                  hint="Protected from translation via Google’s do-not-translate markup.">
                  <Input value={mustKeepTerms} onChange={setMustKeepTerms}
                    placeholder="e.g. Curam, Masterspec, ABN" />
                </Field>
                <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--color-muted)' }}>
                  <input type="checkbox" checked={enableReview} onChange={e => setEnableReview(e.target.checked)} />
                  Run LLM QA review after Google Translate (slower; needs a Vault review model)
                </label>
              </div>
              )}

              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={runEstimate}
                  disabled={estimating || preflighting || !file}
                  className="text-xs px-3 py-2 rounded-lg border hover:opacity-70 transition-opacity disabled:opacity-50"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                  {estimating ? 'Estimating…' : 'Get estimate'}
                </button>
                <Btn onClick={handleSubmit}
                  disabled={submitting || preflighting || (engine === 'llm' && !domain)}>
                  {submitting ? 'Submitting…' : `Start Translation (${engine === 'google' ? 'Google' : 'LLM'})`}
                </Btn>
                {estimate && (
                  <span className="text-xs w-full" style={{ color: 'var(--color-muted)' }}>
                    {estimate.charCount.toLocaleString()} chars
                    {estimate.languageCount > 1 ? ` × ${estimate.languageCount} languages` : ''}
                    {estimate.estCostAud != null ? ` · ~A$${estimate.estCostAud.toFixed(4)} (${estimate.modelId})` : ''}
                  </span>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Job history */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Translation History</h2>
        {loadingJobs ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
        ) : jobs.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>No translations yet.</p>
        ) : (
          <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                  {['File', 'Languages', 'Pages', 'Chars', 'Date', 'Status', ''].map(h => (
                    <th key={h} className="text-left px-3 py-2 text-xs font-medium"
                      style={{ color: 'var(--color-muted)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map(job => {
                  const srcLabel = job.sourceLanguage
                    ? (LANGUAGES.find(l => l.code === job.sourceLanguage)?.label || job.sourceLanguage)
                    : '?';
                  const tgtLabel = LANGUAGES.find(l => l.code === job.targetLanguage)?.label || job.targetLanguage;
                  return (
                    <tr key={job.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                      <td className="px-3 py-2" style={{ color: 'var(--color-text)', maxWidth: 180 }}>
                        <span className="truncate block" title={job.filename}>{job.filename}</span>
                        {job.avgOcrConfidence != null && job.avgOcrConfidence < 0.7 && (
                          <span className="text-xs" style={{ color: '#d97706' }} title="Low OCR confidence">⚠</span>
                        )}
                        {job.batchId && (
                          <span className="text-xs" style={{ color: 'var(--color-muted)' }} title="Part of a multi-language batch">
                            Batch
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {srcLabel} → {tgtLabel}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {job.pageCount || '—'}
                        {job.scannedPageCount > 0 && (
                          <span className="ml-1 text-xs" style={{ color: '#7c3aed' }} title="Includes scanned pages">
                            ({job.scannedPageCount} OCR)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {job.charCount > 0 ? job.charCount.toLocaleString() : '—'}
                      </td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                        {new Date(job.createdAt).toLocaleDateString('en-AU')}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={job.status} />
                        {job.status === 'failed' && job.errorMessage && (
                          <span className="ml-1 text-xs cursor-help" title={job.errorMessage} style={{ color: '#dc2626' }}>ⓘ</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-2">
                          {!['done', 'failed', 'cancelled'].includes(job.status) && (
                            <button onClick={() => cancelJob(job.id)}
                              className="text-xs px-2 py-1 rounded border"
                              style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626' }}>
                              Cancel
                            </button>
                          )}
                          {job.hasNativeOutput && (
                            <button onClick={() => downloadNativeJob(job)}
                              className="text-xs px-2 py-1 rounded border"
                              title="Editable Word/Excel file with the source file's own formatting"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              Download {/\.xlsx?$/i.test(job.filename || '') ? 'Excel' : 'Word'}
                            </button>
                          )}
                          {(job.status === 'done' || job.qaSummaryJson) && (
                            <button onClick={() => setQaJob(job)}
                              className="text-xs px-2 py-1 rounded border"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                              View Results
                            </button>
                          )}
                          <button onClick={() => deleteJob(job.id)} disabled={deletingId === job.id}
                            className="text-xs px-2 py-1 rounded border"
                            style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626' }}>
                            {deletingId === job.id ? '…' : 'Delete'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {qaJob && (
        <QaPanel qa={parseQa(qaJob)} job={qaJob} onClose={() => setQaJob(null)}
          onDownload={downloadJob} onDownloadNative={downloadNativeJob} onDownloadOriginal={downloadOriginalJob}
          onDownloadText={downloadTextJob} />
      )}
    </div>
  );
}

// ── Glossaries tab ────────────────────────────────────────────────────────────
function GlossariesTab({ glossaries, setGlossaries }) {
  const [modal, setModal]     = useState(null); // null | 'new' | glossaryObj
  const [form, setForm]       = useState({ name: '', terms: [] });
  const [saving, setSaving]   = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [logOpen, setLogOpen] = useState(false);
  const addToast = useToastStore(s => s.addToast);
  const csvRef = useRef(null);

  const openNew = () => {
    setForm({ name: '', terms: [] });
    setModal('new');
  };

  const openEdit = (g) => {
    setForm({ name: g.name, terms: g.terms || [] });
    setModal(g);
  };

  const addTerm = () => setForm(f => ({ ...f, terms: [...f.terms, { source: '', target: '', doNotTranslate: false }] }));
  const setTerm = (i, key, val) => setForm(f => {
    const terms = [...f.terms];
    terms[i] = { ...terms[i], [key]: val };
    return { ...f, terms };
  });
  const removeTerm = (i) => setForm(f => ({ ...f, terms: f.terms.filter((_, idx) => idx !== i) }));

  const importCsv = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const lines = ev.target.result.split('\n').filter(l => l.trim());
      const terms = lines.map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        return { source: cols[0] || '', target: cols[1] || '', doNotTranslate: (cols[2] || '').toUpperCase() === 'DNT' };
      }).filter(t => t.source);
      setForm(f => ({ ...f, terms: [...f.terms, ...terms] }));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const save = async () => {
    if (!form.name.trim()) { addToast('Name required', 'error'); return; }
    setSaving(true);
    try {
      if (modal === 'new') {
        const res  = await api.post('/api/translate/glossaries', form);
        const body = await res.json();
        setGlossaries(prev => [body, ...prev]);
      } else {
        const res  = await api.put(`/api/translate/glossaries/${modal.id}`, form);
        const body = await res.json();
        setGlossaries(prev => prev.map(g => g.id === body.id ? body : g));
      }
      setModal(null);
    } catch (e) { addToast(e.message, 'error'); }
    finally { setSaving(false); }
  };

  const deleteGlossary = async (id) => {
    setDeleting(id);
    try {
      await api.delete(`/api/translate/glossaries/${id}`);
      setGlossaries(prev => prev.filter(g => g.id !== id));
    } catch (e) { addToast(e.message, 'error'); }
    finally { setDeleting(null); }
  };

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Glossaries</h2>
        <div className="flex items-center gap-3">
          <button onClick={() => setLogOpen(true)} className="text-sm font-medium hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
            View lessons log
          </button>
          <Btn onClick={openNew}>New Glossary</Btn>
        </div>
      </div>

      {logOpen && <LessonsLogModal onClose={() => setLogOpen(false)} />}

      {glossaries.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          No glossaries yet. Create one to control how specific terms are translated or preserved.
        </p>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                {['Name', 'Language', 'Terms', 'Updated', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {glossaries.map(g => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>
                    {g.name}
                    {g.isGlobal && (
                      <span className="ml-2 text-xs px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(37,99,235,0.1)', color: '#2563eb' }}
                        title="Auto-learned from translation jobs that opted in — see Translations tab">
                        Global · learned
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {g.targetLanguage
                      ? (LANGUAGES.find(l => l.code === g.targetLanguage)?.label || g.targetLanguage)
                      : '— (any)'}
                  </td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>{g.termCount ?? (g.terms?.length ?? 0)} terms</td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--color-muted)' }}>
                    {new Date(g.updatedAt).toLocaleDateString('en-AU')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex gap-2">
                      <button onClick={() => openEdit(g)} className="text-xs px-2 py-1 rounded border"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>Edit</button>
                      <button onClick={() => deleteGlossary(g.id)} disabled={deleting === g.id}
                        className="text-xs px-2 py-1 rounded border"
                        style={{ borderColor: 'rgba(220,38,38,0.3)', color: '#dc2626' }}>
                        {deleting === g.id ? '…' : 'Delete'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal && (
        <Modal title={modal === 'new' ? 'New Glossary' : `Edit: ${modal.name}`} onClose={() => setModal(null)} wide>
          <div className="flex flex-col gap-4">
            <Field label="Glossary name">
              <Input value={form.name} onChange={v => setForm(f => ({ ...f, name: v }))} placeholder="e.g. Legal Terms" />
            </Field>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-medium" style={{ color: 'var(--color-muted)' }}>Terms</label>
                <div className="flex gap-2">
                  <input ref={csvRef} type="file" accept=".csv" className="hidden" onChange={importCsv} />
                  <button onClick={() => csvRef.current?.click()} className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                    Import CSV
                  </button>
                  <button onClick={addTerm} className="text-xs px-2 py-1 rounded border"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                    + Add term
                  </button>
                </div>
              </div>

              <div className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>
                CSV format: source term, translated as, DNT (optional — mark "DNT" to preserve without translation)
              </div>

              {form.terms.length === 0 ? (
                <p className="text-xs text-center py-4" style={{ color: 'var(--color-muted)' }}>No terms yet — add one above</p>
              ) : (
                <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
                  <div className="grid text-xs font-medium px-1 pb-1"
                    style={{ gridTemplateColumns: '1fr 1fr auto auto', color: 'var(--color-muted)' }}>
                    <span>Source</span><span>Translated as</span><span className="text-center">DNT</span><span></span>
                  </div>
                  {form.terms.map((t, i) => (
                    <div key={i} className="grid gap-1 items-center"
                      style={{ gridTemplateColumns: '1fr 1fr auto auto' }}>
                      <input value={t.source} onChange={e => setTerm(i, 'source', e.target.value)}
                        placeholder="Original term"
                        className="text-xs px-2 py-1 rounded border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }} />
                      <input value={t.target} onChange={e => setTerm(i, 'target', e.target.value)}
                        placeholder="Translation (blank = keep original)"
                        disabled={t.doNotTranslate}
                        className="text-xs px-2 py-1 rounded border"
                        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none', opacity: t.doNotTranslate ? 0.4 : 1 }} />
                      <input type="checkbox" checked={!!t.doNotTranslate}
                        onChange={e => setTerm(i, 'doNotTranslate', e.target.checked)}
                        className="mx-auto" title="Do not translate" />
                      <button onClick={() => removeTerm(i)} className="text-xs w-6 h-6 flex items-center justify-center rounded"
                        style={{ color: '#dc2626' }}>✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-2 justify-end pt-2">
              <Btn variant="secondary" onClick={() => setModal(null)}>Cancel</Btn>
              <Btn onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Glossary'}</Btn>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
const TABS = ['Translations', 'Glossaries'];

// What-is-this modal for the page header — explains the agent and its moving parts (engine,
// glossary vs. global glossary, QA review, PDF layouts) in one place instead of scattering
// tooltips across the intake form.
function TranslateAboutModal({ onClose, getIcon }) {
  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="translate-about-title"
    >
      <div
        className="relative flex flex-col rounded-2xl border shadow-2xl mx-4 overflow-hidden"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', width: '100%', maxWidth: 560, maxHeight: '85dvh' }}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b shrink-0" style={{ borderColor: 'var(--color-border)' }}>
          <div className="flex items-start gap-3 min-w-0">
            <span className="mt-0.5 shrink-0" style={{ fontSize: 20 }}>🌐</span>
            <div className="min-w-0">
              <p id="translate-about-title" className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Translate</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--color-muted)' }}>
                Upload a document, translate it into another language, review the result, download a bilingual PDF (and, when possible, an editable native file).
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose}
            className="shrink-0 transition-opacity duration-200 hover:opacity-60"
            style={{ color: 'var(--color-muted)', background: 'none', border: 'none', cursor: 'pointer', lineHeight: 1, padding: 0 }}
            aria-label="Close">
            {getIcon('x', { size: 18 })}
          </button>
        </div>

        <div className="overflow-y-auto px-5 py-4 space-y-4 text-sm" style={{ color: 'var(--color-text)' }}>
          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>How a job runs</p>
            <ul className="space-y-1.5 list-disc list-inside text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
              <li>Upload a PDF, Word (.docx), Excel (.xlsx/.xls), or plain text (.txt) file — up to 5 MB. Or paste text directly instead of uploading a file.</li>
              <li>Pick a target language (defaults from Settings → AI & Chat → Translate agent, overridable per job) and answer a few intake questions (domain, audience, tone) — these shape the translation, not just the glossary.</li>
              <li>Choose an engine: <strong>Vault LLM</strong> (slower, better for tone/glossaries/te reo Māori policy) or <strong>Google Translate</strong> (fast drafts, common languages).</li>
              <li>Optionally enable a second-model QA review pass before the job finishes.</li>
              <li>Download the bilingual PDF (separate translated document, or bilingual-pages layout) once done — plus a native Word/Excel file when the source format supports it.</li>
            </ul>
          </div>

          <div className="space-y-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>What the glossary buttons do</p>
            <ul className="space-y-1.5 list-disc list-inside text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
              <li><strong>Saved glossary (optional)</strong> — pick a glossary you've created in the <strong>Glossaries</strong> tab to lock specific terms to an exact rendering (or mark them do-not-translate) for this job.</li>
              <li><strong>Use global glossary for [language]</strong> — on by default. Each target language has its own auto-learned glossary: every job that uses it contributes new terms back, and future jobs for that language reuse them. Untick it to use a manually-picked saved glossary instead for that one job.</li>
              <li>Open the <strong>Glossaries</strong> tab any time to view, edit, or delete terms in either kind of glossary — a "Global · learned" badge marks the auto-learned ones. Edits there are picked up by the next job.</li>
            </ul>
          </div>

          <div className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
            <p className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--color-muted)' }}>Also worth knowing</p>
            <ul className="space-y-1.5 list-disc list-inside text-sm leading-relaxed" style={{ color: 'var(--color-text)' }}>
              <li>Every job's <strong>View Results</strong> button shows the QA summary, with its own download for a plain-text QA report and the original/translated files — separate from the QA report itself.</li>
              <li>Translations aren't legally certified — the PDF footer says so on every page.</li>
              <li>A source PDF with multi-column layouts or data tables can garble on extraction — this is a known limitation, not something the glossary or QA settings control.</li>
            </ul>
          </div>
        </div>

        <div className="px-5 py-3 border-t shrink-0 flex justify-end" style={{ borderColor: 'var(--color-border)' }}>
          <button type="button" onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-sm font-medium transition-opacity duration-200 hover:opacity-70"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TranslatePage() {
  const getIcon = useIcon();
  const [aboutOpen, setAboutOpen]    = useState(false);
  const [tab, setTab]               = useState('Translations');
  const [configured, setConfigured] = useState(true);
  const [configMsg, setConfigMsg]   = useState('');
  const [glossaries, setGlossaries] = useState([]);

  useEffect(() => {
    api.get('/api/translate/config').then(r => r.json()).then(d => {
      setConfigured(d.configured !== false);
      if (!d.configured) {
        setConfigMsg(d.errors?.[0]
          || 'Configure a Vault LLM translate model and/or GOOGLE_TRANSLATE_API_KEY.');
      } else {
        const parts = [];
        if (d.engines?.llm?.available) parts.push(`LLM: ${d.engines.llm.translateModel || 'ready'}`);
        if (d.engines?.google?.available) parts.push('Google Translate: ready');
        setConfigMsg(parts.join(' · ') || (d.translateModel ? `Using ${d.translateModel}` : ''));
      }
    }).catch(() => {});
    api.get('/api/translate/glossaries').then(r => r.json()).then(setGlossaries).catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-full">
      {aboutOpen && <TranslateAboutModal onClose={() => setAboutOpen(false)} getIcon={getIcon} />}
      {/* Header */}
      <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: 20 }}>🌐</span>
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Translate</h1>
            <button type="button" onClick={() => setAboutOpen(true)}
              title="What does this agent do?"
              style={{ color: 'var(--color-muted)', lineHeight: 1, background: 'none', border: 'none', padding: 0, cursor: 'pointer', transition: 'color 0.2s' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--color-muted)'; }}>
              {getIcon('help-circle', { size: 16 })}
            </button>
          </div>
          <div className="flex gap-0">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="text-sm px-4 py-2 border-b-2 transition-colors flex-shrink-0"
                style={{
                  background: 'transparent',
                  color: tab === t ? 'var(--color-primary)' : 'var(--color-muted)',
                  borderBottomColor: tab === t ? 'var(--color-primary)' : 'transparent',
                  fontWeight: tab === t ? 600 : 400,
                }}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {!configured && (
        <div className="px-6 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)', color: '#dc2626' }}>
          ⚠ {configMsg || 'Translate model not configured.'}
        </div>
      )}

      <div className="px-6 py-2 text-xs" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        Vault LLM translation with intake questions, glossary prep, optional second-model QA review, and bilingual PDF.
        AI output is for reference only — not legally certified. Use Settings → <strong>Translate agent</strong> to pick translate/review models.
      </div>

      <div className="flex-1 overflow-y-auto">
        {tab === 'Translations' && <TranslationsTab glossaries={glossaries} />}
        {tab === 'Glossaries'   && <GlossariesTab glossaries={glossaries} setGlossaries={setGlossaries} />}
      </div>
    </div>
  );
}
