import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import { startGoalsTour, TOUR_KEY as GOALS_TOUR_KEY } from '../utils/tours/goalsTour';
import { startTasksTour, TOUR_KEY as TASKS_TOUR_KEY } from '../utils/tours/tasksTour';

export default function TourButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const getIcon = useIcon();

  const isGoals = location.pathname.startsWith('/goals');
  const isTasks = location.pathname.startsWith('/tasks');

  if (!isGoals && !isTasks) return null;

  const isDone = isGoals
    ? !!localStorage.getItem(GOALS_TOUR_KEY)
    : !!localStorage.getItem(TASKS_TOUR_KEY);

  if (isDone) return null;

  const handleClick = () => {
    if (isGoals) startGoalsTour(navigate);
    else startTasksTour(navigate);
  };

  const label = isGoals ? 'Goals Tour' : 'Tasks Tour';

  return (
    <button
      onClick={handleClick}
      title={label}
      style={{
        position: 'fixed',
        bottom: '88px',
        right: '24px',
        zIndex: 39,
        display: 'flex',
        alignItems: 'center',
        gap: 5,
        padding: '6px 12px',
        borderRadius: '20px',
        border: '1px solid var(--color-border)',
        background: 'var(--color-surface)',
        color: 'var(--color-muted)',
        fontSize: 12,
        fontWeight: 500,
        cursor: 'pointer',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
        transition: 'opacity 0.15s, border-color 0.15s',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-primary)';
        e.currentTarget.style.color = 'var(--color-primary)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--color-border)';
        e.currentTarget.style.color = 'var(--color-muted)';
      }}
    >
      {getIcon('map', { size: 13 })}
      Tour
    </button>
  );
}
