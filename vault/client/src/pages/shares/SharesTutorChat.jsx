import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Shares guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by Finance); this file only
 * supplies Shares' wording and endpoint. It cannot see your holdings or figures, never recommends buying or selling and never gives
 * tax advice. `onOpenTab(id)` switches the Shares page to that tab (ids are the page's own tab ids).
 */

const CONFIG = {
  endpoint: '/api/shares-tutor',
  guideId: 'shares',
  payloadKey: 'currentTool',
  name: 'Shares guide',
  shortName: 'guide',
  subtitle: 'Where to do things, and how Shares works',
  intro: 'Ask me where to do something in Shares, or how part of it works. I cannot see your holdings or figures, I will not say what to buy or sell, and I do not give tax advice: for tax questions I will point you to your accountant.',
  starters: [
    'How do I add a share I just bought?',
    'Where do I see my capital gains for the year?',
    'How do I get my accountant the year\'s figures?',
    'Why do Portfolio and CGT show different profits?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Shares does not do this yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Shares', color: null },
  },
  buttonTip: 'Ask the Shares guide where to do something, or how part of Shares works. It cannot see your holdings, does not say what to buy or sell, and does not give tax advice.',
  openTip: (label) => `Open the ${label} tab. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Shares…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Shares guide',
  errorText: 'The Shares guide could not answer just now.',
  wideKey: 'vault:shares-guide:wide',
};

export default function SharesTutorChat({ currentTab, onOpenTab }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTab} onOpen={onOpenTab} />
    </VoiceInputProvider>
  );
}
