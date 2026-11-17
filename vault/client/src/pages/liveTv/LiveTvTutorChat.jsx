import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Live TV guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the wording and
 * endpoint. `onOpenTool(id)` scrolls the page to the box that holds the control (see liveTvTools.mjs). It cannot see the channel list,
 * favourites or history: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/live-tv-tutor',
  guideId: 'live-tv',
  payloadKey: 'currentTool',
  name: 'Live TV guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to watch',
  intro: 'Hi! Tell me what you want to watch or what went wrong, in your own words. I will point you to the right buttons. I cannot see the channel list or what you have watched.',
  starters: [
    'How do I find the news?',
    'Why will this channel not play?',
    'How do I watch it in VLC?',
    'How do I keep a channel handy?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Live TV yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Live TV', color: null },
  },
  buttonTip: 'Ask the Live TV guide. Tell it what you want to watch or what went wrong, by typing or talking, and it tells you which buttons to use. It cannot see the channel list or what you watched.',
  openTip: (label) => `Show ${label} in Live TV. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Live TV…',
  placeholder: 'Type or tap the mic: what do you want to watch? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Live TV guide',
  errorText: 'The Live TV guide could not answer just now.',
  wideKey: 'vault:live-tv-guide:wide',
};

export default function LiveTvTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
