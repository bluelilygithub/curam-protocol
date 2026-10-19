import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The CSS guide (the tool is called "CSS" on screen; "restyle" is only its internal name). The chat itself is the shared component
 * (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools, Finance, Notes and the planners); this file only supplies
 * the wording and endpoint. `onOpenTool(id)` switches the page to the tool (see restyleTools.mjs). It cannot see any page: it only
 * knows what each tool and button does. Plain words only, no code jargon.
 */

const CONFIG = {
  endpoint: '/api/restyle-tutor',
  guideId: 'css',
  payloadKey: 'currentTool',
  name: 'CSS guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to change on your page',
  intro: 'Hi! Tell me what you want to change about how your page looks, in your own words: bigger headings, different colours, rounded corners, a bit of movement. I will check what this tool can do and give you the steps. If something is missing, I will say so. I cannot see your page.',
  starters: [
    'Make all the headings bigger and bolder',
    'Change the colour of every button',
    'Save my page and come back to it later',
    'Load my page and try some changes',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in this tool yet', color: '#f59e0b' },
    beyond: { label: 'Beyond this tool', color: null },
  },
  buttonTip: 'Ask the CSS guide. Tell it what you want to change on your page, by typing or talking, and it tells you which tool and buttons to use and in what order. It cannot see your page.',
  openTip: (label) => `Show ${label}. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the tool…',
  placeholder: 'Type or tap the mic: what do you want to change? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the CSS guide',
  errorText: 'The CSS guide could not answer just now.',
  wideKey: 'vault:css-guide:wide',
};

export default function RestyleTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
