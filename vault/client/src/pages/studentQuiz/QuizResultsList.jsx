import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/apiClient';
import { formatDuration } from '../../utils/quizConstants';

export default function QuizResultsList() {
  const [rows, setRows] = useState([]);
  const [load, setLoad] = useState(true);

  const refresh = useCallback(async () => {
    setLoad(true);
    try {
      const res = await api.get('/api/student-quizzes/attempts');
      const data = await res.json();
      setRows(Array.isArray(data) ? data : []);
    } catch {
      setRows([]);
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Results</h1>
      <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>Past quiz attempts</p>
      {load ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm py-8 text-center" style={{ color: 'var(--color-muted)' }}>
          No attempts yet. Complete a quiz to see results here.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((a) => (
            <li key={a.id}>
              <Link
                to={`/student/quiz/results/${a.id}`}
                className="block rounded-xl border px-4 py-3 hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <div className="flex justify-between items-start gap-2">
                  <div>
                    <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{a.quizTitle}</span>
                    <span className="text-xs block mt-0.5" style={{ color: 'var(--color-muted)' }}>
                      {new Date(a.createdAt).toLocaleString()} · {formatDuration(a.timeTakenMs)}
                    </span>
                  </div>
                  <span
                    className="text-sm font-semibold tabular-nums"
                    style={{ color: a.passed ? '#22c55e' : '#ef4444' }}
                  >
                    {a.scorePercent}%
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
