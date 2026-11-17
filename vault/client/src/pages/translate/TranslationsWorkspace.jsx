import React, { useState, useEffect, useRef, useCallback } from 'react';
import { pdf } from '@react-pdf/renderer';
import api from '../../utils/apiClient';
import useToastStore from '../../store/toastStore';
import useProcessingStore from '../../store/processingStore';
import { useIcon } from '../../providers/IconProvider';
import Tooltip from '../../components/Tooltip';
import { VoiceInput } from '../../components/voiceInput/VoiceInput';
import { LANGUAGES, orderLanguages, languageOptionLabel } from '../../utils/translateLanguages';
import {
  Btn, Field, Sel, Tip, getPdfJs, detectUploadKind, saveFromApi, baseName, isSpreadsheet,
  PROGRESS_STAGE_ORDER, PROGRESS_STEP_LABELS, ACCEPT_UPLOAD, DOMAIN_OPTIONS, AUDIENCE_OPTIONS,
} from './shared';
import { parseQa } from './qaReport';
import { registerFonts, buildBilingualPdf } from './translatePdf';
import { resolvePreset } from './translateGoals.mjs';
import { ENGINE_LABELS, LAYOUT_OPTIONS } from './translateTools.mjs';
import QaPanel from './QaPanel';
import JobsDashboard from './JobsDashboard';
import { offerUndo } from '../../utils/binUndo';

// New translation and My translations. One component holds both screens because a running job belongs to both: the form starts it,
// the status check and the PDF step (still done in this browser) carry on whichever screen is showing, and the list shows the result.
// `view` ('new' | 'jobs', anything else hides it) picks the screen; the component stays mounted so a running job is never dropped.

