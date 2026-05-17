import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import {
  CONFIDENCE_LEVELS,
  pickQuestions,
  markObjective,
  formatDuration,
  usesConfidence,
  formatBoolAnswer,
} from '../../utils/quizConstants';

export default function QuizTake() {
  const { quizId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const getIcon = useIcon();
  const qid = Number(quizId);
  const wrongOnly = searchParams.get('wrongOnly') === '1';

  const [quiz, setQuiz] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState([]);
  const [draft, setDraft] = useState('');
  const [confidence, setConfidence] = useState('Medium');
  const [flagged, setFlagged] = useState(false);
  const [load, setLoad] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [reveal, setReveal] = useState(null);
  const startRef = useRef(Date.now());
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const t = setInterval(() => setElapsed(Date.now() - startRef.current), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!qid) return;
    (async () => {
      setLoad(true);
      setError('');
      try {
        const res = await api.get(`/api/student-quizzes/${qid}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Quiz not found');
        setQuiz(data);
        let pool = data.questionPool || [];
        if (wrongOnly) {
          const raw = sessionStorage.getItem(`quiz-wrong-${qid}`);
          if (raw) {
            try {
              const ids = JSON.parse(raw);
              pool = pool.filter((q) => ids.includes(q.id));
            } catch { /* use full pool */ }
          }
        }
        const count = wrongOnly && pool.length ? pool.length : data.questionCount;
        const picked = pickQuestions(pool, count);
        if (!picked.length) throw new Error('No questions available');
        setQuestions(picked);
        startRef.current = Date.now();
      } catch (err) {
        setError(err.message);
      } finally {
        setLoad(false);
      }
    })();
  }, [qid, wrongOnly]);

  const current = questions[index];

  const advanceWithResult = useCallback(async (result) => {
    const nextAnswers = [...answers, result];
    setAnswers(nextAnswers);
    setDraft('');
    setConfidence('Medium');
    setFlagged(false);
    setReveal(null);

    if (index + 1 >= questions.length) {
      const correctCount = nextAnswers.filter((a) => a.correct).length;
      const scorePercent = Math.round((correctCount / nextAnswers.length) * 100);
      const passed = scorePercent >= (quiz.passmark || 80);
      const timeTakenMs = Date.now() - startRef.current;

      const saveRes = await api.post('/api/student-quizzes/attempts', {
        quizId: qid,
        scorePercent,
        timeTakenMs,
        passed,
        questionResults: nextAnswers,
      });
      const saved = await saveRes.json();
      if (!saveRes.ok) throw new Error(saved.error || 'Could not save attempt');
      sessionStorage.removeItem(`quiz-wrong-${qid}`);
      navigate(`/student/quiz/results/${saved.id}`);
    } else {
      setIndex((i) => i + 1);
    }
  }, [answers, index, questions.length, quiz, qid, navigate]);

  const continueAfterReveal = useCallback(async () => {
    if (!reveal) return;
    setSubmitting(true);
    try {
      await advanceWithResult(reveal);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }, [reveal, advanceWithResult]);

  const submitAnswer = useCallback(async () => {
    if (!current || submitting) return;
    setSubmitting(true);
    setError('');

    let correct = false;
    let score10 = null;
    let feedback = '';
    const studentAnswer = draft.trim();

    try {
      if (current.type === 'short_answer') {
        const res = await api.post('/api/student-quizzes/mark-short', {
          question: current.question,
          correct_answer: current.correct_answer,
          student_answer: studentAnswer,
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Marking failed');
        score10 = data.score;
        correct = data.correct;
        feedback = data.feedback;
      } else {
        if (current.type === 'true_false' && !studentAnswer) {
          setError('Select True or False');
          setSubmitting(false);
          return;
        }
        if (current.type === 'multiple_choice' && !studentAnswer) {
          setError('Select an answer');
          setSubmitting(false);
          return;
        }
        correct = markObjective(current, studentAnswer);
      }

      const result = {
        questionId: current.id,
        subtopic: current.subtopic,
        type: current.type,
        question: current.question,
        correct,
        studentAnswer,
        correctAnswer: current.correct_answer,
        explanation: current.explanation,
        confidence: usesConfidence(current.type) ? confidence : null,
        flagged,
        score10,
        feedback,
        options: current.options,
      };

      if (!correct) {
        setReveal(result);
        setSubmitting(false);
        return;
      }

      await advanceWithResult(result);
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }, [current, submitting, draft, confidence, flagged, advanceWithResult]);

  if (reveal) {
    return (
      <div className="p-4 sm:p-6 max-w-xl mx-auto space-y-4">
        <p className="text-sm font-medium" style={{ color: '#ef4444' }}>Incorrect</p>
        <p className="text-sm" style={{ color: 'var(--color-text)' }}>{reveal.question}</p>
        <div className="rounded-xl border p-3 text-sm space-y-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
          <p style={{ color: 'var(--color-muted)' }}>Your answer: {reveal.type === 'true_false' ? formatBoolAnswer(reveal.studentAnswer) : reveal.studentAnswer}</p>
          <p style={{ color: 'var(--color-text)' }}>Correct answer: {reveal.type === 'true_false' ? formatBoolAnswer(reveal.correctAnswer) : reveal.correctAnswer}</p>
          {reveal.type === 'short_answer' && reveal.feedback && (
            <p style={{ color: 'var(--color-muted)' }}>{reveal.feedback}</p>
          )}
          {reveal.explanation && <p style={{ color: 'var(--color-muted)' }}>{reveal.explanation}</p>}
        </div>
        <button
          type="button"
          onClick={continueAfterReveal}
          disabled={submitting}
          className="w-full py-3 rounded-xl text-sm font-medium text-white hover:opacity-80 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          Continue
        </button>
      </div>
    );
  }

  if (load) {
    return <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading quiz…</div>;
  }

  if (error && !questions.length) {
    return (
      <div className="p-6 max-w-md mx-auto text-center space-y-3">
        <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>
        <Link to="/student/quiz/library" className="text-sm hover:opacity-70" style={{ color: 'var(--color-primary)' }}>
          Back to library
        </Link>
      </div>
    );
  }

  if (!current) return null;

  const progress = `${index + 1} of ${questions.length}`;

  return (
    <div className="p-4 sm:p-6 max-w-xl mx-auto pb-24">
      <div className="flex items-center justify-between mb-4 text-xs" style={{ color: 'var(--color-muted)' }}>
        <Link to="/student/quiz/take" className="hover:opacity-70 transition-opacity">← Quizzes</Link>
        <span>{formatDuration(elapsed)}</span>
      </div>
      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-primary)' }}>
        Question {progress}
      </p>
      <h2 className="text-base font-medium mb-4" style={{ color: 'var(--color-text)' }}>{current.question}</h2>

      {current.type === 'true_false' && (
        <div className="flex gap-2 mb-4">
          {['True', 'False'].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => setDraft(label)}
              className="flex-1 py-3 rounded-xl border text-sm font-medium hover:opacity-70 transition-opacity"
              style={{
                borderColor: draft === label ? 'var(--color-primary)' : 'var(--color-border)',
                background: draft === label ? 'var(--color-bg)' : 'var(--color-surface)',
                color: 'var(--color-text)',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {current.type === 'multiple_choice' && (
        <ul className="space-y-2 mb-4">
          {(current.options || []).map((opt, i) => {
            const letter = String.fromCharCode(65 + i);
            const val = opt;
            const selected = draft === val;
            return (
              <li key={letter}>
                <button
                  type="button"
                  onClick={() => setDraft(val)}
                  className="w-full text-left px-3 py-2.5 rounded-xl border text-sm hover:opacity-70 transition-opacity"
                  style={{
                    borderColor: selected ? 'var(--color-primary)' : 'var(--color-border)',
                    background: selected ? 'var(--color-bg)' : 'var(--color-surface)',
                    color: 'var(--color-text)',
                  }}
                >
                  <span className="font-semibold mr-2" style={{ color: 'var(--color-muted)' }}>{letter}</span>
                  {opt}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {current.type === 'short_answer' && (
        <textarea
          rows={4}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Your answer…"
          className="w-full px-3 py-2 rounded-xl border text-sm outline-none mb-4 resize-y"
          style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-text)' }}
        />
      )}

      {usesConfidence(current.type) && (
      <div className="mb-4">
        <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>How confident are you?</p>
        <div className="flex gap-2 flex-wrap">
          {CONFIDENCE_LEVELS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setConfidence(c)}
              className="px-3 py-1.5 rounded-lg text-xs border hover:opacity-70 transition-opacity"
              style={{
                borderColor: confidence === c ? 'var(--color-primary)' : 'var(--color-border)',
                color: confidence === c ? 'var(--color-primary)' : 'var(--color-muted)',
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      )}

      <label className="flex items-center gap-2 text-xs mb-4 cursor-pointer" style={{ color: 'var(--color-muted)' }}>
        <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
        Flag this question for review
      </label>

      {error && <p className="text-sm mb-3" style={{ color: '#ef4444' }}>{error}</p>}

      <button
        type="button"
        onClick={submitAnswer}
        disabled={submitting}
        className="w-full py-3 rounded-xl text-sm font-medium text-white disabled:opacity-50 hover:opacity-80 transition-opacity"
        style={{ background: 'var(--color-primary)' }}
      >
        {submitting ? 'Submitting…' : index + 1 >= questions.length ? 'Finish quiz' : 'Next question'}
      </button>

      {submitting && current.type === 'short_answer' && (
        <p className="text-xs text-center mt-2" style={{ color: 'var(--color-muted)' }}>AI is marking your answer…</p>
      )}
    </div>
  );
}
