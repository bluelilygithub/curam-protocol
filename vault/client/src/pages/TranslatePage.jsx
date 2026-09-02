import React, { useState, useEffect, useRef, useCallback } from 'react';
import { pdf, Document, Page, Text, View, StyleSheet, Font } from '@react-pdf/renderer';
import api from '../utils/apiClient';
import useToastStore from '../store/toastStore';

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

// ── Language options ──────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'zh-CN', label: 'Chinese (Simplified)' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ar', label: 'Arabic' },
  { code: 'ko', label: 'Korean' },
  { code: 'ru', label: 'Russian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'pl', label: 'Polish' },
  { code: 'sv', label: 'Swedish' },
];

const FONT_BY_LANG = {
  'zh-CN': '/fonts/NotoSansSC.ttf',
  'ja':    '/fonts/NotoSansJP.ttf',
  'ar':    '/fonts/NotoSansArabic.ttf',
  'ko':    '/fonts/NotoSansJP.ttf', // fallback
};

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

function Sel({ value, onChange, children }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="text-sm px-3 py-2 rounded-lg border w-full"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)', outline: 'none' }}>
      {children}
    </select>
  );
}

function StatusBadge({ status }) {
  const map = {
    pending:    { label: 'Pending',     color: 'var(--color-muted)', bg: 'rgba(0,0,0,0.06)' },
    extracting: { label: 'Extracting',  color: '#2563eb', bg: 'rgba(37,99,235,0.1)' },
    ocr:        { label: 'OCR',         color: '#7c3aed', bg: 'rgba(124,58,237,0.1)' },
    translating:{ label: 'Translating', color: '#0891b2', bg: 'rgba(8,145,178,0.1)' },
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

// ── PDF generation (client-side) ──────────────────────────────────────────────
async function registerFonts(targetLanguage) {
  const fontUrl = FONT_BY_LANG[targetLanguage];
  if (!fontUrl) return;
  try {
    Font.register({ family: 'NotoTarget', src: fontUrl });
  } catch {}
}

function buildBilingualPdf({ sourceByPage, translatedByPage, pageCount, scannedPages = [],
    avgOcrConfidence, sourceLanguage, targetLanguage }) {
  const isLowConf = (pg) => scannedPages.includes(pg) && avgOcrConfidence != null && avgOcrConfidence < 0.7;
  const useNoto = !!FONT_BY_LANG[targetLanguage];

  const styles = StyleSheet.create({
    page:     { padding: 40, fontFamily: useNoto ? 'NotoTarget' : 'Helvetica' },
    header:   { fontSize: 9, color: '#6b7280', marginBottom: 12, paddingBottom: 6,
                borderBottom: '1px solid #e5e7eb', flexDirection: 'row', justifyContent: 'space-between' },
    langBadge:{ fontSize: 8, backgroundColor: '#f3f4f6', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
    warning:  { backgroundColor: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 4,
                padding: 6, marginBottom: 10, fontSize: 8, color: '#92400e' },
    para:     { fontSize: 10, color: '#1f2937', marginBottom: 6, lineHeight: 1.6 },
    footer:   { position: 'absolute', bottom: 20, left: 40, right: 40, fontSize: 7,
                color: '#9ca3af', textAlign: 'center', borderTop: '1px solid #e5e7eb', paddingTop: 4 },
    sourceHeader: { fontSize: 9, fontWeight: 'bold', color: '#374151' },
    transHeader:  { fontSize: 9, fontWeight: 'bold', color: '#1d4ed8' },
  });

  const langLabel = LANGUAGES.find(l => l.code === targetLanguage)?.label || targetLanguage;
  const srcLabel  = sourceLanguage && sourceLanguage !== 'auto'
    ? (LANGUAGES.find(l => l.code === sourceLanguage)?.label || sourceLanguage)
    : 'Original';

  const pages = [];
  for (let pg = 1; pg <= pageCount; pg++) {
    const srcParas  = sourceByPage[pg]  || [];
    const trnParas  = translatedByPage[pg] || [];
    const lowConf   = isLowConf(pg);

    // Source page
    pages.push(
      <Page key={`src-${pg}`} size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.sourceHeader}>ORIGINAL · Page {pg}</Text>
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

    // Translated page
    pages.push(
      <Page key={`trn-${pg}`} size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.transHeader}>TRANSLATION · Page {pg}</Text>
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
  const [targetLang, setTargetLang] = useState('fr');
  const [glossaryId, setGlossaryId] = useState('');
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

  const loadJobs = useCallback(() => {
    api.get('/api/translate/jobs').then(r => r.json()).then(setJobs).catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Preflight: extract page info client-side using pdfjs
  const runPreflight = async (selectedFile) => {
    setPreflighting(true);
    setPreflight(null);
    try {
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
          // Render page to canvas → base64 PNG
          const viewport = page.getViewport({ scale: 1.5 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, viewport }).promise;
          scannedImages[pg] = canvas.toDataURL('image/png');
        }
      }

      setPreflight({ pageCount, scannedCount, scannedImages });
    } catch (e) {
      addToast('Could not read PDF: ' + (e.message || 'Unknown error'), 'error');
      setFile(null);
    } finally {
      setPreflighting(false);
    }
  };

  const handleFileSelect = (f) => {
    if (!f || f.type !== 'application/pdf') { addToast('Please select a PDF file', 'error'); return; }
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
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('pdf', file);
      fd.append('targetLanguage', targetLang);
      if (glossaryId) fd.append('glossaryId', glossaryId);
      fd.append('scannedPageImages', JSON.stringify(preflight.scannedImages));

      const res  = await api.postForm('/api/translate/jobs', fd);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Submission failed');

      setActiveJobId(body.jobId);
      setFile(null); setPreflight(null);
      loadJobs();
    } catch (e) {
      addToast(e.message, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Poll active job
  useEffect(() => {
    if (!activeJobId) return;
    clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res  = await api.get(`/api/translate/jobs/${activeJobId}/status`);
        const data = await res.json();
        setActiveJob(data);

        if (data.status === 'generating' && data.translatedTextJson && !generatingPdf) {
          clearInterval(pollRef.current);
          generateAndUploadPdf(data);
        }
        if (data.status === 'done' || data.status === 'failed') {
          clearInterval(pollRef.current);
          setActiveJobId(null);
          loadJobs();
        }
      } catch {}
    }, 2000);
    return () => clearInterval(pollRef.current);
  }, [activeJobId, generatingPdf]);

  const generateAndUploadPdf = async (jobData) => {
    setGeneratingPdf(true);
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
      setActiveJob(prev => ({ ...prev, status: 'done', progress: 100 }));
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
      a.download = `translated-${job.filename}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { addToast(e.message, 'error'); }
  };

  const isProcessing = activeJobId && activeJob && !['done', 'failed'].includes(activeJob.status);
  const progressPct = generatingPdf ? 95 : (activeJob?.progress || 0);
  const stageLabel  = generatingPdf ? 'Generating bilingual PDF in browser…' : (activeJob?.stage || '');

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
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
            onChange={e => handleFileSelect(e.target.files[0])} />
          {!file ? (
            <>
              <div className="text-3xl mb-2">🌐</div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
                Drop a PDF here or click to browse
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Max 15 MB · PDF only · native and scanned documents supported
              </p>
            </>
          ) : (
            <div className="flex flex-col items-center gap-2">
              <div className="text-2xl">📄</div>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{file.name}</p>
              <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                {(file.size / 1024 / 1024).toFixed(1)} MB
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
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Analysing PDF…</p>
          ) : preflight && (
            <>
              <div className="flex gap-4 text-sm flex-wrap">
                <span style={{ color: 'var(--color-muted)' }}>
                  <strong style={{ color: 'var(--color-text)' }}>{preflight.pageCount}</strong> pages
                </span>
                {preflight.scannedCount > 0 && (
                  <span className="px-2 py-0.5 rounded-full text-xs"
                    style={{ background: 'rgba(124,58,237,0.1)', color: '#7c3aed' }}>
                    {preflight.scannedCount} scanned page{preflight.scannedCount !== 1 ? 's' : ''} — OCR will be applied
                  </span>
                )}
                {preflight.pageCount > 50 && preflight.scannedCount > 0 && (
                  <span className="text-xs" style={{ color: '#d97706' }}>
                    ⚠ Large scanned document — may take several minutes
                  </span>
                )}
              </div>

              <div className="flex gap-3 flex-wrap">
                <div className="flex-1 min-w-40">
                  <Field label="Translate to">
                    <Sel value={targetLang} onChange={setTargetLang}>
                      {LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
                    </Sel>
                  </Field>
                </div>
                <div className="flex-1 min-w-40">
                  <Field label="Glossary (optional)"
                    hint="Use a glossary to fix terminology (e.g. trade names, tax codes) and prevent brand names from being translated.">
                    <Sel value={glossaryId} onChange={setGlossaryId}>
                      <option value="">None</option>
                      {glossaries.map(g => (
                        <option key={g.id} value={g.id}>{g.name} ({g.termCount} terms)</option>
                      ))}
                    </Sel>
                  </Field>
                </div>
              </div>

              <div>
                <Btn onClick={handleSubmit} disabled={submitting || preflighting}>
                  {submitting ? 'Submitting…' : 'Start Translation'}
                </Btn>
              </div>
            </>
          )}
        </div>
      )}

      {/* Active job progress */}
      {isProcessing && (
        <div className="rounded-xl border p-4 flex flex-col gap-3"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              {stageLabel || 'Processing…'}
            </span>
            <StatusBadge status={generatingPdf ? 'generating' : (activeJob?.status || 'pending')} />
          </div>
          <div className="w-full rounded-full h-2" style={{ background: 'var(--color-border)' }}>
            <div className="h-2 rounded-full transition-all duration-500"
              style={{ width: `${progressPct}%`, background: 'var(--color-primary)' }} />
          </div>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{progressPct}% complete</p>
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
                  {['File', 'Languages', 'Pages', 'Cost', 'Date', 'Status', ''].map(h => (
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
                        {job.charCount > 0 ? (
                          <span title={`${job.charCount.toLocaleString()} characters @ $20/1M`}>
                            {job.charCount < 1000
                              ? `< $0.01`
                              : `$${(job.charCount * 20 / 1_000_000).toFixed(4)}`}
                          </span>
                        ) : '—'}
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
                          {job.status === 'done' && (
                            <button onClick={() => downloadJob(job)}
                              className="text-xs px-2 py-1 rounded border"
                              style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}>
                              Download
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
                {['Name', 'Terms', 'Updated', ''].map(h => (
                  <th key={h} className="text-left px-3 py-2 text-xs font-medium" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {glossaries.map(g => (
                <tr key={g.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                  <td className="px-3 py-2 font-medium" style={{ color: 'var(--color-text)' }}>{g.name}</td>
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
  const [glossaries, setGlossaries] = useState([]);

  useEffect(() => {
    api.get('/api/translate/config').then(r => r.json()).then(d => setConfigured(d.configured)).catch(() => {});
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

      {/* Not configured banner */}
      {!configured && (
        <div className="px-6 py-3 text-sm"
          style={{ background: 'rgba(239,68,68,0.08)', borderBottom: '1px solid rgba(239,68,68,0.2)', color: '#dc2626' }}>
          ⚠ <strong>GOOGLE_TRANSLATE_API_KEY</strong> is not set in Railway environment variables.
          The translate agent will not function until this is configured.
        </div>
      )}

      {/* Disclaimer */}
      <div className="px-6 py-2 text-xs" style={{ color: 'var(--color-muted)', borderBottom: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        AI-generated translations are for reference only and are not legally certified. Always verify important documents with a qualified human translator.
        Table layouts may be reformatted as plain text — use a <strong>glossary</strong> to lock domain-specific terms (e.g. product names, tax codes, brand terms).
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'Translations' && <TranslationsTab glossaries={glossaries} />}
        {tab === 'Glossaries'   && <GlossariesTab glossaries={glossaries} setGlossaries={setGlossaries} />}
      </div>
    </div>
  );
}
