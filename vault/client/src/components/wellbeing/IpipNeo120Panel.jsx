import React, { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../utils/apiClient';
import ModelInsightPanel from './ModelInsightPanel';
import { DomainRadarChart } from './WellbeingCharts';

const IPIP_DRAFT_KEY = 'curam:ipip-neo-120:draft';

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function readDraft() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.localStorage.getItem(IPIP_DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeDraft(draft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(IPIP_DRAFT_KEY, JSON.stringify(draft));
}

function clearDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(IPIP_DRAFT_KEY);
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

function DomainCard({ domain }) {
  const pct = Math.round(Number(domain.normalized || 0) * 100);
  return (
    <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{domain.label}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{domain.description}</p>
        </div>
        <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>{domain.score}/{domain.max}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden mt-3" style={{ background: 'var(--color-bg)' }}>
        <div className="h-full" style={{ width: `${pct}%`, background: 'var(--color-primary)' }} />
      </div>
      <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>{domain.band} relative endorsement</p>
    </div>
  );
}

function IpipResultPanel({ attempt, onDownloadPdf, pdfLoading }) {
  const domainScores = parseMaybeJson(attempt?.domainScores, []);
  const facetScores = parseMaybeJson(attempt?.facetScores, []);
  const analysis = parseMaybeJson(attempt?.analysis, {});
  const strongestFacets = analysis?.rationale?.strongestFacets || [...facetScores]
    .sort((a, b) => Math.abs(Number(b.normalized || 0) - 0.5) - Math.abs(Number(a.normalized || 0) - 0.5))
    .slice(0, 6);

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>IPIP-NEO-120 profile</h2>
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
        <p className="text-sm mb-2" style={{ color: 'var(--color-text)' }}>{analysis.summary}</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{analysis.interpretation}</p>
      </section>

      <ModelInsightPanel insight={analysis.modelInsight} title="Considered response" />

      <DomainRadarChart domains={domainScores} />

      <div className="grid md:grid-cols-2 gap-3">
        {domainScores.map((domain) => (
          <DomainCard key={domain.key} domain={domain} />
        ))}
      </div>

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>How this profile was formed</h2>
        <div className="space-y-2 text-sm" style={{ color: 'var(--color-muted)' }}>
          <p>{analysis?.rationale?.scoring}</p>
          <p>{analysis?.rationale?.pattern}</p>
        </div>
      </section>

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Strongest facet signals</h2>
        <div className="grid sm:grid-cols-2 gap-3">
          {strongestFacets.map((facet) => (
            <div key={facet.code} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{facet.code} {facet.label}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{facet.domainLabel}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>{facet.score}/{facet.max}</span>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>{facet.band}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
        <div className="px-4 py-3 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>All facets</h2>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-0">
          {facetScores.map((facet) => (
            <div key={facet.code} className="p-3 border-b sm:border-r" style={{ borderColor: 'var(--color-border)' }}>
              <p className="text-xs font-medium" style={{ color: 'var(--color-text)' }}>{facet.code} {facet.label}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{facet.score}/{facet.max} - {facet.band}</p>
            </div>
          ))}
        </div>
      </section>

      {analysis.disclaimer && (
        <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>{analysis.disclaimer}</p>
      )}
    </div>
  );
}

export default function IpipNeo120Panel({ onBack, onComplete, onNext, nextLabel = 'Continue' }) {
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
    const res = await api.get('/api/wellbeing/ipip/attempts');
    const data = await res.json();
    setAttempts(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [questionRes] = await Promise.all([
          api.get('/api/wellbeing/ipip/questions'),
          refreshAttempts(),
        ]);
        const questionData = await questionRes.json();
        if (!questionRes.ok) throw new Error(questionData.error || 'Could not load IPIP-NEO-120');
        setConfig(questionData);
        refreshDraftMeta();
      } catch (err) {
        setError(err.message || 'Could not load IPIP-NEO-120');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAttempts, refreshDraftMeta]);

  const startAttempt = () => {
    if (draftMeta && !window.confirm('Start over and discard the paused IPIP-NEO-120 draft?')) return;
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
      .filter((answer) => Number.isFinite(Number(answer.itemId)) && Number.isFinite(Number(answer.value)))
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
    const nextAnswers = [...answers, { itemId: current.id, value: selectedValue }];

    if (index + 1 < questions.length) {
      setAnswers(nextAnswers);
      setIndex((value) => value + 1);
      setSelectedValue(null);
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/api/wellbeing/ipip/attempts', { answers: nextAnswers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save IPIP-NEO-120 attempt');
      setResult(data);
      setMode('result');
      clearDraft();
      setDraftMeta(null);
      await refreshAttempts();
      await onComplete?.();
    } catch (err) {
      setError(err.message || 'Could not save IPIP-NEO-120 attempt');
    } finally {
      setSubmitting(false);
    }
  };

  const openAttempt = async (id) => {
    setError('');
    try {
      const res = await api.get(`/api/wellbeing/ipip/attempts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Attempt not found');
      setDetail(data);
      setMode('detail');
    } catch (err) {
      setError(err.message || 'Could not open attempt');
    }
  };

  const deleteAttempt = async (id) => {
    if (!window.confirm('Delete this completed IPIP-NEO-120 profile?')) return;
    await api.delete(`/api/wellbeing/ipip/attempts/${id}`).catch(() => {});
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
      const res = await api.get(`/api/wellbeing/ipip/attempts/${attempt.id}/pdf`);
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ipip-neo-120-${attempt.id}.pdf`;
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

  const latestDomains = useMemo(() => {
    if (!attempts[0]) return [];
    return parseMaybeJson(attempts[0].domainScores, []);
  }, [attempts]);

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading IPIP-NEO-120...</div>;
  }

  if (error && !config) {
    return <div className="p-6 text-sm" style={{ color: '#ef4444' }}>{error}</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button
            type="button"
            onClick={returnToTools}
            className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mb-3"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            Back to wellbeing tools
          </button>
          <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>IPIP-NEO-120 Personality Inventory</h2>
          <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
            A 120-item public-domain personality self-report covering five broad domains and 30 facets. This proof of concept is not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <button
          type="button"
          onClick={startAttempt}
          className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          {draftMeta ? 'Start over' : 'Start IPIP-NEO-120'}
        </button>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>
      )}

      {mode === 'intro' && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <section className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Before you begin</h3>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                Answer each statement based on how accurately it describes you in general. Scores are self-report trait estimates, not diagnoses, capability judgements, or clinical conclusions.
              </p>
            </div>
            <ul className="text-sm space-y-2" style={{ color: 'var(--color-muted)' }}>
              <li>120 statements are answered in order.</li>
              <li>Responses use a five-point accuracy scale.</li>
              <li>You can pause the profile and resume it later on this device.</li>
              <li>You can go back one statement at a time to correct a mistaken selection.</li>
              <li>Negatively keyed statements are reverse-scored automatically.</li>
              <li>Completed attempts can be reviewed, deleted, or downloaded as PDF.</li>
            </ul>
          </section>

          <aside className="space-y-3">
            {draftMeta && (
              <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Paused profile</p>
                <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>
                  {Math.min(draftMeta.answeredCount, questions.length)} of {questions.length} statements started
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Saved {formatDate(draftMeta.updatedAt)}</p>
                <button
                  type="button"
                  onClick={resumeAttempt}
                  className="w-full px-3 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity mt-3"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Resume paused profile
                </button>
              </div>
            )}
            <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Completed profiles</p>
              <p className="text-3xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{attempts.length}</p>
              {latestDomains.length > 0 && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Latest highest: {[...latestDomains].sort((a, b) => Number(b.normalized) - Number(a.normalized))[0]?.label}
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
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>
              {current.domainLabel} - {current.facetLabel}
            </p>
            <h3 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{current.statement}</h3>
            <div className="space-y-2">
              {current.options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedValue(option.value)}
                  className="w-full rounded-xl border px-4 py-3 text-left transition-opacity hover:opacity-80"
                  style={{
                    background: selectedValue === option.value ? 'var(--color-bg)' : 'transparent',
                    borderColor: selectedValue === option.value ? 'var(--color-primary)' : 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <span className="text-xs font-semibold mr-2" style={{ color: 'var(--color-muted)' }}>{option.value}</span>
                  <span className="text-sm">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={pauseAttempt}
                className="px-3 py-2 rounded-xl text-sm border hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Pause
              </button>
              <button
                type="button"
                onClick={goBackOneQuestion}
                disabled={index === 0}
                className="px-3 py-2 rounded-xl text-sm border hover:opacity-70 disabled:opacity-40 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Back
              </button>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Cancel this IPIP-NEO-120 attempt and discard the paused draft?')) {
                    clearDraft();
                    setDraftMeta(null);
                    setMode('intro');
                  }
                }}
                className="px-3 py-2 rounded-xl text-sm border hover:opacity-70 transition-opacity"
                style={{ borderColor: '#fecaca', color: '#991b1b' }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submitCurrent}
                disabled={selectedValue == null || submitting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                {index + 1 >= questions.length ? (submitting ? 'Saving...' : 'Finish profile') : 'Continue'}
              </button>
            </div>
          </div>
        </section>
      )}

      {mode === 'result' && result && (
        <section className="max-w-4xl mx-auto space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={onBack} className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}>
              Back to test dashboard
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startAttempt} className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                Retake
              </button>
              {onNext && (
                <button type="button" onClick={onNext} className="px-3 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: 'var(--color-primary)' }}>
                  {nextLabel}
                </button>
              )}
            </div>
          </div>
          <IpipResultPanel attempt={result} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === result.id} />
        </section>
      )}

      {mode === 'detail' && detail && (
        <section className="max-w-4xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setMode('intro')} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
              Back to IPIP overview
            </button>
            <button type="button" onClick={() => deleteAttempt(detail.id)} className="text-sm hover:opacity-70" style={{ color: '#dc2626' }}>
              Delete
            </button>
          </div>
          <IpipResultPanel attempt={detail} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === detail.id} />
        </section>
      )}

      {mode === 'intro' && (
        <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-4 py-3 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Past completed IPIP profiles</h3>
          </div>
          {attempts.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>No completed IPIP profiles yet.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {attempts.map((attempt) => {
                const domains = parseMaybeJson(attempt.domainScores, []);
                const highest = [...domains].sort((a, b) => Number(b.normalized) - Number(a.normalized))[0];
                return (
                  <div key={attempt.id} className="flex items-center justify-between gap-3 px-4 py-3" style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}>
                    <button type="button" onClick={() => openAttempt(attempt.id)} className="flex-1 text-left hover:opacity-70 transition-opacity">
                      <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{highest ? `${highest.label} - ${highest.band}` : 'IPIP-NEO-120 profile'}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{formatDate(attempt.createdAt)}</p>
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteAttempt(attempt.id)}
                      className="text-xs px-2 py-1 rounded-lg border hover:opacity-70"
                      style={{ borderColor: '#fecaca', color: '#991b1b' }}
                    >
                      Delete
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