export default function TranslationsWorkspace({ glossaries, view, preset, onShowJobs, onNewTranslation, onOpenGlossaries }) {
  const [jobs, setJobs]             = useState([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [file, setFile]             = useState(null);
  const [dragOver, setDragOver]     = useState(false);
  const [pasteMode, setPasteMode]   = useState(false);
  const [pasteText, setPasteText]   = useState('');
  // Starts on the workspace's usual language (Settings → AI & Chat → Translate agent); a job from the start screen or the person's
  // own pick wins over that default, which arrives a moment after the page opens.
  const [targetLang, setTargetLangRaw] = useState('fr');
  const langTouched = useRef(false);
  const setTargetLang = (v) => { langTouched.current = true; setTargetLangRaw(v); };
  const [moreOpen, setMoreOpen] = useState(false);
  const [presetNote, setPresetNote] = useState(null); // { title, fellBack } while the form is filled in from a start-screen job
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
    // A refused request (too many in a minute, a server error) answers with an error object, not a list: keep the list we have.
    api.get('/api/translate/jobs').then(r => (r.ok ? r.json() : null)).then((d) => { if (Array.isArray(d)) setJobs(d); }).catch(() => {})
      .finally(() => setLoadingJobs(false));
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  // Look up whether a global (auto-learned) glossary already exists for the chosen target
  // language — surfaced as an opt-in checkbox rather than forcing the manual glossary picker.
  useEffect(() => {
    if (!targetLang) { setGlobalGlossary(null); return; }
    api.get(`/api/translate/glossaries/global/${targetLang}`).then(r => (r.ok ? r.json() : null)).then(setGlobalGlossary).catch(() => setGlobalGlossary(null));
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
      if (s.translate_target_language && !langTouched.current) setTargetLangRaw(s.translate_target_language);
    }).catch(() => {});
    api.get('/api/settings/translate-language-order').then(r => r.json()).then((d) => {
      if (Array.isArray(d.order) && d.order.length) setLanguageOptions(orderLanguages(d.order));
    }).catch(() => {});
  }, []);

  // A job picked on the start screen fills the form in. `preset.nonce` changes on every pick, so picking the same job twice
  // fills it in again. Google falls back to Vault AI when Google Translate is not set up (and the form says so).
  useEffect(() => {
    if (!preset) { setPresetNote(null); return; }
    const p = resolvePreset(preset.values, engineAvailability);
    setEngine(p.engine);
    setEnableReview(Boolean(p.review));
    setPdfLayout(p.layout);
    if (p.targetLang) setTargetLang(p.targetLang);
    if (!file) setPasteMode(Boolean(p.paste));
    setPresetNote({ title: preset.title, fellBack: Boolean(p.fellBack), wanted: preset.values.engine });
  }, [preset?.nonce, engineAvailability.llm, engineAvailability.google]); // eslint-disable-line react-hooks/exhaustive-deps

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
          summary: 'Word document. You also get an editable Word file back when its structure allows.',
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
          summary: 'Spreadsheet. Cells with words are translated; numbers are left alone. You also get an Excel file back.',
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
          summary: 'Plain text. You get a PDF and a plain text file back.',
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
    if (f.size > 5 * 1024 * 1024) { addToast('That file is over the 5 MB limit', 'error'); return; }
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
    if (engine === 'llm' && !domain) { addToast('Please choose the kind of document', 'error'); return; }
    if (engine === 'google' && !engineAvailability.google) {
      addToast('Google Translate is not set up for this workspace.', 'error');
      return;
    }
    if (engine === 'llm' && !engineAvailability.llm) {
      addToast('Vault AI has no translation model chosen yet. An admin sets it in Settings, AI & Chat, Translate agent.', 'error');
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

      startProcessing('Translating your document…', 'Keep this page open until it finishes. Closing or reloading it stops the translation.', {
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
          if (data.status === 'failed') { addToast(data.errorMessage || 'Translation failed', 'error'); onShowJobs?.(); }
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
    updateProcessingDetail('Putting the PDF together…');
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
      addToast('Translation finished. It is in My translations.', 'success');
      onShowJobs?.();
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

  // Delete moves the translation and its files to the shared recycle bin (30 days) and offers Undo. One too big for the bin
  // comes back as "too large": the list then asks whether to delete it for good (`forever`).
  const [tooLargeId, setTooLargeId] = useState(null);
  const deleteJob = async (id, { forever = false } = {}) => {
    setDeletingId(id);
    try {
      const res = await api.delete(`/api/translate/jobs/${id}${forever ? '?forever=1' : ''}`);
      const body = await res.json().catch(() => ({}));
      if (res.status === 413 && body.tooLarge) { setTooLargeId(id); return; }
      if (!res.ok) throw new Error(body.error || 'Could not delete the translation');
      setTooLargeId(null);
      setJobs(prev => prev.filter(j => j.id !== id));
      if (forever) addToast('Translation deleted for good', 'success');
      else offerUndo({ message: 'Translation moved to the recycle bin. It stays there for 30 days.', binIds: body.binId, restoredMessage: 'Translation put back', after: loadJobs });
    } catch (e) { addToast(e.message, 'error'); }
    finally { setDeletingId(null); }
  };

  const save = (path, name, failText) => saveFromApi(api, path, name, failText).catch((e) => addToast(e.message, 'error'));
  const downloadJob = (job) => save(`/api/translate/jobs/${job.id}/download`, `translated-${baseName(job)}.pdf`);
  const downloadOriginalJob = (job) => save(`/api/translate/jobs/${job.id}/download-original`, job.filename || 'document', 'The original file is not available');
  const downloadNativeJob = (job) => save(`/api/translate/jobs/${job.id}/download-native`, `translated-${baseName(job)}.${isSpreadsheet(job) ? 'xlsx' : 'docx'}`);
  const downloadTextJob = (job) => save(`/api/translate/jobs/${job.id}/download-text`, `translated-${baseName(job)}.txt`, 'The text is not available for this translation');
  const getIcon = useIcon();

  const langName = LANGUAGES.find((l) => l.code === targetLang)?.label || targetLang;
  const lowResource = languageOptions.find((l) => l.code === targetLang)?.lowResource;
  const ownGlossary = glossaries.find((g) => String(g.id) === String(glossaryId));
  const layoutLabel = LAYOUT_OPTIONS.find((l) => l.v === pdfLayout)?.label || pdfLayout;
  const kind = file ? detectUploadKind(file) : null;
  const canStart = Boolean(file && preflight && !preflighting && !submitting && !(engine === 'llm' && !domain));
  // What this job will do, in one line, so the choices under More options never have to be opened to know.
  const summary = [
    `Translated by ${ENGINE_LABELS[engine]}`,
    enableReview ? 'checked by a second AI model' : 'no second-model check',
    `PDF: ${layoutLabel.toLowerCase()}`,
    useGlobalGlossary ? `learned glossary for ${langName}` : ownGlossary ? `glossary “${ownGlossary.name}”` : 'no glossary',
  ].join(' · ');
  const CARD = 'rounded-2xl border p-5 space-y-4';
  const CARD_STYLE = { borderColor: 'var(--color-border)', background: 'var(--color-surface)' };
  const CHECK = 'flex items-start gap-2 text-sm cursor-pointer';

  return (
    <>
      {view === 'new' && (
        <div className="flex flex-col xl:grid xl:grid-cols-2 xl:items-start gap-4">
          {/* ── 1. The document and the language ── */}
          <section className={CARD} style={CARD_STYLE} data-tour="translate-document">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>1. Your document</h2>
              {!file && (
                <Tooltip text={pasteMode ? 'Go back to choosing a file from your computer.' : 'No file? Paste or dictate the text here instead. You get a PDF and a plain text file back.'}>
                  <button
                    type="button"
                    onClick={() => setPasteMode((m) => !m)}
                    className="text-xs font-medium underline transition-opacity duration-200 hover:opacity-70"
                    style={{ color: 'var(--color-primary)' }}
                  >
                    {pasteMode ? 'Upload a file instead' : 'Paste text instead'}
                  </button>
                </Tooltip>
              )}
            </div>

            {!file && pasteMode ? (
              <div className="space-y-3">
                <Tip text="Paste the text to translate, or press the microphone and say it. Then press Use this text.">
                  <VoiceInput
                    type="textarea"
                    append
                    rows={9}
                    value={pasteText}
                    onChange={setPasteText}
                    placeholder="Paste the text you want translated…"
                    label="Text to translate"
                  />
                </Tip>
                <div className="flex justify-end">
                  <Tooltip text="Treat this text as the document. Next: pick the language and press Start translation.">
                    <span><Btn onClick={usePastedText} disabled={!pasteText.trim()}>Use this text</Btn></span>
                  </Tooltip>
                </div>
              </div>
            ) : (
              <Tooltip text="Drop a file here, or click to choose one. PDF, Word (.docx), Excel (.xlsx, .xls) or plain text (.txt), up to 5 MB. Scanned PDFs are read with text recognition first.">
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Choose a file to translate"
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                  onClick={() => !file && fileRef.current?.click()}
                  onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !file) { e.preventDefault(); fileRef.current?.click(); } }}
                  className="rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-200"
                  style={{ borderColor: dragOver ? 'var(--color-primary)' : 'var(--color-border)', background: 'var(--color-bg)' }}
                >
                  <input ref={fileRef} type="file" accept={ACCEPT_UPLOAD} className="hidden" onChange={(e) => handleFileSelect(e.target.files[0])} />
                  {!file ? (
                    <>
                      <div className="flex justify-center mb-2" style={{ color: 'var(--color-primary)' }}>{getIcon('upload', { size: 28 })}</div>
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Drop a PDF, Word, Excel or text file here, or click to choose one</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Up to 5 MB · .pdf · .docx · .xlsx · .txt · scanned PDFs are read first</p>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1.5">
                      <div style={{ color: 'var(--color-primary)' }}>{getIcon('file-text', { size: 26 })}</div>
                      <p className="text-sm font-medium break-all" style={{ color: 'var(--color-text)' }}>{file.name}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {(file.size / 1024 / 1024).toFixed(1)} MB{kind ? ` · ${kind.toUpperCase()}` : ''}
                      </p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setFile(null); setPreflight(null); setPasteText(''); setEstimate(null); if (fileRef.current) fileRef.current.value = ''; }}
                        className="text-xs underline transition-opacity duration-200 hover:opacity-60"
                        style={{ color: 'var(--color-muted)' }}
                      >
                        Remove and choose another
                      </button>
                    </div>
                  )}
                </div>
              </Tooltip>
            )}

            {file && (preflighting ? (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{kind === 'pdf' ? 'Looking through the PDF…' : 'Getting the file ready…'}</p>
            ) : preflight && (
              <div className="text-sm space-y-1" style={{ color: 'var(--color-muted)' }}>
                {preflight.summary ? <p>{preflight.summary}</p> : (
                  <p><strong style={{ color: 'var(--color-text)' }}>{preflight.pageCount}</strong> {preflight.pageCount === 1 ? 'page' : (preflight.unitLabel || 'pages')}</p>
                )}
                {preflight.scannedCount > 0 && (
                  <p style={{ color: '#b45309' }}>
                    {preflight.scannedCount} scanned page{preflight.scannedCount !== 1 ? 's' : ''}: these are pictures of text and are read first, which takes longer
                    {preflight.pageCount > 50 ? ' (several minutes for a document this long)' : ''}.
                  </p>
                )}
                {preflight.kind === 'pdf' && (
                  <p className="text-xs">A PDF with several columns or tables can be read in the wrong order. If you have the Word or Excel file, use that instead.</p>
                )}
              </div>
            ))}

            <div data-tour="translate-language">
              <Field
                label="Translate to"
                hint={targetLang === 'mi'
                  ? 'Standard te reo Māori (Te Taura Whiri) unless you name an audience below.'
                  : lowResource
                    ? 'The AI has seen fewer examples of this language, so expect lower quality and check the result carefully.'
                    : 'For this translation only. The usual language is set in Settings, AI & Chat, Translate agent.'}
              >
                <Tip text="The language to translate into. The language of the original is worked out for you. One language per translation.">
                  <Sel value={targetLang} onChange={(v) => { setTargetLang(v); if (v !== 'mi') setRegionalAudience(''); }} aria-label="Translate to">
                    {languageOptions.map((l) => <option key={l.code} value={l.code}>{languageOptionLabel(l)}</option>)}
                  </Sel>
                </Tip>
              </Field>
            </div>

            {targetLang === 'mi' && (
              <Field label="Iwi / rohe audience (optional)" hint="Leave empty for standard te reo Māori. Regional word choices are listed in the result beside the standard form.">
                <Tip text="Name the audience only if the wording should suit a particular iwi or rohe, for example Ngāi Tahu.">
                  <VoiceInput value={regionalAudience} onChange={setRegionalAudience} placeholder="e.g. Ngāi Tahu audience, Tāmaki Makaurau" label="Iwi or rohe audience" />
                </Tip>
              </Field>
            )}
          </section>

          {/* ── 2. How to translate it ── */}
          <section className={CARD} style={CARD_STYLE} data-tour="translate-options">
            <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>2. How to translate it</h2>

            <div className="rounded-xl border p-3 text-sm space-y-1" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }} data-tour="translate-summary">
              {presetNote && <p><strong>Set up for:</strong> {presetNote.title}</p>}
              <p style={{ color: 'var(--color-muted)' }}>{summary}</p>
              {presetNote?.fellBack && (
                <p className="text-xs" style={{ color: '#b45309' }}>
                  {presetNote.wanted === 'google'
                    ? 'Google Translate is not set up for this workspace, so this uses Vault AI. It is slower but more careful.'
                    : 'Vault AI has no translation model chosen yet, so this uses Google Translate without the second check.'}
                </p>
              )}
            </div>

            {engine === 'llm' && (
              <div className="space-y-3" data-tour="translate-about">
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>About the document</p>
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}>
                  <Field label="Kind of document">
                    <Tip text="Tells the translator which specialist words to expect, for example legal or medical terms.">
                      <Sel value={domain} onChange={setDomain} aria-label="Kind of document">
                        {DOMAIN_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Sel>
                    </Tip>
                  </Field>
                  <Field label="Who will read it">
                    <Tip text="Sets how formal and how plain the wording should be for that reader.">
                      <Sel value={audience} onChange={setAudience} aria-label="Who will read it">
                        {AUDIENCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </Sel>
                    </Tip>
                  </Field>
                  <Field label="Style">
                    <Tip text="Natural reads as if written in that language. Close to the original keeps the sentence shapes, which suits contracts and anything checked line by line.">
                      <Sel value={tone} onChange={setTone} aria-label="Style">
                        <option value="natural">Natural, reads well</option>
                        <option value="literal">Close to the original wording</option>
                      </Sel>
                    </Tip>
                  </Field>
                </div>
              </div>
            )}

            <Field label="Words to keep as they are (optional)" hint="Brand names, product codes, abbreviations. Put commas between them.">
              <Tip text="These words are left exactly as written in the translation, for this job only. For every job, add them to a glossary. The microphone lets you say them.">
                <VoiceInput value={mustKeepTerms} onChange={setMustKeepTerms} placeholder="e.g. Curam, Masterspec, ABN" label="Words to keep as they are" />
              </Tip>
            </Field>

            {engine === 'llm' && (
              <Field label="Notes for the translator (optional)">
                <Tip text="Anything else the translator should know, in your own words. Type it or press the microphone and say it.">
                  <VoiceInput
                    type="textarea"
                    append
                    rows={2}
                    value={intakeNotes}
                    onChange={setIntakeNotes}
                    placeholder="e.g. Use TPS not TVA for NZ GST; keep the English section headings"
                    label="Notes for the translator"
                  />
                </Tip>
              </Field>
            )}

            <div>
              <Tooltip text="The translator, the PDF layout, the glossary and the second-model check. The line at the top of this box shows what they are set to.">
                <button
                  type="button"
                  onClick={() => setMoreOpen((o) => !o)}
                  aria-expanded={moreOpen}
                  data-tour="translate-more"
                  className="text-sm font-medium inline-flex items-center gap-1.5 transition-opacity duration-200 hover:opacity-70"
                  style={{ color: 'var(--color-primary)' }}
                >
                  {moreOpen ? '▼' : '▶'} More options
                </button>
              </Tooltip>

              {moreOpen && (
                <div className="mt-3 space-y-4 pl-3 border-l" style={{ borderColor: 'var(--color-border)' }}>
                  <Field
                    label="Translated by"
                    hint={engine === 'google'
                      ? 'Takes seconds. Good for a draft in a common language. It does not use what you say about the document.'
                      : 'Takes a few minutes. Uses what you say about the document, the glossary and, if ticked, a second-model check.'}
                  >
                    <Tip text="Vault AI is the careful translator for anything that will be sent on. Google Translate is the fast one for a draft you only need to read.">
                      <Sel
                        value={engine}
                        aria-label="Translated by"
                        onChange={(v) => { setEngine(v); setEnableReview(v !== 'google'); }}
                      >
                        <option value="llm" disabled={!engineAvailability.llm}>{ENGINE_LABELS.llm}{!engineAvailability.llm ? ' (not set up)' : ''}</option>
                        <option value="google" disabled={!engineAvailability.google}>{ENGINE_LABELS.google}{!engineAvailability.google ? ' (not set up)' : ''}</option>
                      </Sel>
                    </Tip>
                  </Field>

                  <Field label="PDF layout" hint="The PDF holds the words in order with plain styling. It does not copy the look of the original.">
                    <div className="flex flex-col gap-1.5 pt-1">
                      {LAYOUT_OPTIONS.map(({ v, label }) => (
                        <Tooltip key={v} text={v === 'translation-only' ? 'A PDF of the translation by itself.' : 'Each page of the original followed by its translation, for checking one against the other.'}>
                          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--color-text)' }}>
                            <input type="radio" name="pdfLayout" value={v} checked={pdfLayout === v} onChange={() => setPdfLayout(v)} />
                            {label}
                          </label>
                        </Tooltip>
                      ))}
                    </div>
                  </Field>

                  <Field label="Glossary">
                    <Tooltip text={`A glossary is a list of words with the translation they must always get. Translate keeps one for ${langName} and adds this job's new terms to it afterwards, so the same word is translated the same way next time.`}>
                      <label className={CHECK} style={{ color: 'var(--color-text)' }}>
                        <input type="checkbox" className="mt-1" checked={useGlobalGlossary} onChange={(e) => setUseGlobalGlossary(e.target.checked)} />
                        <span>
                          Use and add to the learned glossary for {langName}
                          <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                            {globalGlossary
                              ? `${globalGlossary.termCount} word${globalGlossary.termCount === 1 ? '' : 's'} learned so far.`
                              : 'Nothing learned yet; this translation starts it.'}
                          </span>
                        </span>
                      </label>
                    </Tooltip>
                    {!useGlobalGlossary && (
                      <Tip text="Use one of your own glossaries for this translation instead of the learned one.">
                        <Sel value={glossaryId} onChange={setGlossaryId} aria-label="Your glossary">
                          <option value="">No glossary</option>
                          {glossaries.map((g) => <option key={g.id} value={g.id}>{g.name} ({g.termCount} words)</option>)}
                        </Sel>
                      </Tip>
                    )}
                    <button
                      type="button"
                      onClick={onOpenGlossaries}
                      className="text-xs underline self-start transition-opacity duration-200 hover:opacity-60"
                      style={{ color: 'var(--color-primary)' }}
                    >
                      See or edit glossaries
                    </button>
                  </Field>

                  <Tooltip text="Another AI model compares every part of the translation with the original and lists what looks wrong. It finds problems; it does not fix them. It adds time. Checks for missing, empty and cut-short parts always run.">
                    <label className={CHECK} style={{ color: 'var(--color-text)' }}>
                      <input type="checkbox" className="mt-1" checked={enableReview} onChange={(e) => setEnableReview(e.target.checked)} />
                      <span>
                        Have a second AI model check the translation
                        <span className="block text-xs" style={{ color: 'var(--color-muted)' }}>
                          {engine === 'google' ? 'Slower. Needs a Vault AI checking model.' : 'Recommended for anything you will send on.'}
                        </span>
                      </span>
                    </label>
                  </Tooltip>
                </div>
              )}
            </div>
          </section>

          {/* ── Start ── */}
          <div className="xl:col-span-2 flex items-center gap-3 flex-wrap" data-tour="translate-start">
            <Tooltip text={file ? 'Start the translation. A window shows each step. Keep this page open until it finishes.' : 'Add a document first.'}>
              <span>
                <Btn onClick={handleSubmit} disabled={!canStart} className="!px-5 !py-2">
                  {submitting ? 'Starting…' : 'Start translation'}
                </Btn>
              </span>
            </Tooltip>
            <Tooltip text="Count the characters in the document and show a rough cost in Australian dollars before you start. Nothing is translated.">
              <button
                type="button"
                onClick={runEstimate}
                disabled={estimating || preflighting || !file}
                className="text-sm px-3 py-2 rounded-lg border transition-opacity duration-200 hover:opacity-70 disabled:opacity-50"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              >
                {estimating ? 'Working it out…' : 'Get estimate'}
              </button>
            </Tooltip>
            {!file && <span className="text-sm" style={{ color: 'var(--color-muted)' }}>Add a document to start.</span>}
            {estimate && (
              <span className="text-sm" style={{ color: 'var(--color-muted)' }}>
                {estimate.charCount.toLocaleString()} characters
                {estimate.estCostAud != null ? ` · about A$${estimate.estCostAud.toFixed(estimate.estCostAud < 0.1 ? 3 : 2)} (rough)` : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {view === 'jobs' && (
        <JobsDashboard
          jobs={jobs}
          loading={loadingJobs}
          activeJobId={activeJobId}
          deletingId={deletingId}
          onOpen={setQaJob}
          onCancel={cancelJob}
          onDelete={deleteJob}
          tooLargeId={tooLargeId}
          onKeepTooLarge={() => setTooLargeId(null)}
          onDownload={downloadJob}
          onDownloadNative={downloadNativeJob}
          onNew={onNewTranslation}
        />
      )}

      {qaJob && (
        <QaPanel
          qa={parseQa(qaJob)}
          job={qaJob}
          onClose={() => setQaJob(null)}
          onDownload={downloadJob}
          onDownloadNative={downloadNativeJob}
          onDownloadOriginal={downloadOriginalJob}
          onDownloadText={downloadTextJob}
        />
      )}
    </>
  );
}
