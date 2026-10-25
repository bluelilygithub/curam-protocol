import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Burner Mail guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` scrolls the page to the
 * area that holds the control (see burnerMailTools.mjs). It cannot see any address, email, code or link: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/burner-mail-tutor',
  guideId: 'burner-mail',
  payloadKey: 'currentTool',
  name: 'Burner Mail guide',
  shortName: 'guide',
  subtitle: 'Tell me what you are signing up for',
  intro: 'Hi! Tell me what you want to do, in your own words: make an address for a sign-up, find a verification code, or work out why an email has not arrived. I will check what Burner Mail can do and give you the steps. If something is missing, I will say so. I cannot see your addresses or emails.',
  starters: [
    'Sign up for a website without my real email',
    'Where do I find my verification code?',
    'The email has not arrived yet',
    'How long does an address last?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Burner Mail yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Burner Mail', color: null },
  },
  buttonTip: 'Ask the Burner Mail guide. Tell it what you are signing up for, by typing or talking, and it tells you which controls to use and in what order. It cannot see your addresses or emails.',
  openTip: (label) => `Show ${label} in Burner Mail. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Burner Mail…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Burner Mail guide',
  errorText: 'The Burner Mail guide could not answer just now.',
  wideKey: 'vault:burner-mail-guide:wide',
};

export default function BurnerMailTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
