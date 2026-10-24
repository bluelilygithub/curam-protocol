import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Notes guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools,
 * Finance, Music and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` opens or brings into view the
 * control (see notesTools.mjs). It cannot see any note: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/notes-tutor',
  guideId: 'notes',
  payloadKey: 'currentTool',
  name: 'Notes guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do with your notes',
  intro: 'Hi! Tell me what you want to do in Notes, in your own words: write, record your voice, find something, or turn a note into a task. I will check what Notes can do and give you the steps. If something is missing, I will say so. I cannot see your notes.',
  starters: [
    'Record my voice and turn it into a note',
    'Talk to the assistant out loud and keep it as a note',
    'What is the difference between the two mic buttons?',
    'Turn a note into a task',
    'Find the note about the budget',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Notes yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Notes', color: null },
  },
  buttonTip: 'Ask the Notes guide. Tell it what you want to do, by typing or talking, and it tells you which buttons to use and in what order. It cannot see your notes.',
  openTip: (label) => `Show ${label} in Notes. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Notes…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Notes guide',
  errorText: 'The Notes guide could not answer just now.',
  wideKey: 'vault:notes-guide:wide',
};

export default function NotesTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
