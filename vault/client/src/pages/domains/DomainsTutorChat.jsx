import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Domain guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools,
 * Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the tool
 * that holds the control (see domainsTools.mjs). It cannot see any description, name or result: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/domains-tutor',
  guideId: 'domains',
  payloadKey: 'currentTool',
  name: 'Domain guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do',
  intro: 'Hi! Tell me what you are trying to do, in your own words: find a name for a business, a book or a project, check a name you already have, or see whether a domain is free. I will check what Domain can do and give you the steps. If something is missing, I will say so. I cannot see what you type or the results.',
  starters: [
    'I need a name for my business',
    'I already have a book title and an artist name',
    'The .com is taken, what can I do?',
    'How do I save my names for later?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Domain yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Domain', color: null },
  },
  buttonTip: 'Ask the Domain guide. Tell it what you want to do, by typing or talking, and it tells you which tools to use and in what order. It cannot see what you type or the results.',
  openTip: (label) => `Open ${label} in Domain. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Domain…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Domain guide',
  errorText: 'The Domain guide could not answer just now.',
  wideKey: 'vault:domains-guide:wide',
};

export default function DomainsTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
