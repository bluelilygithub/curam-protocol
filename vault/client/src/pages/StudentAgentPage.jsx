import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';

export default function StudentAgentPage() {
  const location = useLocation();
  const getIcon = useIcon();
  const tab = location.pathname.includes('/student/cards') ? 'cards' : 'quiz';
  const title = tab === 'cards' ? 'Cards' : 'Quiz';

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div
        className="flex-shrink-0 px-4 h-12 flex items-center gap-2 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span className="text-sm font-medium flex-shrink-0" style={{ color: 'var(--color-text)' }}>
          Student
        </span>
        <span style={{ color: 'var(--color-border)' }} className="flex-shrink-0">/</span>
        <div className="flex items-center gap-1">
          <Link
            to="/student/quiz"
            className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
            style={{
              borderColor: tab === 'quiz' ? 'var(--color-primary)' : 'var(--color-border)',
              color: tab === 'quiz' ? 'var(--color-primary)' : 'var(--color-muted)',
              fontWeight: tab === 'quiz' ? 600 : 400,
            }}
          >
            Quiz
          </Link>
          <Link
            to="/student/cards"
            className="text-xs px-2 py-1 rounded-lg border transition-opacity hover:opacity-70"
            style={{
              borderColor: tab === 'cards' ? 'var(--color-primary)' : 'var(--color-border)',
              color: tab === 'cards' ? 'var(--color-primary)' : 'var(--color-muted)',
              fontWeight: tab === 'cards' ? 600 : 400,
            }}
          >
            Cards
          </Link>
        </div>
      </div>

      <div
        className="flex-1 flex flex-col items-center justify-center px-6 py-12 min-h-0"
        style={{ background: 'var(--color-bg)' }}
      >
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center mb-4"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          {getIcon('graduation-cap', { size: 22, style: { color: 'var(--color-primary)' } })}
        </div>
        <p className="text-base font-medium mb-1" style={{ color: 'var(--color-text)' }}>
          {title}
        </p>
        <p className="text-sm text-center max-w-xs" style={{ color: 'var(--color-muted)' }}>
          Coming soon
        </p>
      </div>
    </div>
  );
}
