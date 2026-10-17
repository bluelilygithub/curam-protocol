import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Finance guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by Video Tools); this file
 * only supplies Finance's wording and endpoint. It cannot see your books, never gives tax advice (tax, GST and "how should this be
 * treated" questions are sent to your accountant), and only points at tabs. The Finance page has no microphone provider of its
 * own, so this wrapper supplies one.
 */

const CONFIG = {
  endpoint: '/api/finance-tutor',
  guideId: 'finance',
  payloadKey: 'currentTab',
  name: 'Finance guide',
  shortName: 'guide',
  subtitle: 'Where to do things, and how Finance works',
  intro: 'Ask me where to do something in Finance, or how part of it works. I cannot see your figures, and I do not give tax advice: for anything about tax, GST or how something should be treated, I will tell you to ask your accountant.',
  starters: [
    'Where do I record money I put into the business myself?',
    'I took money out for myself. Is that a wage or a drawing?',
    'Why can I not edit an invoice?',
    'How do I give my accountant everything for the year?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Finance does not do this yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Finance', color: null },
    accountant: { label: 'A question for your accountant', color: '#2563eb' },
  },
  buttonTip: 'Ask the Finance guide where to do something, or how part of Finance works. It cannot see your books and does not give tax advice.',
  openTip: (label) => `Open the ${label} tab. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Finance…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Finance guide',
  errorText: 'The Finance guide could not answer just now.',
  wideKey: 'vault:finance-guide:wide',
};

export default function FinanceTutorChat({ currentTab, onOpenTab }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTab} onOpen={onOpenTab} />
    </VoiceInputProvider>
  );
}
