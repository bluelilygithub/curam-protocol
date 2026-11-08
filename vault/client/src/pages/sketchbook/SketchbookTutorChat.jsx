import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Sketchbook guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Diagrams,
 * Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the view that
 * holds the control (see sketchbookTools.mjs). It cannot see any sketch: it only knows what each view and control does.
 */

const CONFIG = {
  endpoint: '/api/sketchbook-tutor',
  guideId: 'sketchbook',
  payloadKey: 'currentTool',
  name: 'Sketchbook guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to draw or do',
  intro: 'Hi! Tell me what you want to do with your sketches, in your own words: describe a scene to be drawn, change a picture you already have, colour it in, go back to an earlier version, or put a sketch in a note. I will check what Sketchbook can do and point you at the right controls, or tell you plainly if it cannot.',
  starters: [
    'Draw my idea in blue pen',
    'Make the person in my sketch bigger',
    'Put my sketch in a note',
    'Go back to the earlier picture',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Sketchbook yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Sketchbook', color: null },
  },
  buttonTip: 'Ask the Sketchbook guide. Tell it what you want to draw or do, by typing or talking, and it tells you which controls to use and in what order. It cannot see your sketches.',
  openTip: (label) => `Show ${label} in Sketchbook. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Sketchbook…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Sketchbook guide',
  errorText: 'The Sketchbook guide could not answer just now.',
  wideKey: 'vault:sketchbook-guide:wide',
};

export default function SketchbookTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
