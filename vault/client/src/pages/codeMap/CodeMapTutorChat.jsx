import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Code Map guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, used by every page guide); this file only
 * supplies the wording and endpoint. `onOpenTool(id)` switches to the tab and scrolls to the part (see codeMapTools.mjs). It sees no code,
 * run or finding: it only knows what each tab, control and rule means.
 */

const CONFIG = {
  endpoint: '/api/code-map-tutor',
  guideId: 'code-map',
  payloadKey: 'currentTool',
  name: 'Code Map guide',
  shortName: 'guide',
  subtitle: 'Ask how to read the page or what a rule means',
  intro: 'Hi! Ask me how to read Code Map or what a rule means, in your own words: what amber means, why a score is low, what changed since last week. I will point you to the right tab and explain. I cannot see the code, the runs or the findings.',
  starters: [
    'What does amber mean?',
    'What is the SSRF guard rule?',
    'How do I see what changed since last week?',
    'How do I get a fix plan for a finding?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Code Map yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Code Map', color: null },
  },
  buttonTip: 'Ask the Code Map guide how to read the page or what a rule means, by typing or talking. It cannot see the code, the runs or the findings.',
  openTip: (label) => `Show ${label} on this page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Code Map…',
  placeholder: 'Type or tap the mic: what do you want to know? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Code Map guide',
  errorText: 'The Code Map guide could not answer just now.',
  wideKey: 'vault:code-map-guide:wide',
};

export default function CodeMapTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
