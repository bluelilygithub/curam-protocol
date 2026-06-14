import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import useProcessingStore from '../../store/processingStore';
import ModelInsightPanel from './ModelInsightPanel';
import QuizPurposePanel from './QuizPurposePanel';
import { StrategyBarChart } from './WellbeingCharts';

const ASRS5_DRAFT_KEY = 'curam:asrs-5-style:draft';

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function readDraft() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(window.localStorage.getItem(ASRS5_DRAFT_KEY) || 'null'); } catch { return null; }
}

function writeDraft(draft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(ASRS5_DRAFT_KEY, JSON.stringify(draft));
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(ASRS5_DRAFT_KEY);
}

function formatDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function AsrsResultPanel({ attempt, onDownloadPdf, pdfLoading }) {
  const scaleScores = parseMaybeJson(attempt?.scaleScores, []);
  const analysis = parseMaybeJson(attempt?.analysis, {});

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>ASRS-5-style attention result</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Completed {formatDate(attempt.createdAt)}</p>
          </div>
          <button
            type="button"
            onClick={() => onDownloadPdf(attempt)}
            disabled={pdfLoading}
            className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
          >
            {pdfLoading ? 'Preparing PDF...' : 'Download PDF'}
          </button>
        </div>
        <div className="rounded-2xl border p-4 mb-3 text-center" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Total score</p>
          <p className="text-4xl font-bold tabular-nums mt-1" style={{ color: 'var(--color-primary)' }}>{attempt.totalScore}/24</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>{attempt.bandLabel}</p>
        </div>
        <p className="text-sm mb-2" style={{ color: 'var(--color-text)' }}>{analysis.summary}</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{analysis.interpretation}</p>
      </section>

      <ModelInsightPanel insight={analysis.modelInsight} title="Considered response" />

      <StrategyBarChart scales={scaleScores} responseMax={4} minValue={0} variant="asrs5" title="ASRS-5-style attention/self-regulation profile" />

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>How this check was formed</h2>
        <div className="space-y-2 text-sm" style={{ color: 'var(--color-muted)' }}>
          <p>{analysis?.rationale?.scoring}</p>
          <p>{analysis?.rationale?.pattern}</p>
        </div>
      </section>
    </div>
  );
}

