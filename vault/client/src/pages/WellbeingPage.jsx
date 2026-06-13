import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import IpipNeo120Panel from '../components/wellbeing/IpipNeo120Panel';
import CerqStylePanel from '../components/wellbeing/CerqStylePanel';
import BriefCopeStylePanel from '../components/wellbeing/BriefCopeStylePanel';
import ModelInsightPanel from '../components/wellbeing/ModelInsightPanel';
import CombinedProfilePanel from '../components/wellbeing/CombinedProfilePanel';
import { BdiSeverityGauge } from '../components/wellbeing/WellbeingCharts';
import WellbeingVisualSummaryPanel from '../components/wellbeing/WellbeingVisualSummaryPanel';

const MOOD_DRAFT_KEY = 'curam:wellbeing-mood:draft';
const IPIP_DRAFT_KEY = 'curam:ipip-neo-120:draft';
const CERQ_DRAFT_KEY = 'curam:cerq-style:draft';
const COPE_DRAFT_KEY = 'curam:brief-cope-style:draft';

function parseMaybeJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function readMoodDraft() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(window.localStorage.getItem(MOOD_DRAFT_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeMoodDraft(draft) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(MOOD_DRAFT_KEY, JSON.stringify(draft));
}

function clearMoodDraft() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(MOOD_DRAFT_KEY);
}

