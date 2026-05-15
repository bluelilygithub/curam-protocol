import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useIcon } from '../../providers/IconProvider';

export default function StudentTile() {
  const navigate = useNavigate();
  const getIcon = useIcon();

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
      <div
        className="flex items-center gap-2 px-4 py-3 border-b"
        style={{ borderColor: 'var(--color-border)' }}
      >
        {getIcon('graduation-cap', { size: 16, style: { color: 'var(--color-text)' } })}
        <span className="font-semibold text-sm" style={{ color: 'var(--color-text)' }}>Student</span>
      </div>

      <div className="px-4 py-3 space-y-2">
        <button
          type="button"
          onClick={() => navigate('/student/quiz')}
          className="w-full flex items-center justify-between text-left text-sm px-3 py-2.5 rounded-xl border hover:opacity-70 transition-opacity"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <span>Quiz</span>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Coming soon</span>
        </button>
        <button
          type="button"
          onClick={() => navigate('/student/cards')}
          className="w-full flex items-center justify-between text-left text-sm px-3 py-2.5 rounded-xl border hover:opacity-70 transition-opacity"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text)' }}
        >
          <span>Cards</span>
          <span className="text-xs" style={{ color: 'var(--color-muted)' }}>Coming soon</span>
        </button>
      </div>
    </div>
  );
}
