import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The YouTube guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools,
 * Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` scrolls the page to the area that holds
 * the control (see youtubeTools.mjs). It cannot see any search, video or note: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/youtube-tutor',
  guideId: 'youtube',
  payloadKey: 'currentTool',
  name: 'YouTube guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do',
  intro: 'Hi! Tell me what you want to do, in your own words: find a video, get the main points of one, ask it a question, or keep what it says in your notes. I will check what YouTube in Vault can do and give you the steps. If something is missing, I will say so. I cannot see your searches, the videos or your notes.',
  starters: [
    'Find a short, recent video about a topic',
    'Get the main points of a video',
    'Save what a video says to my notes',
    'Why does it say there are no captions?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in YouTube yet', color: '#f59e0b' },
    beyond: { label: 'Beyond YouTube in Vault', color: null },
  },
  buttonTip: 'Ask the YouTube guide. Tell it what you want to do with the videos, by typing or talking, and it tells you which controls to use and in what order. It cannot see your searches, the videos or your notes.',
  openTip: (label) => `Show ${label} on the YouTube page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking YouTube…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the YouTube guide',
  errorText: 'The YouTube guide could not answer just now.',
  wideKey: 'vault:youtube-guide:wide',
};

export default function YoutubeTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
