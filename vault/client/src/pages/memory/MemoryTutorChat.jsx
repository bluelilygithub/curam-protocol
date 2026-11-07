import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Memory guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools, Finance,
 * Notes, Usage and the rest); this file only supplies the wording and endpoint. `onOpenTool(id)` scrolls to the part of the page (see memoryTools.mjs).
 * It cannot see any memory: it only knows what each part of the page does.
 */

const CONFIG = {
  endpoint: '/api/memory-tutor',
  guideId: 'memory',
  payloadKey: 'currentTool',
  name: 'Memory guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do with your memories',
  intro: 'Hi! Tell me what you want to do with Memory, in your own words: save a fact, find one, or stop Claude using one. I will check what this page can do and give you the steps. If something is missing, I will say so. I cannot see your memories.',
  starters: [
    'How do I save something for Claude to remember?',
    'Can I tell Claude in a chat to remember something?',
    'How do I find a memory?',
    'How do I delete a memory?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Memory yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Memory', color: null },
  },
  buttonTip: 'Ask the Memory guide. Tell it what you want to do with your memories, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your memories.',
  openTip: (label) => `Show ${label} on this page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Memory…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Memory guide',
  errorText: 'The Memory guide could not answer just now.',
  wideKey: 'vault:memory-guide:wide',
};

export default function MemoryTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
