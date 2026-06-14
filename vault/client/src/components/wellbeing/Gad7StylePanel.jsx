import React, { useCallback, useEffect, useState } from 'react';
import api from '../../utils/apiClient';
import useProcessingStore from '../../store/processingStore';
import ModelInsightPanel from './ModelInsightPanel';
import QuizPurposePanel from './QuizPurposePanel';
import { Gad7SeverityGauge } from './WellbeingCharts';

const GAD7_DRAFT_KEY = 'curam:gad-7-style:draft';

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function readDraft() {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(window.localStorage.getItem(GAD7_DRAFT_KEY) || 'null'); } catch { return null; }
}

function writeDraft(draft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(GAD7_DRAFT_KEY, JSON.stringify(draft));
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(GAD7_DRAFT_KEY);
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

function Gad7ResultPanel({ attempt, onDownloadPdf, pdfLoading }) {
  const analysis = parseMaybeJson(attempt?.analysis, {});
  const answers = parseMaybeJson(attempt?.answers, []);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>GAD-7-style anxiety result</h2>
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
          <p className="text-4xl font-bold tabular-nums mt-1" style={{ color: 'var(--color-primary)' }}>{attempt.totalScore}/21</p>
          <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>{attempt.bandLabel}</p>
        </div>
        <p className="text-sm mb-2" style={{ color: 'var(--color-text)' }}>{analysis.summary}</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{analysis.interpretation}</p>
      </section>

      <ModelInsightPanel insight={analysis.modelInsight} title="Considered response" />

      <Gad7SeverityGauge score={attempt.totalScore} label={attempt.bandLabel} />

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Item responses</h2>
        <div className="space-y-2">
          {answers.map((answer) => (
            <div key={answer.questionId} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{answer.topic}: {answer.score}/3</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{answer.optionText}</p>
            </div>
          ))}
        </div>
      </section>

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

export default function Gad7StylePanel({ onBack, onComplete, onNext, nextLabel = 'Continue' }) {
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
    const res = await api.get('/api/wellbeing/gad7/attempts');
    const data = await res.json();
    setAttempts(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [questionRes] = await Promise.all([
          api.get('/api/wellbeing/gad7/questions'),
          refreshAttempts(),
        ]);
        const questionData = await questionRes.json();
        if (!questionRes.ok) throw new Error(questionData.error || 'Could not load GAD-7-style check');
        setConfig(questionData);
        refreshDraftMeta();
      } catch (err) {
        setError(err.message || 'Could not load GAD-7-style check');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAttempts, refreshDraftMeta]);

  const startAttempt = () => {
    if (draftMeta && !window.confirm('Start over and discard the paused GAD-7-style draft?')) return;
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
      'Saving your GAD-7-style anxiety check...',
      'We are scoring anxiety-domain patterns, then preparing the considered response. This can take a little while, so please stay on this screen until it finishes.'
    );
    try {
      const res = await api.post('/api/wellbeing/gad7/attempts', { answers: nextAnswers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save GAD-7-style attempt');
      setResult(data);
      setMode('result');
      clearDraft();
      setDraftMeta(null);
      await refreshAttempts();
      await onComplete?.();
    } catch (err) {
      setError(err.message || 'Could not save GAD-7-style attempt');
    } finally {
      stopProcessing();
      setSubmitting(false);
    }
  };

  const openAttempt = async (id) => {
    setError('');
    try {
      const res = await api.get(`/api/wellbeing/gad7/attempts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Attempt not found');
      setDetail(data);
      setMode('detail');
    } catch (err) {
      setError(err.message || 'Could not open attempt');
    }
  };

  const downloadPdf = async (attempt) => {
    if (!attempt?.id || pdfLoadingId) return;
    setPdfLoadingId(attempt.id);
    setError('');
    try {
      const res = await api.get(`/api/wellbeing/gad7/attempts/${attempt.id}/pdf`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Could not prepare PDF');
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gad-7-style-${attempt.id}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message || 'Could not prepare PDF');
    } finally {
      setPdfLoadingId(null);
    }
  };

  const deleteAttempt = async (id) => {
    if (!window.confirm('Delete this GAD-7-style anxiety check?')) return;
    try {
      const res = await api.delete(`/api/wellbeing/gad7/attempts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not delete attempt');
      await refreshAttempts();
      setDetail(null);
      setResult(null);
      setMode('intro');
      await onComplete?.();
    } catch (err) {
      setError(err.message || 'Could not delete attempt');
    }
  };

  const purposeBullets = [
    'Notice current anxiety-domain signals such as worry, restlessness, tension, irritability, and threat anticipation.',
    'Give the combined profile a clearer distinction between general mood load and anxiety/worry load.',
    'Answer according to the past two weeks; there are no right answers and honest current-state answers are most useful.',
    'Use the result as a reflective screener only, not as a diagnosis or treatment recommendation.',
  ];

  if (loading) {
    return <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}>Loading GAD-7-style anxiety check...</div>;
  }

  return (
    <div className="space-y-4 wellbeing-page">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={returnToTools} className="text-sm px-4 py-2 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}>
          Back to wellbeing tools
        </button>
        {mode !== 'taking' && (
          <button type="button" onClick={() => setShowPurpose((value) => !value)} className="text-sm px-4 py-2 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}>
            {showPurpose ? 'Hide purpose' : 'What this check is for'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border p-3 text-sm" style={{ borderColor: 'rgba(239,68,68,0.35)', background: 'rgba(239,68,68,0.08)', color: '#b91c1c' }}>
          {error}
        </div>
      )}

      {mode === 'intro' && (
        <div className="space-y-4">
          <QuizPurposePanel
            open={showPurpose}
            onToggle={() => setShowPurpose((value) => !value)}
            title="GAD-7-style anxiety check"
            summary="This short check gives the wellbeing profile a focused anxiety lens. It looks at worry, threat anticipation, physical tension, restlessness, irritability, and fear over the past two weeks."
            points={purposeBullets}
            guidance={[
              'Answer based on the past two weeks, not your whole life.',
              'Choose the closest frequency even if the pattern varies by situation.',
              'Treat the result as a prompt for reflection or discussion, not as a diagnosis.',
            ]}
            caveat="This is a proof-of-concept GAD-7-style tool using original wording. It is not the official GAD-7, not an anxiety diagnosis, and not a substitute for professional assessment."
          />

          <section className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--color-muted)' }}>GAD-7-style anxiety check</p>
            <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text)' }}>{config?.title || 'GAD-7-Style Anxiety Check'}</h1>
            <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>{config?.disclaimer}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startAttempt} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--color-primary)', color: 'white' }}>
                Start GAD-7-style check
              </button>
              {draftMeta && (
                <button type="button" onClick={resumeAttempt} className="px-4 py-2 rounded-lg text-sm font-medium border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                  Resume paused check ({draftMeta.answeredCount}/{questions.length})
                </button>
              )}
            </div>
          </section>

          {!!attempts.length && (
            <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Previous GAD-7-style checks</h2>
              <div className="space-y-2">
                {attempts.map((attempt) => (
                  <div key={attempt.id} className="flex items-center justify-between gap-3 rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                    <button type="button" onClick={() => openAttempt(attempt.id)} className="text-left flex-1">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{attempt.totalScore}/21 - {attempt.bandLabel}</p>
                      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{formatDate(attempt.createdAt)}</p>
                    </button>
                    <button type="button" onClick={() => deleteAttempt(attempt.id)} className="text-xs px-3 py-1.5 rounded-lg border" style={{ borderColor: 'rgba(239,68,68,0.35)', color: '#b91c1c' }}>
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {mode === 'taking' && current && (
        <section className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Question {index + 1} of {questions.length}</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>{progress}% complete</p>
            </div>
            <button type="button" onClick={pauseAttempt} className="text-sm px-3 py-1.5 rounded-lg border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
              Pause
            </button>
          </div>
          <div className="h-2 rounded-full overflow-hidden mb-5" style={{ background: 'var(--color-bg)' }}>
            <div className="h-full" style={{ width: `${progress}%`, background: 'var(--color-primary)' }} />
          </div>
          <h2 className="text-xl font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{current.prompt}</h2>
          <div className="grid gap-2">
            {current.options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSelectedValue(option.value)}
                className="text-left rounded-xl border p-3"
                style={{
                  borderColor: selectedValue === option.value ? 'var(--color-primary)' : 'var(--color-border)',
                  background: selectedValue === option.value ? 'rgba(37,99,235,0.08)' : 'var(--color-bg)',
                  color: 'var(--color-text)',
                }}
              >
                <span className="font-medium">{option.label}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center justify-between gap-3 mt-5">
            <button type="button" onClick={goBackOneQuestion} disabled={index <= 0} className="px-4 py-2 rounded-lg border text-sm disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
              Back
            </button>
            <button type="button" onClick={submitCurrent} disabled={selectedValue == null || submitting} className="px-4 py-2 rounded-lg text-sm font-medium disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'white' }}>
              {index + 1 === questions.length ? (submitting ? 'Saving...' : 'Finish check') : 'Next'}
            </button>
          </div>
        </section>
      )}

      {mode === 'result' && result && (
        <div className="space-y-4">
          <Gad7ResultPanel attempt={result} onDownloadPdf={downloadPdf} pdfLoading={pdfLoadingId === result.id} />
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={startAttempt} className="px-4 py-2 rounded-lg text-sm font-medium border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
              Retake GAD-7-style check
            </button>
            <button type="button" onClick={onNext} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: 'var(--color-primary)', color: 'white' }}>
              {nextLabel}
            </button>
          </div>
        </div>
      )}

      {mode === 'detail' && detail && (
        <div className="space-y-4">
          <Gad7ResultPanel attempt={detail} onDownloadPdf={downloadPdf} pdfLoading={pdfLoadingId === detail.id} />
          <button type="button" onClick={() => setMode('intro')} className="px-4 py-2 rounded-lg text-sm font-medium border" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
            Back to GAD-7-style history
          </button>
        </div>
      )}

    </div>
  );
}
