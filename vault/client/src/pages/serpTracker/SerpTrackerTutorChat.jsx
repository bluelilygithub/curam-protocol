import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The SERP Tracker guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools,
 * Finance, Notes, Usage and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` shows the tab and scrolls to the
 * part (see serpTrackerTools.mjs). It cannot see any site, search, result or cost: it only knows what each part of the page does.
 */

const CONFIG = {
  endpoint: '/api/serp-tracker-tutor',
  guideId: 'serp-tracker',
  payloadKey: 'currentTool',
  name: 'SERP Tracker guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do',
  intro: 'Hi! Tell me what you want to do in your own words: check where your site shows on Google, set up the searches to follow, look something up, or clear out old lookups. I will check what this page can do and give you the steps. If something is missing, or not built yet, I will say so. I cannot see your site or your results.',
  starters: [
    'How do I see where my site ranks for a search?',
    'What does a lookup cost?',
    'How do I delete old lookups?',
    'What is the Runs tab for?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in SERP Tracker yet', color: '#f59e0b' },
    beyond: { label: 'Beyond SERP Tracker', color: null },
  },
  buttonTip: 'Ask the SERP Tracker guide. Tell it what you want to do, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your site or your results.',
  openTip: (label) => `Show ${label} on this page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking SERP Tracker…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the SERP Tracker guide',
  errorText: 'The SERP Tracker guide could not answer just now.',
  wideKey: 'vault:serp-tracker-guide:wide',
};

export default function SerpTrackerTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
