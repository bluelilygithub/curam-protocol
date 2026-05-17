import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/apiClient';

export default function QuizTakePicker() {
  const [rows, setRows] = useState([]);
  const [load, setLoad] = useState(true);

  const refresh = useCallback(async () => {
    setLoad(true);
    try {
      const res = await api.get('/api/student-quizzes');
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
      <h1 className="text-lg font-semibold mb-1" style={{ color: 'var(--color-text)' }}>Take Quiz</h1>
      <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }}>Choose a quiz to start a new attempt.</p>
      {load ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          No quizzes yet.{' '}
          <Link to="/student/quiz/library" style={{ color: 'var(--color-primary)' }}>Create one</Link>
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((q) => (
            <li key={q.id}>
              <Link
                to={`/student/quiz/take/${q.id}`}
                className="block rounded-xl border px-4 py-3 hover:opacity-70 transition-opacity"
                style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
              >
                <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{q.title}</span>
                <span className="text-xs block mt-0.5" style={{ color: 'var(--color-muted)' }}>
                  {q.questionCount} questions · pool {q.poolSize}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
