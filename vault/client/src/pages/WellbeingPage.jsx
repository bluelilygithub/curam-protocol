import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../utils/apiClient';
import { useIcon } from '../providers/IconProvider';
import useAuthStore from '../store/authStore';
import useProcessingStore from '../store/processingStore';
import IpipNeo120Panel from '../components/wellbeing/IpipNeo120Panel';
import Hexaco60Panel from '../components/wellbeing/Hexaco60Panel';
import PanasStylePanel from '../components/wellbeing/PanasStylePanel';
import Asrs5StylePanel from '../components/wellbeing/Asrs5StylePanel';
import CerqStylePanel from '../components/wellbeing/CerqStylePanel';
import BriefCopeStylePanel from '../components/wellbeing/BriefCopeStylePanel';
import ModelInsightPanel from '../components/wellbeing/ModelInsightPanel';
import CombinedProfilePanel from '../components/wellbeing/CombinedProfilePanel';
import { BdiSeverityGauge } from '../components/wellbeing/WellbeingCharts';
import WellbeingVisualSummaryPanel from '../components/wellbeing/WellbeingVisualSummaryPanel';
import QuizPurposePanel from '../components/wellbeing/QuizPurposePanel';
import ConfirmModal from '../components/ConfirmModal';

const MOOD_DRAFT_KEY = 'curam:wellbeing-mood:draft';
const PANAS_DRAFT_KEY = 'curam:panas-style:draft';
const ASRS5_DRAFT_KEY = 'curam:asrs-5-style:draft';
const IPIP_DRAFT_KEY = 'curam:ipip-neo-120:draft';
const HEXACO_DRAFT_KEY = 'curam:hexaco-60-style:draft';
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
  [MOOD_DRAFT_KEY, PANAS_DRAFT_KEY, ASRS5_DRAFT_KEY, IPIP_DRAFT_KEY, HEXACO_DRAFT_KEY, CERQ_DRAFT_KEY, COPE_DRAFT_KEY].forEach((key) => {
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

function CompletionProgress({ tests }) {
  const completedCount = tests.filter((test) => test.completed).length;
  const pct = tests.length ? Math.round((completedCount / tests.length) * 100) : 0;

  return (
    <section className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Seven-test progress</p>
          <h2 className="text-lg font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{completedCount} of {tests.length} checks complete</h2>
        </div>
        <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--color-primary)' }}>{pct}%</span>
      </div>
      <div className="h-3 rounded-full overflow-hidden" style={{ background: 'var(--color-bg)' }}>
        <div className="h-full transition-all" style={{ width: `${pct}%`, background: 'var(--color-primary)' }} />
      </div>
      <div className="grid sm:grid-cols-3 lg:grid-cols-7 gap-2 mt-4">
        {tests.map((test) => (
          <div key={test.key} className="rounded-xl border px-3 py-2" style={{ borderColor: test.completed ? '#bbf7d0' : 'var(--color-border)', background: test.completed ? '#f0fdf4' : 'var(--color-bg)' }}>
            <p className="text-xs font-semibold" style={{ color: test.completed ? '#15803d' : 'var(--color-muted)' }}>
              {test.completed ? 'Complete' : 'Needed'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text)' }}>{test.shortTitle}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function TestTile({ test }) {
  return (
    <div className="rounded-2xl border p-4 flex flex-col gap-4" style={{ background: 'var(--color-surface)', borderColor: test.completed ? '#bbf7d0' : 'var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Step {test.step}</p>
          <h3 className="text-base font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{test.title}</h3>
        </div>
        <span className="text-xs font-semibold px-2 py-1 rounded-full" style={{ color: test.completed ? '#15803d' : '#92400e', background: test.completed ? '#dcfce7' : '#fef3c7' }}>
          {test.completed ? 'Complete' : 'To do'}
        </span>
      </div>
      <p className="text-sm flex-1" style={{ color: 'var(--color-muted)' }}>{test.description}</p>
      {test.completedAt && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Latest: {formatDate(test.completedAt)}</p>
      )}
      <button
        type="button"
        onClick={test.onOpen}
        className="w-full px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
        style={{ borderColor: 'var(--color-border)', color: test.primary ? '#fff' : 'var(--color-primary)', background: test.primary ? 'var(--color-primary)' : 'var(--color-bg)' }}
      >
        {test.actionLabel}
      </button>
    </div>
  );
}

function ResultsTile({ available, onCombined, onCharts, onMindMap, onSuggestions }) {
  const accentBackground = available
    ? 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 10%, var(--color-surface)), var(--color-surface) 72%)'
    : 'linear-gradient(135deg, #fffbeb, var(--color-surface) 72%)';
  const accentBorder = available ? 'color-mix(in srgb, var(--color-primary) 45%, var(--color-border))' : '#fde68a';
  const actionButtonClass = 'px-3 py-2 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-[var(--color-primary)] bg-[var(--color-surface)] border-[var(--results-action-border)] hover:bg-[var(--color-primary)] hover:border-[var(--color-primary)] hover:text-white disabled:hover:bg-[var(--color-surface)] disabled:hover:border-[var(--results-action-border)] disabled:hover:text-[var(--color-primary)]';
  const actionButtonStyle = { '--results-action-border': accentBorder };

  return (
    <div className="rounded-2xl border p-4 shadow-sm" style={{ background: accentBackground, borderColor: accentBorder }}>
      <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: available ? 'var(--color-primary)' : '#92400e' }}>Overall results</p>
      <h3 className="text-base font-semibold mt-1" style={{ color: 'var(--color-text)' }}>Review the overall results</h3>
      <p className="text-sm mt-2" style={{ color: 'var(--color-muted)' }}>
        {available
          ? 'Unlocked. Review the combined profile, visual charts, seven-test mind map, or personal development suggestions.'
          : 'Locked until all seven checks have at least one completed result.'}
      </p>
      <div className="grid sm:grid-cols-4 gap-2 mt-4">
        <button type="button" onClick={onCombined} disabled={!available} className={actionButtonClass} style={actionButtonStyle}>
          Profile
        </button>
        <button type="button" onClick={onCharts} disabled={!available} className={actionButtonClass} style={actionButtonStyle}>
          Charts
        </button>
        <button type="button" onClick={onMindMap} disabled={!available} className={actionButtonClass} style={actionButtonStyle}>
          Mind map
        </button>
        <button type="button" onClick={onSuggestions} disabled={!available} className={actionButtonClass} style={actionButtonStyle}>
          Suggestions
        </button>
      </div>
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
  const navigate = useNavigate();
  const getIcon = useIcon();
  const { user } = useAuthStore();
  const isAdmin = !!user?.isAdmin;
  const { startProcessing, stopProcessing } = useProcessingStore();
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
  const [randomising, setRandomising] = useState(false);
  const [showMoodPurpose, setShowMoodPurpose] = useState(false);
  const [showRandomDataConfirm, setShowRandomDataConfirm] = useState(false);
  const [showResetTestsConfirm, setShowResetTestsConfirm] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteMode, setInviteMode] = useState('send');
  const [inviteForm, setInviteForm] = useState({ email: '', password: '' });
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteStatus, setInviteStatus] = useState(null);

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
    startProcessing(
      'Saving your mood check...',
      'We are scoring your answers and preparing the considered response. This can take a little while, so please stay on this screen until it finishes.'
    );
    try {
      const res = await api.post('/api/wellbeing/attempts', { answers: nextAnswers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save attempt');
      setResult(data);
      setMode('result');
      clearMoodDraft();
      setMoodDraftMeta(null);
      await Promise.all([refreshAttempts(), refreshProfileStatus()]);
    } catch (err) {
      setError(err.message || 'Could not save attempt');
    } finally {
      stopProcessing();
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
      setMode('history');
    }
    await refreshAttempts();
  };

  const resetAllTests = async () => {
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

  const prepopulateRandomTests = async () => {
    if (randomising) return;
    setRandomising(true);
    setError('');
    startProcessing(
      'Creating random wellbeing test data...',
      'Generating one completed demo attempt for each test. Please stay on this screen until the dashboard refreshes.'
    );
    try {
      const res = await api.post('/api/wellbeing/admin/random-attempts', {});
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not create random test data');
      clearAllWellbeingDrafts();
      setMoodDraftMeta(null);
      await Promise.all([refreshAttempts(), refreshProfileStatus()]);
      setMode('intro');
    } catch (err) {
      setError(err.message || 'Could not create random test data');
    } finally {
      stopProcessing();
      setRandomising(false);
    }
  };

  const openInviteTemplateSettings = () => {
    localStorage.setItem('settingsTab', 'Wellbeing Invites');
    navigate('/settings');
  };

  const openInviteModal = (mode = 'send') => {
    setInviteMode(mode);
    setInviteStatus(null);
    setShowInviteModal(true);
  };

  const sendWellbeingInvite = async (e) => {
    e.preventDefault();
    if (inviteSending) return;
    setInviteSending(true);
    setInviteStatus(null);
    try {
      const res = await api.post('/api/wellbeing/admin/invite', inviteForm);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not send invite');
      setInviteStatus({
        ok: true,
        message: `Invite sent to ${data.email}. ${data.created ? 'A participant account was created.' : 'The existing participant password was updated.'}`,
      });
      setInviteForm({ email: '', password: '' });
    } catch (err) {
      setInviteStatus({ ok: false, message: err.message || 'Could not send invite' });
    } finally {
      setInviteSending(false);
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
  const statusByKey = useMemo(() => Object.fromEntries((profileStatus?.tests || []).map((test) => [test.key, test])), [profileStatus]);
  const dashboardTests = [
    {
      key: 'mood',
      step: 1,
      shortTitle: 'Mood',
      title: 'BDI-Style Mood Check',
      description: 'A 21-question mood and wellbeing screen with optional reflections and a downloadable report.',
      completed: !!statusByKey.mood?.completed,
      completedAt: statusByKey.mood?.completedAt,
      actionLabel: moodDraftMeta ? 'Resume paused check' : (statusByKey.mood?.completed ? 'Review or retake mood check' : 'Start mood check'),
      onOpen: moodDraftMeta ? resumeMoodAttempt : (statusByKey.mood?.completed ? () => setMode('moodReview') : startAttempt),
      primary: !statusByKey.mood?.completed,
    },
    {
      key: 'panas',
      step: 2,
      shortTitle: 'Affect',
      title: 'PANAS-Style Affect Check',
      description: 'A short affect snapshot showing current positive affect, negative affect, and emotional balance.',
      completed: !!statusByKey.panas?.completed,
      completedAt: statusByKey.panas?.completedAt,
      actionLabel: statusByKey.panas?.completed ? 'Review or retake PANAS' : 'Start PANAS-style check',
      onOpen: () => setTool('panas'),
      primary: !statusByKey.panas?.completed,
    },
    {
      key: 'asrs5',
      step: 3,
      shortTitle: 'Attention',
      title: 'ASRS-5-Style Attention Check',
      description: 'A short adult attention and self-regulation screener covering focus, activation, impulsivity, planning, and structure.',
      completed: !!statusByKey.asrs5?.completed,
      completedAt: statusByKey.asrs5?.completedAt,
      actionLabel: statusByKey.asrs5?.completed ? 'Review or retake ASRS-5' : 'Start ASRS-5-style check',
      onOpen: () => setTool('asrs5'),
      primary: !statusByKey.asrs5?.completed,
    },
    {
      key: 'ipip',
      step: 4,
      shortTitle: 'Personality',
      title: 'IPIP-NEO-120 Personality Inventory',
      description: 'A five-domain personality profile covering Neuroticism, Extraversion, Openness, Agreeableness, and Conscientiousness.',
      completed: !!statusByKey.ipip?.completed,
      completedAt: statusByKey.ipip?.completedAt,
      actionLabel: statusByKey.ipip?.completed ? 'Review or retake IPIP' : 'Start IPIP-NEO-120',
      onOpen: () => setTool('personality'),
      primary: !statusByKey.ipip?.completed,
    },
    {
      key: 'hexaco',
      step: 5,
      shortTitle: 'HEXACO',
      title: 'HEXACO-60-Style Personality Check',
      description: 'A six-domain personality profile adding Honesty-Humility, Emotionality, and interpersonal style to the combined view.',
      completed: !!statusByKey.hexaco?.completed,
      completedAt: statusByKey.hexaco?.completedAt,
      actionLabel: statusByKey.hexaco?.completed ? 'Review or retake HEXACO' : 'Start HEXACO-60-style check',
      onOpen: () => setTool('hexaco'),
      primary: !statusByKey.hexaco?.completed,
    },
    {
      key: 'cerq',
      step: 6,
      shortTitle: 'Cognition',
      title: 'CERQ-Style Cognitive Coping Check',
      description: 'A cognitive emotion-regulation check showing which thinking strategies are most and least used.',
      completed: !!statusByKey.cerq?.completed,
      completedAt: statusByKey.cerq?.completedAt,
      actionLabel: statusByKey.cerq?.completed ? 'Review or retake CERQ' : 'Start CERQ-style check',
      onOpen: () => setTool('cognitive'),
      primary: !statusByKey.cerq?.completed,
    },
    {
      key: 'cope',
      step: 7,
      shortTitle: 'Coping',
      title: 'Brief COPE-Style Coping Check',
      description: 'A coping response profile across active, support-seeking, avoidant, meaning-focused, and emotion-focused strategies.',
      completed: !!statusByKey.cope?.completed,
      completedAt: statusByKey.cope?.completedAt,
      actionLabel: statusByKey.cope?.completed ? 'Review or retake COPE' : 'Start COPE-style check',
      onOpen: () => setTool('cope'),
      primary: !statusByKey.cope?.completed,
    },
  ];
  const dashboardBack = useCallback(() => {
    setTool('mood');
    setMode('intro');
    refreshProfileStatus();
  }, [refreshProfileStatus]);

  if (loading) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading wellbeing check...</div>;
  }

  if (error && !config) {
    return <div className="p-6 text-sm" style={{ color: '#ef4444' }}>{error}</div>;
  }

  if (tool === 'panas') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <PanasStylePanel
          onBack={dashboardBack}
          onComplete={refreshProfileStatus}
          onNext={() => setTool('asrs5')}
          nextLabel="Continue to ASRS-5-style check"
        />
      </div>
    );
  }

  if (tool === 'asrs5') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <Asrs5StylePanel
          onBack={dashboardBack}
          onComplete={refreshProfileStatus}
          onNext={() => setTool('personality')}
          nextLabel="Continue to IPIP-NEO-120"
        />
      </div>
    );
  }

  if (tool === 'personality') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <IpipNeo120Panel
          onBack={dashboardBack}
          onComplete={refreshProfileStatus}
          onNext={() => setTool('hexaco')}
          nextLabel="Continue to HEXACO-60-style check"
        />
      </div>
    );
  }

  if (tool === 'hexaco') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <Hexaco60Panel
          onBack={dashboardBack}
          onComplete={refreshProfileStatus}
          onNext={() => setTool('cognitive')}
          nextLabel="Continue to CERQ-style check"
        />
      </div>
    );
  }

  if (tool === 'cognitive') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <CerqStylePanel
          onBack={dashboardBack}
          onComplete={refreshProfileStatus}
          onNext={() => setTool('cope')}
          nextLabel="Continue to COPE-style check"
        />
      </div>
    );
  }

  if (tool === 'cope') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <BriefCopeStylePanel
          onBack={dashboardBack}
          onComplete={refreshProfileStatus}
          onNext={() => setTool('combined')}
          nextLabel="See combined profile"
        />
      </div>
    );
  }

  if (tool === 'combined' || tool === 'suggestions') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <CombinedProfilePanel
          onBack={dashboardBack}
          initialVariant={tool === 'suggestions' ? 'suggestions' : 'detailed'}
          autoGenerate={tool === 'suggestions'}
        />
      </div>
    );
  }

  if (tool === 'visuals' || tool === 'mindmap') {
    return (
      <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            {getIcon('heart-pulse', { size: 20 })}
            Wellbeing & Personality Checks
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
            Proof-of-concept self-report tools only. Not professional advice or a substitute for a qualified professional.
          </p>
        </div>
        <WellbeingVisualSummaryPanel onBack={dashboardBack} initialView={tool === 'mindmap' ? 'mindmap' : 'charts'} />
      </div>
    );
  }

  return (
    <div className="wellbeing-page p-4 sm:p-6 max-w-5xl mx-auto space-y-6 pb-16">
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
      </div>

      {error && (
        <div className="rounded-xl px-3 py-2 text-sm" style={{ color: '#991b1b', background: '#fee2e2' }}>{error}</div>
      )}

      {mode === 'intro' && (
        <div className="space-y-6">
          <CompletionProgress tests={dashboardTests} />

          <section className="grid md:grid-cols-2 xl:grid-cols-4 gap-4">
            {dashboardTests.map((test) => <TestTile key={test.key} test={test} />)}
          </section>

          <div className="grid lg:grid-cols-[1fr_360px] gap-6">
            <div className="space-y-4">
              <ResultsTile
                available={!!profileStatus?.available}
                onCombined={() => profileStatus?.available && setTool('combined')}
                onCharts={() => profileStatus?.available && setTool('visuals')}
                onMindMap={() => profileStatus?.available && setTool('mindmap')}
                onSuggestions={() => profileStatus?.available && setTool('suggestions')}
              />
              <section className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <div>
                  <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>How to use this dashboard</h2>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                    Complete the seven checks in order or revisit any tile at any time. After each check, you can continue to the next one or come back here to see what remains.
                  </p>
                </div>
                <div className="rounded-xl border p-4" style={{ borderColor: '#fde68a', background: '#fffbeb', color: '#78350f' }}>
                  <p className="text-sm font-semibold mb-1">Important safety note</p>
                  <p className="text-sm">
                    If you feel at immediate risk of harming yourself or someone else, contact emergency services or local crisis support now.
                  </p>
                </div>
              </section>
            </div>

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
                onClick={() => setMode('history')}
                className="w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg hover:bg-[var(--color-bg)]"
                style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
              >
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Mood check history</p>
                <p className="text-3xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{attempts.length}</p>
                {latestScore != null && (
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Latest score: {latestScore}/63</p>
                )}
                {averageScore != null && (
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Average score: {averageScore}/63</p>
                )}
                <p className="text-xs font-semibold mt-3" style={{ color: 'var(--color-primary)' }}>
                  {attempts.length ? 'Click to review completed checks' : 'No completed checks yet'}
                </p>
              </button>
              {isAdmin && (
                <>
                  <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                    <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Invite participant</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      Create or update a participant login and email them a direct link to the wellbeing checks.
                    </p>
                    <button
                      type="button"
                      onClick={() => openInviteModal('send')}
                      className="w-full px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mt-3"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-bg)' }}
                    >
                      Invite participant
                    </button>
                    <button
                      type="button"
                      onClick={() => openInviteModal('resend')}
                      className="w-full px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mt-2"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-bg)' }}
                    >
                      Resend invite
                    </button>
                    <button
                      type="button"
                      onClick={openInviteTemplateSettings}
                      className="w-full px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mt-2"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)', background: 'var(--color-surface)' }}
                    >
                      Edit invite email template
                    </button>
                  </div>
                  <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                    <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Admin test data</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                      Create one random completed result for each test to check the progress, profile, charts, and mind-map flow.
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowRandomDataConfirm(true)}
                      disabled={randomising}
                      className="w-full px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 disabled:opacity-50 transition-opacity mt-3"
                      style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-bg)' }}
                    >
                      {randomising ? 'Creating demo results...' : 'Pre-populate random test results'}
                    </button>
                  </div>
                </>
              )}
              <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: '#fecaca' }}>
                <p className="text-xs uppercase tracking-wider" style={{ color: '#991b1b' }}>Reset tests</p>
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  Erase all completed test results and clear paused drafts on this device.
                </p>
                <button
                  type="button"
                  onClick={() => setShowResetTestsConfirm(true)}
                  className="w-full px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mt-3"
                  style={{ borderColor: '#fecaca', color: '#991b1b', background: '#fff1f2' }}
                >
                  Reset / erase all tests
                </button>
              </div>
            </aside>
          </div>
        </div>
      )}

      {mode === 'moodReview' && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <button
                type="button"
                onClick={() => setMode('intro')}
                className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity mb-3"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
              >
                Back to wellbeing tools
              </button>
              <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>BDI-Style Mood Check</h2>
              <p className="text-sm mt-1 max-w-3xl" style={{ color: 'var(--color-muted)' }}>
                Review your latest mood check, browse previous checks, or retake the 21-question screen.
              </p>
            </div>
            <button
              type="button"
              onClick={startAttempt}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ background: 'var(--color-primary)' }}
            >
              Retake mood check
            </button>
          </div>

          <div className="grid lg:grid-cols-[1fr_360px] gap-6">
            <div className="space-y-4">
              <QuizPurposePanel
                open={showMoodPurpose}
                onToggle={() => setShowMoodPurpose((value) => !value)}
                title="BDI-style mood check"
                summary="This check is a structured reflection on mood-related symptoms over the recent period. It helps turn a broad feeling like 'I have not been myself' into a clearer pattern across sleep, energy, pleasure, self-criticism, concentration, and related areas."
                points={[
                  'It estimates overall mood-symptom load from 21 item scores.',
                  'It highlights the areas contributing most strongly to the current impression.',
                  'It helps compare repeated checks over time, especially when one area changes before the total score changes.',
                ]}
                guidance={[
                  'Answer according to what has been most true recently, not what is true on your best or worst day.',
                  'Use the optional reflection box when context would help explain an answer.',
                  'If a question feels uncomfortable, choose the closest honest option and use the safety/support guidance if needed.',
                ]}
                caveat="This is a proof-of-concept self-report tool. It is not the official BDI, not a diagnosis, and not a substitute for professional advice or crisis support."
              />

              <section className="rounded-2xl border p-5 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <div>
                  <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Review or retake</h3>
                  <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                    This view behaves like the other completed test tiles: you can retake the check, review the latest result, or open the history list for earlier attempts.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={startAttempt}
                    className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
                    style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}
                  >
                    Retake
                  </button>
                  {attempts[0] && (
                    <button
                      type="button"
                      onClick={() => openAttempt(attempts[0].id)}
                      className="px-3 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
                      style={{ background: 'var(--color-primary)' }}
                    >
                      Review latest result
                    </button>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
                <div className="px-4 py-3 border-b" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Past completed mood checks</h3>
                </div>
                {attempts.length === 0 ? (
                  <p className="text-sm text-center py-8" style={{ color: 'var(--color-muted)' }}>No completed mood checks yet.</p>
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
            </div>

            <aside className="space-y-3">
              <div className="rounded-2xl border p-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
                <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Completed checks</p>
                <p className="text-3xl font-bold mt-1" style={{ color: 'var(--color-text)' }}>{attempts.length}</p>
                {latestScore != null && (
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Latest score: {latestScore}/63</p>
                )}
              </div>
              {attempts[0] && (
                <button
                  type="button"
                  onClick={() => openAttempt(attempts[0].id)}
                  className="w-full rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg hover:bg-[var(--color-bg)]"
                  style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
                >
                  <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>Latest mood check</p>
                  <p className="text-sm font-semibold mt-1" style={{ color: 'var(--color-text)' }}>{attempts[0].totalScore}/63 · {attempts[0].bandLabel}</p>
                  <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>Open full result</p>
                </button>
              )}
            </aside>
          </div>
        </div>
      )}

      {mode === 'taking' && current && (
        <section className="max-w-2xl mx-auto space-y-4">
          <QuizPurposePanel
            open={showMoodPurpose}
            onToggle={() => setShowMoodPurpose((value) => !value)}
            title="BDI-style mood check"
            summary="This check is a structured reflection on mood-related symptoms over the recent period. It helps turn a broad feeling like 'I have not been myself' into a clearer pattern across sleep, energy, pleasure, self-criticism, concentration, and related areas."
            points={[
              'It estimates overall mood-symptom load from 21 item scores.',
              'It highlights the areas contributing most strongly to the current impression.',
              'It helps compare repeated checks over time, especially when one area changes before the total score changes.',
            ]}
            guidance={[
              'Answer according to what has been most true recently, not what is true on your best or worst day.',
              'Use the optional reflection box when context would help explain an answer.',
              'If a question feels uncomfortable, choose the closest honest option and use the safety/support guidance if needed.',
            ]}
            caveat="This is a proof-of-concept self-report tool. It is not the official BDI, not a diagnosis, and not a substitute for professional advice or crisis support."
          />
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <button type="button" onClick={dashboardBack} className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}>
              Back to test dashboard
            </button>
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={startAttempt} className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity" style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)' }}>
                Retake
              </button>
              <button type="button" onClick={() => setTool('panas')} className="px-3 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity" style={{ background: 'var(--color-primary)' }}>
                Continue to PANAS-style check
              </button>
            </div>
          </div>
          <AnalysisPanel attempt={result} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === result.id} />
        </section>
      )}

      {mode === 'detail' && detail && (
        <section className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between gap-3">
            <button type="button" onClick={() => setMode('history')} className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
              Back to history
            </button>
            <button type="button" onClick={() => deleteAttempt(detail.id)} className="text-sm hover:opacity-70" style={{ color: '#dc2626' }}>
              Delete
            </button>
          </div>
          <p className="text-xs text-center" style={{ color: 'var(--color-muted)' }}>Completed {formatDate(detail.createdAt)}</p>
          <AnalysisPanel attempt={detail} onDownloadPdf={downloadAttemptPdf} pdfLoading={pdfLoadingId === detail.id} />
        </section>
      )}

      {mode === 'history' && (
        <section className="rounded-2xl border overflow-hidden" style={{ borderColor: 'var(--color-border)' }}>
          <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-3" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div>
              <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Mood Check History</h2>
              <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>Open any completed check to review its full analysis, chart, responses, and PDF option.</p>
            </div>
            <button
              type="button"
              onClick={() => setMode('intro')}
              className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
              style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-bg)' }}
            >
              Back to dashboard
            </button>
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

      {showRandomDataConfirm && (
        <ConfirmModal
          title="Create admin test data?"
          message="This will create one random completed result for each of the seven wellbeing tests. These are demo results only, not real self-report results, and they can be removed later with Reset / erase all tests."
          confirmLabel="Create demo results"
          onConfirm={() => {
            setShowRandomDataConfirm(false);
            prepopulateRandomTests();
          }}
          onCancel={() => setShowRandomDataConfirm(false)}
        />
      )}

      {showInviteModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.55)' }}
          onClick={(e) => { if (e.target === e.currentTarget && !inviteSending) setShowInviteModal(false); }}
        >
          <div className="w-full max-w-lg rounded-2xl border p-6 space-y-4" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                  {inviteMode === 'resend' ? 'Resend participant invite' : 'Invite participant'}
                </h2>
                <p className="text-sm mt-1" style={{ color: 'var(--color-muted)' }}>
                  {inviteMode === 'resend'
                    ? 'Send the wellbeing invite email again. Because passwords are not stored in plain text, the password entered here will become the participant password.'
                    : 'Create a login and send the wellbeing invite email using the current admin template.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowInviteModal(false)}
                disabled={inviteSending}
                className="text-sm hover:opacity-70 disabled:opacity-40"
                style={{ color: 'var(--color-muted)' }}
              >
                Close
              </button>
            </div>

            <form onSubmit={sendWellbeingInvite} className="space-y-3">
              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Participant email</span>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, email: e.target.value }))}
                  placeholder="person@example.com"
                  className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
              </label>

              <label className="block">
                <span className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--color-muted)' }}>Temporary password</span>
                <input
                  type="text"
                  required
                  minLength={8}
                  value={inviteForm.password}
                  onChange={(e) => setInviteForm((prev) => ({ ...prev, password: e.target.value }))}
                  placeholder="Create a password for this participant"
                  className="w-full px-3 py-2 rounded-xl border text-sm outline-none"
                  style={{ background: 'var(--color-bg)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
                />
                <p className="text-xs mt-1" style={{ color: 'var(--color-muted)' }}>
                  {inviteMode === 'resend'
                    ? 'Minimum 8 characters. Resending will update the participant password to this value and include it in the email.'
                    : 'Minimum 8 characters. This password is included in the invite email.'}
                </p>
              </label>

              {inviteStatus && (
                <div className="rounded-xl px-3 py-2 text-sm" style={{ color: inviteStatus.ok ? '#166534' : '#991b1b', background: inviteStatus.ok ? '#dcfce7' : '#fee2e2' }}>
                  {inviteStatus.message}
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={openInviteTemplateSettings}
                  className="px-3 py-2 rounded-xl text-sm font-semibold border hover:opacity-80 transition-opacity"
                  style={{ borderColor: 'var(--color-border)', color: 'var(--color-primary)', background: 'var(--color-surface)' }}
                >
                  Review template
                </button>
                <button
                  type="submit"
                  disabled={inviteSending}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
                  style={{ background: 'var(--color-primary)' }}
                >
                  {inviteSending ? 'Sending...' : (inviteMode === 'resend' ? 'Resend invite' : 'Send invite')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetTestsConfirm && (
        <ConfirmModal
          title="Reset wellbeing tests?"
          message="This will erase all completed wellbeing, PANAS-style, ASRS-5-style, IPIP-NEO-120, HEXACO-60-style, CERQ-style, and COPE-style test results for this user. It will also clear paused test drafts on this device."
          confirmLabel="Reset / erase tests"
          danger
          onConfirm={() => {
            setShowResetTestsConfirm(false);
            resetAllTests();
          }}
          onCancel={() => setShowResetTestsConfirm(false)}
        />
      )}
    </div>
  );
}
