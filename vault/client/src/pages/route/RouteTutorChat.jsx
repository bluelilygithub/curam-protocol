import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Route Tracer guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video Tools, Finance and
 * the Cellar Planner); this file only supplies the wording and endpoint. `onOpenTool(id)` asks Route Tracer (the app inside the page's frame) to open a
 * screen. It cannot see the map or the person's tracks: it only knows what each screen does and which one is open.
 */

const CONFIG = {
  endpoint: '/api/route-tutor',
  guideId: 'route',
  payloadKey: 'currentTool',
  name: 'Route Tracer guide',
  shortName: 'guide',
  subtitle: 'Tell me what route you want to make',
  intro: 'Hi! Tell me what you want to do with a route, in your own words. I will check the screens we have and give you the steps in order. If something is missing, or the job is outside Route Tracer, I will say so. I cannot see your map or your tracks.',
  starters: [
    'Plan a 10 km bike loop from my home',
    'Get a Strava file onto the map',
    'Email a map of my walk to a friend',
    'Find cafes near my route',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Route Tracer yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Route Tracer', color: null },
  },
  buttonTip: 'Ask the Route Tracer guide. Tell it what you want to do, by typing or talking, and it tells you which screens to use and in what order. It cannot see your map.',
  openTip: (label) => `Open ${label} in Route Tracer. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking the screens…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Route Tracer guide',
  errorText: 'The Route Tracer guide could not answer just now.',
  wideKey: 'vault:route-guide:wide',
};

export default function RouteTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
