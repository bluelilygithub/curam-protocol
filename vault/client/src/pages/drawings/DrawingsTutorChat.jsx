import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Drawings guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools,
 * Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the view
 * that holds the control (see drawingsTools.mjs). It cannot see any drawing: it only knows what each view and control does.
 */

const CONFIG = {
  endpoint: '/api/drawings-tutor',
  guideId: 'drawings',
  payloadKey: 'currentTool',
  name: 'Diagrams guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to draw or do',
  intro: 'Hi! Tell me what you want to do with your diagrams, in your own words: start a new one, draw a diagram, add a picture, or get a diagram out as a picture or file. I will check what Diagrams can do and point you at the right controls, or tell you plainly if it cannot.',
  starters: [
    'Draw a simple floor plan',
    'Put a picture into my diagram',
    'Get my diagram out as a PNG',
    'I deleted a diagram by mistake',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Diagrams yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Diagrams', color: null },
  },
  buttonTip: 'Ask the Diagrams guide. Tell it what you want to draw or do, by typing or talking, and it tells you which controls to use and in what order. It cannot see your diagrams.',
  openTip: (label) => `Show ${label} in Diagrams. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Diagrams…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Diagrams guide',
  errorText: 'The Diagrams guide could not answer just now.',
  wideKey: 'vault:drawings-guide:wide',
};

export default function DrawingsTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
