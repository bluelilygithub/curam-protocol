import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import api from '../../utils/apiClient';
import { formatDuration } from '../../utils/quizConstants';

function confidenceStats(results) {
  const buckets = { High: { ok: 0, total: 0 }, Medium: { ok: 0, total: 0 }, Low: { ok: 0, total: 0 } };
  results.forEach((r) => {
    const c = r.confidence || 'Medium';
    if (!buckets[c]) buckets[c] = { ok: 0, total: 0 };
    buckets[c].total += 1;
    if (r.correct) buckets[c].ok += 1;
  });
  return buckets;
}

function QuestionRow({ r, showCorrect }) {
  return (
    <li
      className="rounded-xl border p-3 text-sm space-y-2"
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <p style={{ color: 'var(--color-text)' }}>{r.question}</p>
        <span className="text-xs shrink-0" style={{ color: r.correct ? '#22c55e' : '#ef4444' }}>
          {r.correct ? 'Correct' : 'Incorrect'}
        </span>
      </div>
      {r.subtopic && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Subtopic: {r.subtopic}</p>
      )}
      {!r.correct && (
        <>
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
            Your answer: <span style={{ color: 'var(--color-text)' }}>{r.studentAnswer || '—'}</span>
          </p>
          {showCorrect && (
            <p className="text-xs" style={{ color: 'var(--color-text)' }}>
              Correct: {r.correctAnswer}
            </p>
          )}
          {r.explanation && (
            <p className="text-xs" style={{ color: 'var(--color-muted)' }}>{r.explanation}</p>
          )}
        </>
      )}
      {r.type === 'short_answer' && (
        <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
          Score: {r.score10 != null ? `${r.score10}/10` : '—'}
          {r.feedback ? ` — ${r.feedback}` : ''}
        </p>
      )}
      {r.flagged && (
        <p className="text-xs" style={{ color: '#f59e0b' }}>Flagged for review</p>
      )}
      <p className="text-xs" style={{ color: 'var(--color-muted)' }}>Confidence: {r.confidence}</p>
    </li>
  );
}

export default function QuizResults() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState(null);
  const [load, setLoad] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      setLoad(true);
      try {
        const res = await api.get(`/api/student-quizzes/attempts/${attemptId}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Not found');
        setAttempt(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoad(false);
      }
    })();
  }, [attemptId]);

  const results = attempt?.questionResults || [];
  const correct = results.filter((r) => r.correct);
  const incorrect = results.filter((r) => !r.correct);
  const conf = useMemo(() => confidenceStats(results), [results]);

  const retakeWrong = useCallback(() => {
    const wrongIds = incorrect.map((r) => r.questionId);
    sessionStorage.setItem(`quiz-wrong-${attempt.quizId}`, JSON.stringify(wrongIds));
    navigate(`/student/quiz/take/${attempt.quizId}?wrongOnly=1`);
  }, [incorrect, attempt, navigate]);

  if (load) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading results…</div>;
  }

  if (error || !attempt) {
    return (
      <div className="p-6 text-center">
        <p className="text-sm" style={{ color: '#ef4444' }}>{error || 'Not found'}</p>
        <Link to="/student/quiz/results" className="text-sm mt-2 inline-block" style={{ color: 'var(--color-primary)' }}>All results</Link>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto space-y-6 pb-12">
      <div
        className="rounded-2xl border p-5 text-center"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <p className="text-xs uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>{attempt.title}</p>
        <p className="text-4xl font-bold tabular-nums" style={{ color: attempt.passed ? '#22c55e' : '#ef4444' }}>
          {attempt.scorePercent}%
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-text)' }}>
          {attempt.passed ? 'Passed' : 'Did not pass'} · need {attempt.passmark}%
        </p>
        <p className="text-xs mt-2" style={{ color: 'var(--color-muted)' }}>
          Time: {formatDuration(attempt.timeTakenMs)}
        </p>
      </div>

      <section
        className="rounded-2xl border p-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Confidence accuracy</h2>
        <ul className="space-y-1 text-xs" style={{ color: 'var(--color-muted)' }}>
          {['High', 'Medium', 'Low'].map((level) => {
            const b = conf[level];
            const pct = b.total ? Math.round((b.ok / b.total) * 100) : null;
            return (
              <li key={level}>
                {level}: {b.total ? `${pct}% correct (${b.ok}/${b.total})` : '—'}
              </li>
            );
          })}
        </ul>
      </section>

      <div className="flex flex-wrap gap-2">
        <Link
          to={`/student/quiz/take/${attempt.quizId}`}
          className="px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-80 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          Retake quiz
        </Link>
        {incorrect.length > 0 && (
          <button
            type="button"
            onClick={retakeWrong}
            className="px-4 py-2 rounded-lg text-sm font-medium border hover:opacity-70 transition-opacity"
            style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
          >
            Retake wrong answers only
          </button>
        )}
      </div>

      {correct.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#22c55e' }}>Correct ({correct.length})</h2>
          <ul className="space-y-2">
            {correct.map((r) => (
              <QuestionRow key={r.questionId} r={r} showCorrect={false} />
            ))}
          </ul>
        </section>
      )}

      {incorrect.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold mb-2" style={{ color: '#ef4444' }}>Incorrect ({incorrect.length})</h2>
          <ul className="space-y-2">
            {incorrect.map((r) => (
              <QuestionRow key={r.questionId} r={r} showCorrect />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
