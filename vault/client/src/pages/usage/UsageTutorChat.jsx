import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Usage & Cost guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics,
 * Video Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` shows the tab and
 * scrolls to the part (see usageTools.mjs). It cannot see any spending: it only knows what each part of the page does.
 */

const CONFIG = {
  endpoint: '/api/usage-tutor',
  guideId: 'usage',
  payloadKey: 'currentTool',
  name: 'Usage & Cost guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to understand',
  intro: 'Hi! Tell me what you want to know about your AI spending, in your own words: where the money is going, which model a feature uses, or how to spend less. I will check what this page can do and give you the steps. If something is missing, I will say so. I cannot see your numbers.',
  starters: [
    'Where is most of my money going?',
    'How do I spend less on AI?',
    'What does the Advice tab do?',
    'What is a token?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Usage & Cost yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Usage & Cost', color: null },
  },
  buttonTip: 'Ask the Usage & Cost guide. Tell it what you want to understand about your spending, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your numbers.',
  openTip: (label) => `Show ${label} on this page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Usage & Cost…',
  placeholder: 'Type or tap the mic: what do you want to know? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Usage & Cost guide',
  errorText: 'The Usage & Cost guide could not answer just now.',
  wideKey: 'vault:usage-guide:wide',
};

export default function UsageTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
