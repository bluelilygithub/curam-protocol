import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Guitar guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the
 * tab that holds the control (see guitarTools.mjs). It cannot see any song, chord or score: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/guitar-tutor',
  guideId: 'guitar',
  payloadKey: 'currentTool',
  name: 'Guitar guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to practise',
  intro: 'Hi! Tell me what you want to do, in your own words: slow down a tricky part, stop a song going rusty, find an easier capo, or work on a chord change. I will check what Guitar can do and give you the steps. If something is missing, I will say so. I cannot see your songs or scores.',
  starters: [
    'How do I slow down a solo and speed it up?',
    'How do I stop my songs going rusty?',
    'Is there an easier way to play this song?',
    'How do I practise a hard chord change?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Guitar yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Guitar', color: null },
  },
  buttonTip: 'Ask the Guitar guide. Tell it what you want to practise, by typing or talking, and it tells you which controls to use and in what order. It cannot see your songs or scores.',
  openTip: (label) => `Show ${label} in Guitar. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Guitar…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Guitar guide',
  errorText: 'The Guitar guide could not answer just now.',
  wideKey: 'vault:guitar-guide:wide',
};

export default function GuitarTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
