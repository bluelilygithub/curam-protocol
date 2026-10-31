import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Device preview guide. The chat itself is the shared component (components/tutor/TutorChat.jsx, also used by PDF, Graphics, Video
 * Tools, Finance, Notes and the planners); this file only supplies the wording and endpoint. `onOpenTool(id)` scrolls the page to the
 * area that holds the control (see devicePreviewTools.mjs). It cannot see any address or page: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/device-preview-tutor',
  guideId: 'device-preview',
  payloadKey: 'currentTool',
  name: 'Device preview guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to check',
  intro: 'Hi! Tell me what you want to check, in your own words: how a page looks on an iPhone, a tablet on its side, or a screen size that is not in the list. I will check what Device preview can do and give you the steps. If something is missing, I will say so. I cannot see the addresses you type or the pages.',
  starters: [
    'How does my page look on an iPhone?',
    'Show it on a tablet on its side',
    'I want a size that is not in the list',
    'Why is the page blank?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Device preview yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Device preview', color: null },
  },
  buttonTip: 'Ask the Device preview guide. Tell it what you want to check, by typing or talking, and it tells you which controls to use and in what order. It cannot see the addresses you type or the pages.',
  openTip: (label) => `Show ${label} in Device preview. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Device preview…',
  placeholder: 'Type or tap the mic: what do you want to check? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Device preview guide',
  errorText: 'The Device preview guide could not answer just now.',
  wideKey: 'vault:device-preview-guide:wide',
};

export default function DevicePreviewTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
