import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The DocCompare guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the wording and
 * endpoint. `onOpenTool(id)` asks DocCompare (the app inside the page's frame) to show a part of the page (ids in docCompareTools.mjs).
 * It cannot see the files or the results: they never leave the person's browser.
 */

const CONFIG = {
  endpoint: '/api/doc-compare-tutor',
  guideId: 'doc-compare',
  payloadKey: 'currentTool',
  name: 'DocCompare guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to check',
  intro: 'Hi! Tell me what you want to check about an AI-edited document, in your own words. I will point you to the right parts of DocCompare, in order. If it cannot do something, I will say so. I cannot see your files or the results.',
  starters: [
    'Did the AI leave anything out of my document?',
    'Why does it say my files may not be the same document?',
    'How do I see only the serious changes?',
    'Can I compare a Word file with a PDF?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in DocCompare yet', color: '#f59e0b' },
    beyond: { label: 'Beyond DocCompare', color: null },
  },
  buttonTip: 'Ask the DocCompare guide. Tell it what you want to check, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your files.',
  openTip: (label) => `Show ${label} in DocCompare. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking DocCompare…',
  placeholder: 'Type or tap the mic: what do you want to check? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the DocCompare guide',
  errorText: 'The DocCompare guide could not answer just now.',
  wideKey: 'vault:doc-compare-guide:wide',
};

export default function DocCompareTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
