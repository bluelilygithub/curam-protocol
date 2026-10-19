import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Measurements guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the
 * tool (see measurementsTools.mjs). It cannot see any value, document or result: it only knows what each tool and control does.
 */

const CONFIG = {
  endpoint: '/api/measurements-tutor',
  guideId: 'measurements',
  payloadKey: 'currentTool',
  name: 'Measurements guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to convert or find',
  intro: 'Hi! Tell me what you want to do with measurements, in your own words: convert a value, look up how a conversion works, or find and convert the measurements in a document. I will check what Measurements can do and give you the steps. If something is missing, I will say so. I cannot see your values or documents.',
  starters: [
    'Convert cups of flour to grams',
    'Say a conversion out loud instead of typing it',
    'Convert every size in a PDF to metric',
    'Why do US and imperial gallons differ?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Measurements yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Measurements', color: null },
  },
  buttonTip: 'Ask the Measurements guide. Tell it what you want to convert or find, by typing or talking, and it tells you which tool and controls to use and in what order. It cannot see your values or documents.',
  openTip: (label) => `Show ${label} in Measurements. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Measurements…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Measurements guide',
  errorText: 'The Measurements guide could not answer just now.',
  wideKey: 'vault:measurements-guide:wide',
};

export default function MeasurementsTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
