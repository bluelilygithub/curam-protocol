import React, { useState, useEffect, useRef, useCallback } from 'react';
import { pdf, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';
import useProcessingStore from '../store/processingStore';
import { LANGUAGES } from '../utils/translateLanguages';

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

const FONT_BY_LANG = {
  'zh-CN': '/fonts/NotoSansSC.ttf',
  'ja':    '/fonts/NotoSansJP.ttf',
  'ar':    '/fonts/NotoSansArabic.ttf',
  'ko':    '/fonts/NotoSansJP.ttf', // fallback
};

const ACCEPT_UPLOAD =
  '.pdf,.docx,.xlsx,.xls,application/pdf,'
  + 'application/vnd.openxmlformats-officedocument.wordprocessingml.document,'
  + 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,'
  + 'application/vnd.ms-excel';

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
function buildQaReportText(job, qa) {
  const lines = [];
  const push = (s = '') => lines.push(s);
  push(`Translation QA Report`);
  push(`File: ${job?.filename || '—'}`);
  push(`Target language: ${job?.targetLanguage || '—'}`);
  push(`Translate model: ${qa.translateModel || '—'} · Review model: ${qa.reviewModel || '—'}`);
  push(`Generated: ${new Date().toISOString()}`);
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

function downloadQaReport(job, qa) {
  const text = buildQaReportText(job, qa);
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `qa-report-${(job.filename || 'document').replace(/\.[^.]+$/, '')}.txt`;
  a.click();
  URL.revokeObjectURL(url);
}

function QaPanel({ qa, onClose, job, onDownload, onDownloadNative, onDownloadOriginal }) {
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
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => downloadQaReport(job, qa)}
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
          {job?.status === 'done' && (
            <>
              <button onClick={() => onDownload?.(job)}
                className="text-sm px-4 py-2 rounded-lg border font-medium hover:opacity-70"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                Download translated PDF
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
    </Modal>
  );
}

// ── PDF generation (client-side) ──────────────────────────────────────────────
async function registerFonts(targetLanguage) {
  const fontUrl = FONT_BY_LANG[targetLanguage];
  if (!fontUrl) return;
  try {
    Font.register({ family: 'NotoTarget', src: fontUrl });
  } catch {}
}

function buildBilingualPdf({ sourceByPage, translatedByPage, pageCount, scannedPages = [],
    avgOcrConfidence, sourceLanguage, targetLanguage, pageLabels = {}, sourceFormat = 'pdf',
    pdfLayout = 'side-by-side' }) {
  const isLowConf = (pg) => scannedPages.includes(pg) && avgOcrConfidence != null && avgOcrConfidence < 0.7;
  const useNoto = !!FONT_BY_LANG[targetLanguage];
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
          <Text style={styles.footer}>AI-generated translation · for reference only · not legally certified</Text>
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
          <Text style={styles.footer}>AI-generated translation · for reference only · not legally certified</Text>
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
  // Target language is a Settings-level choice (Settings → AI & Chat → Translate agent), not
  // picked per job — loaded once below and used read-only here.
  const [targetLang, setTargetLang] = useState('fr');
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [glossaryId, setGlossaryId] = useState('');
  const [useGlobalGlossary, setUseGlobalGlossary] = useState(false);
  const [globalGlossary, setGlobalGlossary] = useState(null); // { termCount } for the current targetLang, or null if none yet
  const [domain, setDomain] = useState('general');
  const [audience, setAudience] = useState('client');
  const [tone, setTone] = useState('natural');
  const [mustKeepTerms, setMustKeepTerms] = useState('');
  const [intakeNotes, setIntakeNotes] = useState('');
  const [regionalAudience, setRegionalAudience] = useState('');
  const [enableReview, setEnableReview] = useState(true);
  const [engine, setEngine] = useState('llm'); // llm | google
  const [pdfLayout, setPdfLayout] = useState('side-by-side'); // side-by-side | translation-only | bilingual-pages
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
      addToast('Please select a PDF, Word (.docx), or Excel (.xlsx) file', 'error');
      return;
    }
    if (f.size > 15 * 1024 * 1024) { addToast('File exceeds 15 MB limit', 'error'); return; }
    setFile(f);
    runPreflight(f);
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
      });
      setActiveJobId(body.jobId);
      setFile(null); setPreflight(null); setEstimate(null);
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
        if (data.status === 'failed' || data.status === 'done') {
          clearInterval(pollRef.current);
          stopProcessing();
          setActiveJobId(null);
          if (data.status === 'failed') addToast(data.errorMessage || 'Translation failed', 'error');
          loadJobs();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [activeJobId, generatingPdf]);

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

      await registerFonts(jobData.targetLanguage);
      const doc = buildBilingualPdf({
        ...payload,
        sourceLanguage: jobData.sourceLanguage,
        targetLanguage: jobData.targetLanguage,
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


  return (
    <div className="p-6 flex flex-col gap-6 max-w-4xl">

      {/* Upload zone */}
      <div>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>New Translation</h2>
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
                Drop a PDF, Word, or Excel file here — or click to browse
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Max 15 MB · PDF · .docx · .xlsx · scanned PDFs supported via OCR
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
              <button onClick={e => { e.stopPropagation(); setFile(null); setPreflight(null); }}
                className="text-xs" style={{ color: 'var(--color-muted)' }}>Remove</button>
            </div>
          )}
        </div>
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
                      : 'Set in Settings → AI & Chat → Translate agent.'}>
                    <p className="text-sm px-3 py-2 rounded-lg border"
                      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                      {LANGUAGES.find(l => l.code === targetLang)?.label || targetLang}
                    </p>
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
                    Use global glossary for {LANGUAGES.find(l => l.code === targetLang)?.label || targetLang}
                    {globalGlossary
                      ? ` (${globalGlossary.termCount} terms learned so far)`
                      : ' (none yet — this job will start building one)'}
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
                    <Sel value={pdfLayout} onChange={setPdfLayout}>
                      <option value="side-by-side">Side by side (same page)</option>
                      <option value="translation-only">Separate translated document</option>
                      <option value="bilingual-pages">Bilingual pages (original then translation)</option>
                    </Sel>
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

              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    type="button"
                    onClick={runEstimate}
                    disabled={estimating || preflighting || !file}
                    className="text-xs px-3 py-2 rounded-lg border hover:opacity-70 transition-opacity disabled:opacity-50"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>
                    {estimating ? 'Estimating…' : 'Get estimate'}
                  </button>
                  {estimate && (
                    <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                      {estimate.charCount.toLocaleString()} chars
                      {estimate.languageCount > 1 ? ` × ${estimate.languageCount} languages` : ''}
                      {estimate.estCostAud != null ? ` · ~A$${estimate.estCostAud.toFixed(4)} (${estimate.modelId})` : ''}
                    </span>
                  )}
                </div>
                <Btn onClick={handleSubmit}
                  disabled={submitting || preflighting || (engine === 'llm' && !domain)}>
                  {submitting ? 'Submitting…' : `Start Translation (${engine === 'google' ? 'Google' : 'LLM'})`}
                </Btn>
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
                          <button onClick={() => downloadOriginalJob(job)}
                            className="text-xs px-2 py-1 rounded border"
                            title="Download the untouched source file, as uploaded"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                            Original
                          </button>
                          {job.status === 'done' && (
                            <button onClick={() => downloadJob(job)}
                              className="text-xs px-2 py-1 rounded border"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              Download PDF
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
                              QA
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
          onDownload={downloadJob} onDownloadNative={downloadNativeJob} onDownloadOriginal={downloadOriginalJob} />
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
        <Btn onClick={openNew}>New Glossary</Btn>
      </div>

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

export default function TranslatePage() {
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
      {/* Header */}
      <div className="flex-shrink-0 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-6 pt-4 pb-0">
          <div className="flex items-center gap-2 mb-3">
            <span style={{ fontSize: 20 }}>🌐</span>
            <h1 className="text-lg font-bold" style={{ color: 'var(--color-text)' }}>Translate</h1>
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
