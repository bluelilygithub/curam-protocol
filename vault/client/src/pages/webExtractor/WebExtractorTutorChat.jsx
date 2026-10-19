import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Web Extractor guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics,
 * Video Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page
 * to the tool (see webExtractorTools.mjs). It cannot see any page or result: it only knows what each tool and button does.
 */

const CONFIG = {
  endpoint: '/api/web-extractor-tutor',
  guideId: 'web-extractor',
  payloadKey: 'currentTool',
  name: 'Web Extractor guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want from a web page',
  intro: 'Hi! Tell me what you want from a web page, in your own words: the text of an article, all its pictures, or a copy of how it looks. I will check what the Web Extractor can do and give you the steps. If something is missing, I will say so. I cannot see the page or your results.',
  starters: [
    'Get the text of an article and save it as a PDF',
    'Download all the pictures from a page',
    'Leave out the author and newsletter boxes',
    'Copy a page\'s code to use somewhere else',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in the Web Extractor yet', color: '#f59e0b' },
    beyond: { label: 'Beyond the Web Extractor', color: null },
  },
  buttonTip: 'Ask the Web Extractor guide. Tell it what you want from a web page, by typing or talking, and it tells you which tool and buttons to use and in what order. It cannot see the page.',
  openTip: (label) => `Show ${label} in the Web Extractor. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the Web Extractor…',
  placeholder: 'Type or tap the mic: what do you want from the page? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Web Extractor guide',
  errorText: 'The Web Extractor guide could not answer just now.',
  wideKey: 'vault:web-extractor-guide:wide',
};

export default function WebExtractorTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
