import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/** The Business Profiler guide. The chat itself is the shared component; this file supplies only the wording and endpoint. */

const CONFIG = {
  endpoint: '/api/bip-tutor',
  guideId: 'bip',
  payloadKey: 'currentTool',
  name: 'Business Profiler guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to find out about a business',
  intro: 'Hi! Tell me what you want to know and I will show you which controls to use. I can explain the cards, the source list, the confidence marks and re-scanning. I cannot see any domain you type or any profile you have saved.',
  starters: [
    'How do I profile a domain?',
    'What do the ✅ ⚠️ ❌ marks mean?',
    'How do I refresh just one source?',
    'What does BIP not tell me?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Business Profiler yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Business Profiler', color: null },
  },
  buttonTip: 'Ask the Business Profiler guide. Tell it what you want to do by typing or talking and it tells you which controls to use. It cannot see your profiles.',
  openTip: (label) => `Show ${label} in Business Profiler. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Business Profiler…',
  placeholder: 'Type or tap the mic: what do you want to know? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Business Profiler guide',
  errorText: 'The Business Profiler guide could not answer just now.',
  wideKey: 'vault:bip-guide:wide',
};

export default function BipTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
