import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Graphics guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by Video Tools, PDF and
 * Finance); this file only supplies Graphics' wording and endpoint. `onOpenTool(id)` opens a tool in the page. It cannot see
 * your images: it only knows what each tool does. The Graphics page has no microphone provider of its own, so this wrapper
 * supplies one.
 */

const CONFIG = {
  endpoint: '/api/graphics-tutor',
  payloadKey: 'currentTool',
  name: 'Graphics guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do with your image',
  intro: 'Hi! Tell me what you want to do with your image, in your own words. I will check the tools we have and give you the steps in order. If a tool is missing, or the job is outside Graphics, I will say so. I cannot see your images.',
  starters: [
    'Make a logo background transparent',
    'Get one photo ready for Instagram and Facebook',
    'Make a photo file smaller for my website',
    'Remove a person from the edge of a photo',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'A tool is missing', color: '#f59e0b' },
    beyond: { label: 'Beyond Graphics', color: null },
  },
  buttonTip: 'Ask the Graphics guide. Tell it what you want to do with your image, by typing or talking, and it tells you which tools to use and in what order. It cannot see your images.',
  openTip: (label) => `Open ${label} in the Graphics list. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the tools…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Graphics guide',
  errorText: 'The Graphics guide could not answer just now.',
  wideKey: 'vault:graphics-guide:wide',
};

export default function GraphicsTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
