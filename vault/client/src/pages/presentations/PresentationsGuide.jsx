import React from 'react';
import TutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Presentations guide. Only wording and endpoint live here; the chat itself is the shared component.
 * It points at the six real tools and cannot see a person's decks.
 */
const CONFIG = {
  endpoint: '/api/presentations-tutor',
  guideId: 'presentations',
  payloadKey: 'currentTool',
  name: 'Presentations guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to make slides about',
  intro: 'Hi! Tell me what you want to present, in your own words. I will check the tools we have and give you the steps in order. If a tool is missing, or the job is outside Presentations, I will say so. I cannot see your decks.',
  starters: [
    'Make a short deck from a written brief',
    'Turn a PDF into slides',
    'Make a deck using my brand colours',
    'Reopen a saved deck and export it',
  ],
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'A tool is missing', color: '#f59e0b' },
    beyond: { label: 'Beyond Presentations', color: null },
  },
  buttonTip: 'Ask the Presentations guide. Tell it what slides you need, by typing or talking, and it tells you which tools to use and in what order. It cannot see your decks.',
  openTip: (label) => `Open ${label} in the Presentations list. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the tools…',
  placeholder: 'Type or tap the mic: what do you want to present? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Presentations guide',
  errorText: 'The Presentations guide could not answer just now.',
  wideKey: 'vault:presentations-guide:wide',
};

// No model picker: the guide uses the workspace model like the other Vault guides.
export default function PresentationsGuide({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <TutorChat
        config={CONFIG}
        current={currentTool}
        onOpen={onOpenTool}
      />
    </VoiceInputProvider>
  );
}
