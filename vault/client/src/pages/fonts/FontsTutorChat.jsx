import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Font Customizer guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the
 * tool (see fontsTools.mjs). It cannot see any font or preview: it only knows what each tool and control does.
 */

const CONFIG = {
  endpoint: '/api/fonts-tutor',
  guideId: 'fonts',
  payloadKey: 'currentTool',
  name: 'Font Customizer guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do with a font',
  intro: 'Hi! Tell me what you want to do with a font, in your own words: pick one, make it bolder or wider, fix the spacing, or download your version. I will check what the Font Customizer can do and give you the steps. If something is missing, I will say so. I cannot see your font.',
  starters: [
    'Make a bolder, wider version of a Google Font',
    'Tighten the spacing between letters',
    'Download my font for a website',
    'Save my work to come back to later',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in the Font Customizer yet', color: '#f59e0b' },
    beyond: { label: 'Beyond the Font Customizer', color: null },
  },
  buttonTip: 'Ask the Font Customizer guide. Tell it what you want to do with a font, by typing or talking, and it tells you which tool and controls to use and in what order. It cannot see your font.',
  openTip: (label) => `Show ${label} in the Font Customizer. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the Font Customizer…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Font Customizer guide',
  errorText: 'The Font Customizer guide could not answer just now.',
  wideKey: 'vault:fonts-guide:wide',
};

export default function FontsTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
