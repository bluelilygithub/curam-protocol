import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The AI Visibility guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only
 * supplies the wording and endpoint. `onOpenTool(id)` opens the right screen or scrolls to the part (see
 * aiVisibilityTools.mjs). It cannot see any address, score or report: it only knows what each part of the page does.
 */

const CONFIG = {
  endpoint: '/api/ai-visibility-tutor',
  guideId: 'ai-visibility',
  payloadKey: 'currentTool',
  name: 'AI Visibility guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to check or improve',
  intro: 'Hi! Tell me what you want to do in your own words: audit a page, understand a score or a word like robots.txt, work out what to fix first, or take the report away. I will show you which parts of AI Visibility to use and in what order. I cannot see your results.',
  starters: [
    'What should I fix first?',
    'How do I audit a page?',
    'What does robots.txt have to do with AI?',
    'Why is my no-JS readability low?',
    'How do I send this report to a client?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in AI Visibility yet', color: '#f59e0b' },
    beyond: { label: 'Beyond AI Visibility', color: null },
  },
  buttonTip: 'Ask the AI Visibility guide. Tell it what you want to check, understand or improve, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your results.',
  openTip: (label) => `Show ${label} on this page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking AI Visibility…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the AI Visibility guide',
  errorText: 'The AI Visibility guide could not answer just now.',
  wideKey: 'vault:ai-visibility-guide:wide',
};

export default function AiVisibilityTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