export default function Asrs5StylePanel({ onBack, onComplete, onNext, nextLabel = 'Continue' }) {
  const { startProcessing, stopProcessing } = useProcessingStore();
  const [config, setConfig] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('intro');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [selectedValue, setSelectedValue] = useState(null);
  const [result, setResult] = useState(null);
  const [detail, setDetail] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [pdfLoadingId, setPdfLoadingId] = useState(null);
  const [error, setError] = useState('');
  const [draftMeta, setDraftMeta] = useState(null);
  const [showPurpose, setShowPurpose] = useState(false);

  const questions = config?.questions || [];
  const current = questions[index];
  const progress = questions.length ? Math.round(((index + 1) / questions.length) * 100) : 0;

  const refreshDraftMeta = useCallback(() => {
    const draft = readDraft();
    if (!draft || !Array.isArray(draft.answers)) {
      setDraftMeta(null);
      return;
    }
    setDraftMeta({
      updatedAt: draft.updatedAt,
      answeredCount: draft.answers.length + (draft.selectedValue != null ? 1 : 0),
    });
  }, []);

  const refreshAttempts = useCallback(async () => {
    const res = await api.get('/api/wellbeing/asrs5/attempts');
    const data = await res.json();
    setAttempts(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [questionRes] = await Promise.all([
          api.get('/api/wellbeing/asrs5/questions'),
          refreshAttempts(),
        ]);
        const questionData = await questionRes.json();
        if (!questionRes.ok) throw new Error(questionData.error || 'Could not load ASRS-5-style check');
        setConfig(questionData);
        refreshDraftMeta();
      } catch (err) {
        setError(err.message || 'Could not load ASRS-5-style check');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAttempts, refreshDraftMeta]);

  const startAttempt = () => {
    if (draftMeta && !window.confirm('Start over and discard the paused ASRS-5-style draft?')) return;
    clearDraft();
    setDraftMeta(null);
    setMode('taking');
    setIndex(0);
    setAnswers([]);
    setSelectedValue(null);
    setResult(null);
    setDetail(null);
    setError('');
  };

  const resumeAttempt = () => {
    const draft = readDraft();
    if (!draft || !Array.isArray(draft.answers) || !questions.length) {
      setDraftMeta(null);
      return;
    }
    const safeAnswers = draft.answers
      .filter((answer) => Number.isFinite(Number(answer.questionId)) && Number.isFinite(Number(answer.value)))
      .slice(0, questions.length - 1);
    const safeIndex = Math.min(Math.max(Number(draft.index) || safeAnswers.length, 0), questions.length - 1);
    setAnswers(safeAnswers.slice(0, safeIndex));
    setIndex(safeIndex);
    setSelectedValue(draft.selectedValue == null ? null : Number(draft.selectedValue));
    setResult(null);
    setDetail(null);
    setError('');
    setMode('taking');
  };

  const pauseAttempt = () => {
    writeDraft({
      version: config?.version,
      index,
      answers,
      selectedValue,
      updatedAt: new Date().toISOString(),
    });
    refreshDraftMeta();
    setMode('intro');
  };

  const returnToTools = () => {
    if (mode === 'taking') {
      writeDraft({
        version: config?.version,
        index,
        answers,
        selectedValue,
        updatedAt: new Date().toISOString(),
      });
    }
    onBack();
  };

  const goBackOneQuestion = () => {
    if (index <= 0) return;
    const previousAnswer = answers[index - 1];
    setAnswers((prev) => prev.slice(0, -1));
    setIndex((value) => value - 1);
    setSelectedValue(previousAnswer?.value ?? null);
  };

  const submitCurrent = async () => {
    if (!current || selectedValue == null || submitting) return;
    const nextAnswers = [...answers, { questionId: current.id, value: selectedValue }];

    if (index + 1 < questions.length) {
      setAnswers(nextAnswers);
      setIndex((value) => value + 1);
      setSelectedValue(null);
      return;
    }

    setSubmitting(true);
    setError('');
    startProcessing(
      'Saving your ASRS-5-style attention check...',
      'We are scoring attention and self-regulation patterns, then preparing the considered response. This can take a little while, so please stay on this screen until it finishes.'
    );
    try {
      const res = await api.post('/api/wellbeing/asrs5/attempts', { answers: nextAnswers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save ASRS-5-style attempt');
      setResult(data);
      setMode('result');
      clearDraft();
      setDraftMeta(null);
      await refreshAttempts();
      await onComplete?.();
    } catch (err) {
      setError(err.message || 'Could not save ASRS-5-style attempt');
    } finally {
      stopProcessing();
      setSubmitting(false);
    }
  };

  const openAttempt = async (id) => {
    setError('');
    try {
      const res = await api.get(`/api/wellbeing/asrs5/attempts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Attempt not found');
      setDetail(data);
      setMode('detail');
    } catch (err) {
      setError(err.message || 'Could not open attempt');
    }
  };

  const deleteAttempt = async (id) => {
    if (!window.confirm('Delete this completed ASRS-5-style check?')) return;
    await api.delete(`/api/wellbeing/asrs5/attempts/${id}`).catch(() => {});
    if (detail?.id === id) {
      setDetail(null);
      setMode('intro');
    }
    await refreshAttempts();
  };

  const downloadAttemptPdf = async (attempt) => {
    if (!attempt?.id || pdfLoadingId) return;
    setPdfLoadingId(attempt.id);
    setError('');
    try {
      const res = await api.get(`/api/wellbeing/asrs5/attempts/${attempt.id}/pdf`);
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `asrs-5-style-${attempt.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Could not download PDF');
    } finally {
      setPdfLoadingId(null);
    }
  };

  const latestScales = useMemo(() => {
    if (!attempts[0]) return [];
    return parseMaybeJson(attempts[0].scaleScores, []);
  }, [attempts]);

  if (loading) return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading ASRS-5-style check...</div>;
  if (error && !config) return <div className="p-6 text-sm" style={{ color: '#ef4444' }}>{error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button type="button" onClick={returnToTools} className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mb-3" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}>
            Back to wellbeing tools
          </button>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>ASRS-5-Style Attention Check</h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            A six-item proof-of-concept adult attention and self-regulation screener. This is not the official ASRS-5 and is not a diagnosis.
          </p>
        </div>
        <button type="button" onClick={startAttempt} className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: 'var(--color-primary)' }}>
          {draftMeta ? 'Start over' : 'Start ASRS-5-style check'}
        </button>
      </div>

      {error && <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>}

      {mode === 'intro' && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-4">
            <QuizPurposePanel
              open={showPurpose}
              onToggle={() => setShowPurpose((value) => !value)}
              title="ASRS-5-style attention check"
              summary="This short screener adds an attention and self-regulation lens to the combined profile. It helps identify whether focus, activation, impulsive responding, procrastination, or external structure may shape the client’s day-to-day pattern."
              points={[
                'It covers six attention and self-regulation prompts.',
                'It helps the combined profile distinguish mood or coping problems from attention-friction patterns.',
                'It is useful for reflection and for deciding whether professional follow-up may be worth discussing.',
              ]}
              guidance={[
                'Answer based on how often the pattern has shown up recently.',
                'Choose the closest frequency, even if the item depends on context.',
                'Treat elevated scores as a prompt for discussion, not as a diagnosis.',
              ]}
              caveat="This is a proof-of-concept ASRS-5-style tool using original wording. It is not the official ASRS-5, not an ADHD diagnosis, and not a substitute for professional assessment."
            />
            <section className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Before you begin</h3>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                Rate how often each pattern has shown up. The result is a screening-style reflection about attention and self-regulation, not a clinical conclusion.
              </p>
              <ul className="text-sm space-y-2" style={{ color: 'var(--color-muted)' }}>
                <li>Six statements are answered in order.</li>
                <li>Responses use a 0-4 frequency scale.</li>
                <li>You can pause and resume later on this device.</li>
                <li>You can go back one statement at a time to correct a mistaken selection.</li>
                <li>Completed attempts can be reviewed, deleted, or downloaded as PDF.</li>
              </ul>
            </section>
          </div>

          <aside className="space-y-3">
            {draftMeta && (
              <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Paused check</p>
                <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>
                  {Math.min(draftMeta.answeredCount, questions.length)} of {questions.length} statements started
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Saved {formatDate(draftMeta.updatedAt)}</p>
                <button type="button" onClick={resumeAttempt} className="w-full px-3 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity mt-3" style={{ background: 'var(--color-primary)' }}>
                  Resume paused check
                </button>
              </div>
            )}
            <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Completed checks</p>
              <p className="text-3xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{attempts.length}</p>
              {latestScales.length > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Latest strongest: {[...latestScales].sort((a, b) => Number(b.score) - Number(a.score))[0]?.label}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      {mode === 'taking' && current && (
        <section className="max-w-2xl mx-auto space-y-4">
          <div className="sticky top-0 z-10 py-2" style={{ background: 'var(--color-bg)' }}>
            <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
              <span>Statement {index + 1} of {questions.length}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface)' }}>
              <div className="h-full transition-all" style={{ width: `${progress}%`, background: 'var(--color-primary)' }} />
            </div>
          </div>

          <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>{current.scaleLabel}</p>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{current.statement}</h3>
            <div className="space-y-2">
              {current.options.map((option) => (
                <button key={option.value} type="button" onClick={() => setSelectedValue(option.value)} className="w-full rounded-xl border px-4 py-3 text-left transition-opacity hover:opacity-80" style={{ background: selectedValue === option.value ? 'var(--color-bg)' : 'transparent', borderColor: selectedValue === option.value ? 'var(--color-primary)' : 'var(--color-border)', color: 'var(--color-text)' }}>
                  <span className="text-xs font-semibold mr-2" style={{ color: 'var(--color-muted)' }}>{option.value}</span>
                  <span className="text-sm">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={pauseAttempt} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Pause</button>
              <button type="button" onClick={goBackOneQuestion} disabled={index === 0} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70 disabled:opacity-40 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Back</button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => { if (window.confirm('Cancel this ASRS-5-style attempt and discard the paused draft?')) { clearDraft(); setDraftMeta(null); setMode('intro'); } }} className="px-3 py-2 rounded-xl text-sm border hover:opacity-70 transition-opacity" style={{ borderColor: '#fecaca', color: '#991b1b' }}>
                Cancel
              </button>
              <button type="button" onClick={submitCurrent} disabled={selectedValue == null || submitting} className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity" style={{ background: 'var(--color-primary)' }}>
                {index + 1 >= questions.length ? (submitting ? 'Saving...' : 'Finish check') : 'Continue'}
              </button>
            </div>
          </div>
        </section>
      )}

      {mode === 'result' && result && (
        <section className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={onBack} className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}>Back to test dashboard</button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startAttempt} className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>Retake</button>
              {onNext && <button type="button" onClick={onNext} className="px-3 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: 'var(--color-primary)' }}>{nextLabel}</button>}
            </div>
          </div>
          <AsrsResultPanel attempt={result} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === result.id} />
        </section>
      )}

      {mode === 'detail' && detail && (
        <section className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setMode('intro')} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>Back to ASRS overview</button>
            <button type="button" onClick={() => deleteAttempt(detail.id)} className="text-sm hover:opacity-70" style={{ color: '#dc2626' }}>Delete</button>
          </div>
          <AsrsResultPanel attempt={detail} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === detail.id} />
        </section>
      )}

      {mode === 'intro' && (
        <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-4 py-3 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Past completed ASRS checks</h3>
          </div>
          {attempts.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>No completed ASRS checks yet.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {attempts.map((attempt) => (
                <div key={attempt.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                  <button type="button" onClick={() => openAttempt(attempt.id)} className="flex-1 text-left hover:opacity-70 transition-opacity">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{attempt.totalScore}/24 · {attempt.bandLabel}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{formatDate(attempt.createdAt)}</p>
                  </button>
                  <button type="button" onClick={() => deleteAttempt(attempt.id)} className="text-xs px-2 py-1 rounded-lg border hover:opacity-70" style={{ borderColor: '#fecaca', color: '#991b1b' }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
