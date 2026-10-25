import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Topic Research guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` switches the page to the tab
 * that holds the control (see topicResearchTools.mjs). It cannot see any topic, article or brief: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/topic-research-tutor',
  guideId: 'topic-research',
  payloadKey: 'currentTool',
  name: 'Topic Research guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to research',
  intro: 'Hi! Tell me what you want to do, in your own words: find what is trending on a topic, keep an eye on one, or write a research brief for your own article. I will check what Topic Research can do and give you the steps. If something is missing, I will say so. I cannot see your topics, articles or briefs.',
  starters: [
    'How do I find what is trending on a topic?',
    'Can it keep an eye on a topic for me?',
    'How do I get a research brief?',
    'How do I stop it spending too much?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Topic Research yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Topic Research', color: null },
  },
  buttonTip: 'Ask the Topic Research guide. Tell it what you want to research, by typing or talking, and it tells you which controls to use and in what order. It cannot see your topics, articles or briefs.',
  openTip: (label) => `Show ${label} in Topic Research. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Topic Research…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Topic Research guide',
  errorText: 'The Topic Research guide could not answer just now.',
  wideKey: 'vault:topic-research-guide:wide',
};

export default function TopicResearchTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
