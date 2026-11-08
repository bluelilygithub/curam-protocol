import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Plans guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Diagrams, Sketchbook,
 * Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the view that
 * holds the control (see plansTools.mjs). It cannot see any plan: it only knows what each view and control does.
 */

const CONFIG = {
  endpoint: '/api/plans-tutor',
  guideId: 'plans',
  payloadKey: 'currentTool',
  name: 'Plans guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to plan or do',
  intro: 'Hi! Tell me what you want to do with your plans, in your own words: start a plan, add steps, say how long each takes, make one step wait for another, check whether it finishes in time, or make a plan from a diagram. I will check what Plans can do and point you at the right controls, or tell you plainly if it cannot.',
  starters: [
    'Make step B start after step A',
    'Will my plan finish by the end date?',
    'Hold a step on a particular day',
    'Turn my diagram into a plan',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Plans yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Plans', color: null },
  },
  buttonTip: 'Ask the Plans guide. Tell it what you want to plan or do, by typing or talking, and it tells you which controls to use and in what order. It cannot see your plans.',
  openTip: (label) => `Show ${label} in Plans. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Plans…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Plans guide',
  errorText: 'The Plans guide could not answer just now.',
  wideKey: 'vault:plans-guide:wide',
};

export default function PlansTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
