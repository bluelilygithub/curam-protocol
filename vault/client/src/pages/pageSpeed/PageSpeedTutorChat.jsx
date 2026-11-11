import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Page speed guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the wording
 * and endpoint. `onOpenTool(id)` opens the right screen or tab and scrolls to the part (see pageSpeedTools.mjs). It cannot see any
 * address, score or report: it only knows what each part of the page does.
 */

const CONFIG = {
  endpoint: '/api/page-speed-tutor',
  guideId: 'page-speed',
  payloadKey: 'currentTool',
  name: 'Page speed guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to check or fix',
  intro: 'Hi! Tell me what you want to do in your own words: test a page, understand a score or a term like LCP, work out what to fix first, or turn the report into a plan. I will show you which parts of Page speed to use and in what order. I cannot see your results.',
  starters: [
    'What should I fix first?',
    'Why is my mobile score lower than desktop?',
    'What does Largest Contentful Paint mean?',
    'How do I send this to my developer?',
    'How do I get an AI to plan the fixes?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Page speed yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Page speed', color: null },
  },
  buttonTip: 'Ask the Page speed guide. Tell it what you want to check, understand or fix, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your results.',
  openTip: (label) => `Show ${label} on this page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Page speed…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Page speed guide',
  errorText: 'The Page speed guide could not answer just now.',
  wideKey: 'vault:page-speed-guide:wide',
};

export default function PageSpeedTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
