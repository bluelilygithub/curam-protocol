import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';

/**
 * The Music tutor. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies Music's
 * wording and endpoint. The brain is the same as the Video Tools tutor's (server/services/videoTutor.js), so it can point at
 * tools on either page. `onOpenTool(id)` opens a tool: a Music one in this page, a Video Tools one on /videos. Must sit inside
 * the page's VoiceInputProvider (for the microphone).
 */

const CONFIG = {
  endpoint: '/api/music/tutor',
  guideId: 'music',
  payloadKey: 'currentTool',
  name: 'Music tutor',
  shortName: 'tutor',
  subtitle: 'Tell me what you want to make',
  intro: 'Hi! Tell me what you want to do with music for your video, in your own words. I will check the tools we have in Music and Video Tools, and give you the steps. If a tool is missing, or the job is outside them, I will say so.',
  starters: [
    'Add calm background music to my video',
    'Put my own song under a video',
    'Add a voiceover with an Australian accent',
    'Make the music quieter while I am talking',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'A tool is missing', color: '#f59e0b' },
    beyond: { label: 'Beyond Music and Video Tools', color: null },
  },
  buttonTip: 'Ask the Music tutor. Tell it what you want to make, by typing or talking, and it tells you which tools to use and in what order.',
  openTip: (label) => `Open ${label}. If it is on the other page, this chat stays open here for you to come back to.`,
  busyText: 'Checking the tools…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the tutor',
  errorText: 'The tutor could not answer just now.',
  wideKey: 'vault:music-tutor:wide',
};

export default function MusicTutorChat({ currentTool, onOpenTool }) {
  return <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />;
}
