import React from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useIcon } from '../providers/IconProvider';
import { startGoalsTour, TOUR_KEY as GOALS_TOUR_KEY } from '../utils/tours/goalsTour';
import { startTasksTour, TOUR_KEY as TASKS_TOUR_KEY } from '../utils/tours/tasksTour';
import { startChainsTour, TOUR_KEY as CHAINS_TOUR_KEY } from '../utils/tours/chainsTour';
import { startRagTour, TOUR_KEY as RAG_TOUR_KEY } from '../utils/tours/ragTour';
import { startIntegrationsTour, TOUR_KEY as INTEGRATIONS_TOUR_KEY } from '../utils/tours/integrationsTour';
import { startGettingStartedTour, TOUR_KEY as GETTING_STARTED_TOUR_KEY } from '../utils/tours/gettingStartedTour';

export default function TourButton() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const getIcon = useIcon();

  const isGoals = location.pathname.startsWith('/goals');
  const isTasks = location.pathname.startsWith('/tasks');
  const isChains = location.pathname.startsWith('/chains');
  const isProject = /^\/projects\/\d+$/.test(location.pathname);
  const isSettings = location.pathname === '/settings';

  if (!isGoals && !isTasks && !isChains && !isProject && !isSettings) return null;

  // On /goals: Getting Started tour takes priority while pending, then Goals tour
  const isGettingStartedPending = isGoals && !localStorage.getItem(GETTING_STARTED_TOUR_KEY);

  let tourKey;
  if (isGettingStartedPending) tourKey = GETTING_STARTED_TOUR_KEY;
  else if (isGoals) tourKey = GOALS_TOUR_KEY;
  else if (isTasks) tourKey = TASKS_TOUR_KEY;
  else if (isChains) tourKey = CHAINS_TOUR_KEY;
  else if (isProject) tourKey = RAG_TOUR_KEY;
  else if (isSettings) tourKey = INTEGRATIONS_TOUR_KEY;

  if (localStorage.getItem(tourKey)) return null;

  const handleClick = () => {
    if (isGettingStartedPending) startGettingStartedTour(navigate);
    else if (isGoals) startGoalsTour(navigate);
    else if (isTasks) startTasksTour(navigate);
    else if (isChains) startChainsTour(navigate);
    else if (isProject) startRagTour(navigate, params.id);
    else if (isSettings) startIntegrationsTour(navigate);
  };

  let label;
  if (isGettingStartedPending) label = 'Getting Started Tour';
  else if (isGoals) label = 'Goals Tour';
  else if (isTasks) label = 'Tasks Tour';
  else if (isChains) label = 'Chains Tour';
  else if (isProject) label = 'Project Tour';
  else if (isSettings) label = 'Integrations Tour';

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
      {getIcon('compass', { size: 13 })}
      Tour
    </button>
  );
}
