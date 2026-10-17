import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Cellar Planner guide for staff. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF,
 * Graphics, Video Tools and Finance); this file only supplies the wording and endpoint. `onOpenTool(id)` asks the planner (the app
 * inside the page's frame) to open a screen. It cannot see the design: it only knows what each screen does and which one is open.
 * The public website tool has its own guide (planner-core guide widget), not this one.
 */

const CONFIG = {
  endpoint: '/api/cellar-tutor',
  guideId: 'cellar',
  payloadKey: 'currentTool',
  name: 'Cellar Planner guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do in the planner',
  intro: 'Hi! Tell me what you want to do in the Cellar Planner, in your own words. I will check the screens we have and give you the steps in order. If something is missing, or the job is outside the planner, I will say so. I cannot see your design.',
  starters: [
    'Make a quote for a customer',
    'Why does the bottle count say not set?',
    'Check whether the conditioner is big enough',
    'Open a customer\'s enquiry design',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in the planner yet', color: '#f59e0b' },
    beyond: { label: 'Beyond the planner', color: null },
  },
  buttonTip: 'Ask the Cellar Planner guide. Tell it what you want to do, by typing or talking, and it tells you which screens to use and in what order. It cannot see your design.',
  openTip: (label) => `Open ${label} in the planner. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the screens…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Cellar Planner guide',
  errorText: 'The Cellar Planner guide could not answer just now.',
  wideKey: 'vault:cellar-guide:wide',
};

export default function CellarTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