function clearAllWellbeingDrafts() {
  if (typeof window === 'undefined') return;
  [MOOD_DRAFT_KEY, IPIP_DRAFT_KEY, CERQ_DRAFT_KEY, COPE_DRAFT_KEY].forEach((key) => {
    window.localStorage.removeItem(key);
  });
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

function buildDisplayRationale(attempt, analysis, answers) {
  const totalScore = Number(attempt?.totalScore || 0);
  const bandLabel = attempt?.bandLabel || 'Unlabelled range';
  const drivers = Array.isArray(analysis?.rationale?.drivers) && analysis.rationale.drivers.length
    ? analysis.rationale.drivers
    : answers
      .filter((answer) => Number(answer.score) >= 2)
      .sort((a, b) => Number(b.score) - Number(a.score) || Number(a.questionId) - Number(b.questionId))
      .slice(0, 5)
      .map((answer) => ({
        questionId: answer.questionId,
        topic: answer.topic,
        prompt: answer.prompt,
        score: Number(answer.score),
        selectedOption: answer.optionText || answer.selectedOption,
        reflection: answer.reflection,
        reason: `${answer.topic} shaped the impression because it was answered at ${Number(answer.score)}/3: "${answer.optionText || answer.selectedOption || ''}".${answer.reflection ? ' Your reflection added extra context for this signal.' : ''}`,
      }));
  const elevatedCount = answers.filter((answer) => Number(answer.score) >= 2).length;

  return {
    scoring: analysis?.rationale?.scoring
      || `Each question is scored from 0 to 3, so the total score is the sum of the intensity selected across all 21 questions. This attempt scored ${totalScore}/63, in the "${bandLabel}" range.`,
    pattern: analysis?.rationale?.pattern
      || (drivers.length
        ? `The strongest impression came from ${elevatedCount} item${elevatedCount === 1 ? '' : 's'} scored 2 or 3, especially ${drivers.map((driver) => `${driver.topic} (${driver.score}/3)`).join(', ')}.`
        : 'No item was scored at 2 or 3, so the result is mainly a low overall pattern rather than one dominant concern.'),
    drivers,
  };
}

function ScorePill({ score, label }) {
  return (
    <div
      className="rounded-2xl border p-4 text-center"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>Score</p>
      <p className="text-4xl font-bold tabular-nums" style={{ color: 'var(--color-primary)' }}>{score}/63</p>
      <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>{label}</p>
    </div>
  );
}

function AnalysisPanel({ attempt, onDownloadPdf, pdfLoading }) {
  const analysis = parseMaybeJson(attempt?.analysis, {});
  const answers = parseMaybeJson(attempt?.answers, []);
  const rationale = buildDisplayRationale(attempt, analysis, answers);
  const safetyFlag = !!(attempt?.safetyFlag || analysis?.safetyFlag);

  return (
    <div className="space-y-4">
      <ScorePill score={attempt.totalScore} label={attempt.bandLabel} />
      <BdiSeverityGauge score={Number(attempt.totalScore || 0)} label={attempt.bandLabel} />

      {safetyFlag && (
        <div className="rounded-2xl border p-4 text-sm" style={{ borderColor: '#fecaca', background: '#fff1f2', color: '#991b1b' }}>
          <p className="font-semibold mb-1">Safety note</p>
          <p>
            You selected an option involving thoughts of death or self-harm. If there is any current risk, contact emergency services,
            local crisis support, or a trusted person now. This tool is not a crisis service.
          </p>
        </div>
      )}

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Analysis</h2>
          {onDownloadPdf && (
            <button
              type="button"
              onClick={() => onDownloadPdf(attempt)}
              disabled={pdfLoading}
              className="text-xs px-3 py-1.5 rounded-lg border hover:opacity-70 disabled:opacity-40"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
            >
              {pdfLoading ? 'Preparing PDF...' : 'Download PDF'}
            </button>
          )}
        </div>
        <p className="text-sm mb-3" style={{ color: 'var(--color-text)' }}>{analysis.summary}</p>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>{analysis.interpretation}</p>
      </section>

      <ModelInsightPanel insight={analysis.modelInsight} title="Considered response" />

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>How this impression was formed</h2>
        <div className="space-y-2 text-sm" style={{ color: 'var(--color-muted)' }}>
          <p>{rationale.scoring}</p>
          <p>{rationale.pattern}</p>
        </div>
        {rationale.drivers.length > 0 && (
          <div className="space-y-3 mt-4">
            {rationale.drivers.map((driver, idx) => (
              <div key={`${driver.questionId || idx}-${driver.topic}`} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{driver.topic}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{driver.prompt}</p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>{driver.score}/3</span>
                </div>
                <p className="text-xs mt-2" style={{ color: 'var(--color-text)' }}>{driver.reason || driver.selectedOption}</p>
                {driver.reflection && (
                  <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>Reflection: {driver.reflection}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {Array.isArray(analysis.nextSteps) && analysis.nextSteps.length > 0 && (
        <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Suggested next steps</h2>
          <ul className="space-y-2">
            {analysis.nextSteps.map((step, idx) => (
              <li key={idx} className="text-sm" style={{ color: 'var(--color-muted)' }}>{step}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Responses</h2>
        <div className="space-y-3">
          {answers.map((answer) => (
            <div key={answer.questionId} className="rounded-xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{answer.questionId}. {answer.topic}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>{answer.prompt}</p>
                </div>
                <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>{answer.score}</span>
              </div>
              <p className="text-xs mt-2" style={{ color: 'var(--color-text)' }}>{answer.optionText}</p>
              {answer.reflection && (
                <p className="text-xs mt-2 whitespace-pre-wrap" style={{ color: 'var(--color-muted)' }}>{answer.reflection}</p>
              )}
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

export default function WellbeingPage() {
  const location = useLocation();
  const getIcon = useIcon();
  const [tool, setTool] = useState('mood');
  const [config, setConfig] = useState(null);
  const [attempts, setAttempts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState('intro');
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [selectedScore, setSelectedScore] = useState(null);
  const [reflection, setReflection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [detail, setDetail] = useState(null);
  const [pdfLoadingId, setPdfLoadingId] = useState(null);
  const [moodDraftMeta, setMoodDraftMeta] = useState(null);
  const [profileStatus, setProfileStatus] = useState(null);

  const questions = config?.questions || [];
  const current = questions[index];
  const progress = questions.length ? Math.round(((index + 1) / questions.length) * 100) : 0;

  const refreshAttempts = useCallback(async () => {
    const res = await api.get('/api/wellbeing/attempts');
    const data = await res.json();
    setAttempts(Array.isArray(data) ? data : []);
  }, []);

  const refreshMoodDraftMeta = useCallback(() => {
    const draft = readMoodDraft();
    if (!draft || !Array.isArray(draft.answers)) {
      setMoodDraftMeta(null);
      return;
    }
    setMoodDraftMeta({
      updatedAt: draft.updatedAt,
      answeredCount: draft.answers.length + (draft.selectedScore != null ? 1 : 0),
    });
  }, []);

  const refreshProfileStatus = useCallback(async () => {
    try {
      const res = await api.get('/api/wellbeing/profile/status');
      const data = await res.json();
      if (res.ok) setProfileStatus(data);
    } catch {
      setProfileStatus(null);
    }
  }, []);

  const resetToDashboard = useCallback(() => {
    setTool('mood');
    setMode('intro');
    setIndex(0);
    setAnswers([]);
    setSelectedScore(null);
    setReflection('');
    setSubmitting(false);
    setResult(null);
    setDetail(null);
    setPdfLoadingId(null);
    setError('');
    refreshMoodDraftMeta();
    refreshProfileStatus();
  }, [refreshMoodDraftMeta, refreshProfileStatus]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [questionRes] = await Promise.all([
          api.get('/api/wellbeing/questions'),
          refreshAttempts(),
        ]);
        const questionData = await questionRes.json();
        if (!questionRes.ok) throw new Error(questionData.error || 'Could not load wellbeing check');
        setConfig(questionData);
        refreshMoodDraftMeta();
        refreshProfileStatus();
      } catch (err) {
        setError(err.message || 'Could not load wellbeing check');
      } finally {
        setLoading(false);
      }
    })();
  }, [refreshAttempts, refreshMoodDraftMeta, refreshProfileStatus]);

  useEffect(() => {
    if (tool === 'mood') refreshProfileStatus();
  }, [tool, refreshProfileStatus]);

  useEffect(() => {
    if (location.state?.dashboardNonce) {
      resetToDashboard();
    }
  }, [location.state?.dashboardNonce, resetToDashboard]);

  const startAttempt = () => {
    if (moodDraftMeta && !window.confirm('Start over and discard the paused mood check?')) return;
    clearMoodDraft();
    setMoodDraftMeta(null);
    setMode('taking');
    setIndex(0);
    setAnswers([]);
    setSelectedScore(null);
    setReflection('');
    setResult(null);
    setDetail(null);
    setError('');
  };

  const resumeMoodAttempt = () => {
    const draft = readMoodDraft();
    if (!draft || !Array.isArray(draft.answers) || !questions.length) {
      setMoodDraftMeta(null);
      return;
    }
    const safeAnswers = draft.answers
      .filter((answer) => Number.isFinite(Number(answer.questionId)) && Number.isFinite(Number(answer.score)))
      .slice(0, questions.length - 1);
    const safeIndex = Math.min(Math.max(Number(draft.index) || safeAnswers.length, 0), questions.length - 1);
    setAnswers(safeAnswers.slice(0, safeIndex));
    setIndex(safeIndex);
    setSelectedScore(draft.selectedScore == null ? null : Number(draft.selectedScore));
    setReflection(String(draft.reflection || ''));
    setResult(null);
    setDetail(null);
    setError('');
    setMode('taking');
  };

  const pauseMoodAttempt = () => {
    writeMoodDraft({
      version: config?.version,
      index,
      answers,
      selectedScore,
      reflection,
      updatedAt: new Date().toISOString(),
    });
    refreshMoodDraftMeta();
    setMode('intro');
  };

  const goBackMoodQuestion = () => {
    if (index <= 0) return;
    const previousAnswer = answers[index - 1];
    setAnswers((prev) => prev.slice(0, -1));
    setIndex((value) => value - 1);
    setSelectedScore(previousAnswer?.score ?? null);
    setReflection(previousAnswer?.reflection || '');
  };

  const resetDraft = () => {
    setSelectedScore(null);
    setReflection('');
  };

  const submitCurrent = async () => {
    if (!current || selectedScore == null || submitting) return;
    const nextAnswers = [
      ...answers,
      {
        questionId: current.id,
        score: selectedScore,
        reflection,
      },
    ];

    if (index + 1 < questions.length) {
      setAnswers(nextAnswers);
      setIndex((value) => value + 1);
      resetDraft();
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/api/wellbeing/attempts', { answers: nextAnswers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save attempt');
      setResult(data);
      setMode('result');
      clearMoodDraft();
      setMoodDraftMeta(null);
      await refreshAttempts();
    } catch (err) {
      setError(err.message || 'Could not save attempt');
    } finally {
      setSubmitting(false);
    }
  };

  const openAttempt = async (id) => {
    setError('');
    try {
      const res = await api.get(`/api/wellbeing/attempts/${id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Attempt not found');
      setDetail(data);
      setMode('detail');
    } catch (err) {
      setError(err.message || 'Could not open attempt');
    }
  };

  const deleteAttempt = async (id) => {
    if (!window.confirm('Delete this completed wellbeing check?')) return;
    await api.delete(`/api/wellbeing/attempts/${id}`).catch(() => {});
    if (detail?.id === id) {
      setDetail(null);
      setMode('intro');
    }
    await refreshAttempts();
  };

  const resetAllTests = async () => {
    const confirmed = window.confirm(
      'Erase all completed wellbeing, IPIP-NEO-120, CERQ-style, and COPE-style test results? This will also clear paused test drafts on this device.'
    );
    if (!confirmed) return;

    setError('');
    try {
      const res = await api.delete('/api/wellbeing/reset');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not erase test results');
      clearAllWellbeingDrafts();
      setMoodDraftMeta(null);
      setAttempts([]);
      setResult(null);
      setDetail(null);
      setMode('intro');
      setTool('mood');
      await Promise.all([refreshAttempts(), refreshProfileStatus()]);
    } catch (err) {
      setError(err.message || 'Could not erase test results');
    }
  };

  const downloadAttemptPdf = async (attempt) => {
    if (!attempt?.id || pdfLoadingId) return;
    setPdfLoadingId(attempt.id);
    setError('');
    try {
      const res = await api.get(`/api/wellbeing/attempts/${attempt.id}/pdf`);
      if (!res.ok) throw new Error('PDF generation failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wellbeing-check-${attempt.id}.pdf`;
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

  const latestScore = attempts[0]?.totalScore;
  const averageScore = useMemo(() => {
    if (!attempts.length) return null;
    return Math.round(attempts.reduce((sum, attempt) => sum + Number(attempt.totalScore || 0), 0) / attempts.length);
  }, [attempts]);

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading wellbeing check...</div>;
  }

  if (error && !config) {
    return <div className="p-6 text-sm" style={{ color: '#ef4444' }}>{error}</div>;
  }

  if (tool === 'personality') {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <IpipNeo120Panel onBack={() => setTool('mood')} />
      </div>
    );
  }

  if (tool === 'cognitive') {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <CerqStylePanel onBack={() => setTool('mood')} />
      </div>
    );
  }

  if (tool === 'cope') {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <BriefCopeStylePanel onBack={() => setTool('mood')} />
      </div>
    );
  }

  if (tool === 'combined') {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <CombinedProfilePanel onBack={() => setTool('mood')} />
      </div>
    );
  }

  if (tool === 'visuals' || tool === 'mindmap') {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <WellbeingVisualSummaryPanel onBack={() => setTool('mood')} initialView={tool === 'mindmap' ? 'mindmap' : 'charts'} />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={startAttempt}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
            style={{ background: 'var(--color-primary)' }}
          >
            {moodDraftMeta ? 'Start mood check over' : 'Start mood check'}
          </button>
          <button
            type="button"
            onClick={() => setTool('personality')}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            Open IPIP-NEO-120
          </button>
          <button
            type="button"
            onClick={() => setTool('cognitive')}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            Open CERQ-style check
          </button>
          <button
            type="button"
            onClick={() => setTool('cope')}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            Open COPE-style check
          </button>
          <button
            type="button"
            onClick={() => profileStatus?.available && setTool('combined')}
            disabled={!profileStatus?.available}
            className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 disabled:opacity-50 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
          >
            Combined profile
          </button>
          {profileStatus?.available && (
            <>
              <button
                type="button"
                onClick={() => setTool('visuals')}
                className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
              >
                Visual summary
              </button>
              <button
                type="button"
                onClick={() => setTool('mindmap')}
                className="px-4 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
              >
                Mind map
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>
      )}

      {mode === 'intro' && (
        <div className="grid lg:grid-cols-[1fr_360px] gap-6">
          <section className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div>
              <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Before you begin</h2>
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                This is a non-clinical proof of concept inspired by common wellbeing screening structures. It is not a diagnosis,
                medical advice, or a substitute for a qualified professional.
              </p>
            </div>
            <div className="rounded-xl border p-4" style={{ borderColor: '#fde68a', background: '#fffbeb', color: '#78350f' }}>
              <p className="text-sm font-semibold mb-1">Important safety note</p>
              <p className="text-sm">
                If you feel at immediate risk of harming yourself or someone else, contact emergency services or local crisis support now.
              </p>
            </div>
            <ul className="text-sm space-y-2" style={{ color: 'var(--color-muted)' }}>
              <li>Questions are answered in order.</li>
              <li>You can pause and resume later on this device.</li>
              <li>You can go back one question at a time to correct a mistaken selection.</li>
              <li>Incomplete attempts are discarded and not saved.</li>
              <li>Completed attempts can be reviewed or deleted later.</li>
            </ul>
          </section>

          <aside className="space-y-3">
            {moodDraftMeta && (
              <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Paused mood check</p>
                <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>
                  {Math.min(moodDraftMeta.answeredCount, questions.length)} of {questions.length} questions started
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Saved {formatDate(moodDraftMeta.updatedAt)}</p>
                <button
                  type="button"
                  onClick={resumeMoodAttempt}
                  className="w-full px-3 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity mt-3"
                  style={{ background: 'var(--color-primary)' }}
                >
                  Resume paused mood check
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setTool('personality')}
              className="w-full rounded-2xl border p-4 text-left hover:opacity-80 transition-opacity"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Second test</p>
              <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>IPIP-NEO-120 Personality Inventory</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>120 public-domain statements, five broad domains, and 30 facets.</p>
            </button>
            <button
              type="button"
              onClick={() => setTool('cognitive')}
              className="w-full rounded-2xl border p-4 text-left hover:opacity-80 transition-opacity"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Cognitive process</p>
              <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>CERQ-Style Cognitive Coping Check</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>36 original items across nine cognitive emotion-regulation strategy areas.</p>
            </button>
            <button
              type="button"
              onClick={() => setTool('cope')}
              className="w-full rounded-2xl border p-4 text-left hover:opacity-80 transition-opacity"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Coping style</p>
              <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>Brief COPE-Style Coping Check</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>28 original items across 14 coping strategy areas, with no overall total score.</p>
            </button>
            <button
              type="button"
              onClick={() => profileStatus?.available && setTool('combined')}
              disabled={!profileStatus?.available}
              className="w-full rounded-2xl border p-4 text-left hover:opacity-80 disabled:opacity-50 transition-opacity"
              style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
            >
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Fifth option</p>
              <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>Combined Profile</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                {profileStatus?.available
                  ? 'Unlocked: collate the latest result from all four tests into one detailed profile.'
                  : 'Locked until all four tests have been completed at least once.'}
              </p>
            </button>
            {profileStatus?.available && (
              <div className="grid sm:grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setTool('visuals')}
                  className="rounded-2xl border p-4 text-left hover:opacity-80 transition-opacity"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Visual option</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>Charts summary</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>See the latest four results as a gauge, radar, and strategy bars.</p>
                </button>
                <button
                  type="button"
                  onClick={() => setTool('mindmap')}
                  className="rounded-2xl border p-4 text-left hover:opacity-80 transition-opacity"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Pattern option</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>Mind map</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Connect related signals across mood, traits, thinking, and coping.</p>
                </button>
              </div>
            )}
            <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Completed checks</p>
              <p className="text-3xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{attempts.length}</p>
              {latestScore != null && (
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Latest score: {latestScore}/63</p>
              )}
              {averageScore != null && (
                <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Average score: {averageScore}/63</p>
              )}
            </div>
            <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: '#fecaca' }}>
              <p className="text-xs uppercase tracking-wider" style={{ color: '#991b1b' }}>Reset tests</p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                Erase all completed test results and clear paused drafts on this device.
              </p>
              <button
                type="button"
                onClick={resetAllTests}
                className="w-full px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mt-3"
                style={{ borderColor: '#fecaca', color: '#991b1b', background: '#fff1f2' }}
              >
                Reset / erase all tests
              </button>
            </div>
          </aside>
        </div>
      )}

      {mode === 'taking' && current && (
        <section className="max-w-2xl mx-auto space-y-4">
          <div className="sticky top-0 z-10 py-2" style={{ background: 'var(--color-bg)' }}>
            <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--color-muted)' }}>
              <span>Question {index + 1} of {questions.length}</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface)' }}>
              <div className="h-full transition-all" style={{ width: `${progress}%`, background: 'var(--color-primary)' }} />
            </div>
          </div>

          <div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>{current.topic}</p>
            <h2 className="text-lg font-semibold mb-4" style={{ color: 'var(--color-text)' }}>{current.prompt}</h2>
            <div className="space-y-2">
              {current.options.map((option) => (
                <button
                  key={option.score}
                  type="button"
                  onClick={() => setSelectedScore(option.score)}
                  className="w-full rounded-xl border px-4 py-3 text-left transition-opacity hover:opacity-80"
                  style={{
                    background: selectedScore === option.score ? 'var(--color-bg)' : 'transparent',
                    borderColor: selectedScore === option.score ? 'var(--color-primary)' : 'var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                >
                  <span className="text-xs font-semibold mr-2" style={{ color: 'var(--color-muted)' }}>{option.score}</span>
                  <span className="text-sm">{option.label}</span>
                </button>
              ))}
            </div>

            {current.key === 'suicidalThoughts' && selectedScore > 0 && (
              <div className="rounded-xl border p-3 mt-4 text-sm" style={{ borderColor: '#fecaca', background: '#fff1f2', color: '#991b1b' }}>
                If these thoughts feel current, intense, or unsafe, pause this tool and contact emergency services, crisis support, or a trusted person now.
              </div>
            )}

            <label className="block text-xs font-medium mt-5 mb-1" style={{ color: 'var(--color-muted)' }}>
              Optional reflection
            </label>
            <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>{current.reflectionPrompt}</p>
            <textarea
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 rounded-xl border text-sm outline-none resize-none"
              style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
              placeholder="Add any context you want included in the final analysis..."
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={pauseMoodAttempt}
                className="px-3 py-2 rounded-xl text-sm border hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
              >
                Pause
              </button>
              <button
                type="button"
                onClick={goBackMoodQuestion}
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
                  if (window.confirm('Cancel this mood check and discard the paused draft?')) {
                    clearMoodDraft();
                    setMoodDraftMeta(null);
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
                disabled={selectedScore == null || submitting}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50 hover:opacity-90 transition-opacity"
                style={{ background: 'var(--color-primary)' }}
              >
                {index + 1 >= questions.length ? (submitting ? 'Saving...' : 'Finish check') : 'Continue'}
              </button>
            </div>
          </div>
        </section>
      )}

      {mode === 'result' && result && (
        <section className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setMode('intro')} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
              Back to overview
            </button>
            <button type="button" onClick={startAttempt} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
              Retake
            </button>
          </div>
          <AnalysisPanel attempt={result} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === result.id} />
        </section>
      )}

      {mode === 'detail' && detail && (
        <section className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setMode('intro')} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
              Back to overview
            </button>
            <button type="button" onClick={() => deleteAttempt(detail.id)} className="text-sm hover:opacity-70" style={{ color: '#dc2626' }}>
              Delete
            </button>
          </div>
          <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>Completed {formatDate(detail.createdAt)}</p>
          <AnalysisPanel attempt={detail} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === detail.id} />
        </section>
      )}

      {mode === 'intro' && (
        <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-4 py-3 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Past completed checks</h2>
          </div>
          {attempts.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>No completed checks yet.</p>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--color-border)' }}>
              {attempts.map((attempt) => (
                <div
                  key={attempt.id}
                  className="flex items-center justify-between gap-3 px-4 py-3"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)' }}
                >
                  <button type="button" onClick={() => openAttempt(attempt.id)} className="flex-1 text-left hover:opacity-70 transition-opacity">
                    <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{attempt.totalScore}/63 · {attempt.bandLabel}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {formatDate(attempt.createdAt)}{attempt.safetyFlag ? ' · safety note' : ''}
                    </p>
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
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
