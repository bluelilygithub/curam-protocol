import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';

/**
 * The Video Tools tutor. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by Finance); this file
 * only supplies Video Tools' wording and endpoint. `onOpenTool(id)` opens a tool in the page. Must sit inside the page's
 * VoiceInputProvider (for the microphone).
 */

const CONFIG = {
  endpoint: '/api/videos/tutor',
  payloadKey: 'currentTool',
  name: 'Video Tools tutor',
  shortName: 'tutor',
  subtitle: 'Tell me what you want to make',
  intro: 'Hi! Tell me what you want to do with your video or audio, in your own words. I will check the tools we have, and give you the steps. If a tool is missing, or the job is outside Video Tools, I will say so.',
  starters: [
    'Cut a 12 second clip out of a long video',
    'Put my script on a video as captions',
    'Get the speech out of audio that has music',
    'Join four clips into one video',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'A tool is missing', color: '#f59e0b' },
    beyond: { label: 'Beyond Video Tools', color: null },
  },
  buttonTip: 'Ask the Video Tools tutor. Tell it what you want to make, by typing or talking, and it tells you which tools to use and in what order.',
  openTip: (label) => `Open ${label} in the Video Tools list. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the tools…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the tutor',
  errorText: 'The tutor could not answer just now.',
  wideKey: 'vault:video-tutor:wide',
};

export default function TutorChat({ currentTool, onOpenTool }) {
  return <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />;
}
