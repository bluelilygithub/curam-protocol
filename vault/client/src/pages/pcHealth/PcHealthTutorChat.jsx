import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The PC Health guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the
 * tool (see pcHealthTools.mjs). It cannot see any scan, file name or number from the PC: it only knows what each tool and control does.
 */

const CONFIG = {
  endpoint: '/api/pc-health-tutor',
  guideId: 'pc-health',
  payloadKey: 'currentTool',
  name: 'PC Health guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to find out about your PC',
  intro: 'Hi! Tell me what you want to know about your computer, in your own words: is the disk filling up, what is using the memory, are there logs or files left behind. I will check what PC Health can do and give you the steps. PC Health only reports, it never fixes or deletes anything, and I cannot see your scan results.',
  starters: [
    'How do I get my first report?',
    'Find out what is filling my disk',
    'Which programs are using the most memory?',
    'See what has grown since last time',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in PC Health yet', color: '#f59e0b' },
    beyond: { label: 'Beyond PC Health', color: null },
  },
  buttonTip: 'Ask the PC Health guide. Tell it what you want to find out about your computer, by typing or talking, and it tells you which tool and controls to use and in what order. It cannot see your scan results, and PC Health never changes anything on your PC.',
  openTip: (label) => `Show ${label} in PC Health. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking PC Health…',
  placeholder: 'Type or tap the mic: what do you want to find out? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the PC Health guide',
  errorText: 'The PC Health guide could not answer just now.',
  wideKey: 'vault:pc-health-guide:wide',
};

export default function PcHealthTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
