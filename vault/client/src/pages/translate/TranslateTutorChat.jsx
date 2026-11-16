import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';

/**
 * The Translate guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools
 * and the rest); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the screen that holds the
 * control (see translateTools.mjs). It cannot see any document or translation: it only knows what each screen and control does.
 * Sits inside the page's VoiceInputProvider.
 */

const CONFIG = {
  endpoint: '/api/translate-tutor',
  guideId: 'translate',
  payloadKey: 'currentTool',
  name: 'Translate guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want translated',
  intro: 'Hi! Tell me what you want to do, in your own words: translate a contract, get a quick draft, keep a brand name as it is, find a download. I will check what Translate can do and give you the steps. If something is missing, I will say so. I cannot see your documents or translations.',
  starters: [
    'Translate a Word file and keep it editable',
    'I only need a quick draft to read',
    'Always leave our product names as they are',
    'Why is there no Word download for my job?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Translate yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Translate', color: null },
  },
  buttonTip: 'Ask the Translate guide. Tell it what you want to do, by typing or talking, and it tells you which screen and buttons to use and in what order. It cannot see your documents.',
  openTip: (label) => `Show ${label} in Translate. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Translate…',
  placeholder: 'Type or tap the mic: what do you want to translate? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Translate guide',
  errorText: 'The Translate guide could not answer just now.',
  wideKey: 'vault:translate-guide:wide',
};

export default function TranslateTutorChat({ currentTool, onOpenTool }) {
  return <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />;
}
