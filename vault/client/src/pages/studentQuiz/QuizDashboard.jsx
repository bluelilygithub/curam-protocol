import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/apiClient';
import { useIcon } from '../../providers/IconProvider';
import ScoreChart from '../../components/studentQuiz/ScoreChart';

function StatCard({ label, value }) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
    >
      <p className="text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--color-muted)' }}>{label}</p>
      <p className="text-2xl font-semibold tabular-nums" style={{ color: 'var(--color-text)' }}>{value}</p>
    </div>
  );
}

export default function QuizDashboard() {
  const getIcon = useIcon();
  const [data, setData] = useState(null);
  const [load, setLoad] = useState(true);
  const [quizzes, setQuizzes] = useState([]);

  const refresh = useCallback(async () => {
    setLoad(true);
    try {
      const [dashRes, listRes] = await Promise.all([
        api.get('/api/student-quizzes/dashboard'),
        api.get('/api/student-quizzes'),
      ]);
      const dash = await dashRes.json();
      const list = await listRes.json();
      if (dashRes.ok) setData(dash);
      if (listRes.ok) setQuizzes(Array.isArray(list) ? list : []);
    } catch {
      setData(null);
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  if (load) {
    return (
      <div className="p-6 text-sm" style={{ color: 'var(--color-muted)' }}>Loading dashboard…</div>
    );
  }

  if (!data && !quizzes.length) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center">
        <p className="text-sm mb-4" style={{ color: 'var(--color-muted)' }}>
          No quizzes yet. Create one in the Quiz Library to start tracking your progress.
        </p>
        <Link
          to="/student/quiz/library"
          className="inline-block px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-80 transition-opacity"
          style={{ background: 'var(--color-primary)' }}
        >
          Go to Quiz Library
        </Link>
      </div>
    );
  }

  const d = data || {};

  return (
    <div className="p-4 sm:p-6 max-w-3xl mx-auto space-y-6">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total quizzes" value={d.totalQuizzes ?? 0} />
        <StatCard label="Total attempts" value={d.totalAttempts ?? 0} />
        <StatCard label="Average score" value={d.overallAverage != null ? `${d.overallAverage}%` : '—'} />
        <StatCard label="Day streak" value={d.streak ?? 0} />
      </div>

      <section
        className="rounded-2xl border p-4"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Score history</h2>
        <ScoreChart points={d.scoreHistory || []} />
      </section>

      {d.categoryBreakdown?.length > 0 && (
        <section
          className="rounded-2xl border p-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>By category</h2>
          <ul className="space-y-2">
            {d.categoryBreakdown.map((c) => (
              <li key={c.category} className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text)' }}>{c.category}</span>
                <span style={{ color: 'var(--color-muted)' }}>{c.averageScore}% · {c.attempts} attempt{c.attempts !== 1 ? 's' : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.weakSpots?.length > 0 && (
        <section
          className="rounded-2xl border p-4"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
        >
          <h2 className="text-sm font-semibold mb-3" style={{ color: 'var(--color-text)' }}>Weak spots</h2>
          <p className="text-xs mb-2" style={{ color: 'var(--color-muted)' }}>Subtopics missed most often</p>
          <ul className="space-y-1.5">
            {d.weakSpots.map((w) => (
              <li key={w.subtopic} className="flex justify-between text-sm">
                <span style={{ color: 'var(--color-text)' }}>{w.subtopic}</span>
                <span style={{ color: '#ef4444' }}>{w.count}×</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text)' }}>Your quizzes</h2>
        {quizzes.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--color-muted)' }}>None yet.</p>
        ) : (
          <ul className="space-y-2">
            {quizzes.map((q) => (
              <li key={q.id}>
                <Link
                  to={`/student/quiz/take/${q.id}`}
                  className="flex items-center justify-between rounded-xl border px-3 py-2.5 hover:opacity-70 transition-opacity"
                  style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
                >
                  <span className="text-sm font-medium truncate" style={{ color: 'var(--color-text)' }}>{q.title}</span>
                  {getIcon('chevron-right', { size: 14, style: { color: 'var(--color-muted)', flexShrink: 0 } })}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
