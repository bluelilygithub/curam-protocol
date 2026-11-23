import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/** The Skill Scanner guide. The chat itself is the shared component; this file supplies only the wording and endpoint. */

const CONFIG = {
  endpoint: '/api/skill-scan-tutor',
  guideId: 'skill-scan',
  payloadKey: 'currentTool',
  name: 'Skill Scanner guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to check',
  intro: 'Hi! Tell me what you want to check before installing a skill or plugin, and I will show you which controls to use. I cannot see any link, zip or scan result.',
  starters: [
    'How do I check a plugin from GitHub?',
    'How do I scan a plugin that is on my computer?',
    'What does Caution mean?',
    'When is a deep scan worth it?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Skill Scanner yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Skill Scanner', color: null },
  },
  buttonTip: 'Ask the Skill Scanner guide. Tell it what you want to check by typing or talking and it tells you which controls to use. It cannot see your scans.',
  openTip: (label) => `Show ${label} on the page. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Skill Scanner…',
  placeholder: 'Type or tap the mic: what do you want to check? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Skill Scanner guide',
  errorText: 'The Skill Scanner guide could not answer just now.',
  wideKey: 'vault:skill-scan-guide:wide',
};

export default function SkillScanTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
