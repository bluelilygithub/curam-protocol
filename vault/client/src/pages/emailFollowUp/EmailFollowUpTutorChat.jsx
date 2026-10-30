import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';
import { VoiceInputProvider } from '../../components/voiceInput/VoiceInput';

/**
 * The Email Follow-Up guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the
 * wording and endpoint. `onOpenTool(id)` switches the page to the tab (or back to the case list), see emailFollowUpTools.mjs.
 * It cannot see any case, email, name or draft: it only knows what each control does.
 */

const CONFIG = {
  endpoint: '/api/email-follow-up-tutor',
  guideId: 'email-follow-up',
  payloadKey: 'currentTool',
  name: 'Email Follow-Up guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do',
  intro: 'Hi! Tell me what you want to do, in your own words: keep track of what a client owes you, chase something without nagging about what you already answered, or check what the tool could not see. I will check what Email Follow-Up can do and give you the steps. If something is missing, I will say so. I cannot see your cases, emails or drafts.',
  starters: [
    'How do I chase a client for missing documents?',
    'Why can\'t I draft a follow-up yet?',
    'What does "needs review" on a deadline mean?',
    'Can it send the email for me?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Email Follow-Up yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Email Follow-Up', color: null },
  },
  buttonTip: 'Ask the Email Follow-Up guide. Tell it what you want to do, by typing or talking, and it tells you which controls to use and in what order. It cannot see your cases, emails or drafts.',
  openTip: (label) => `Show ${label} in Email Follow-Up. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Email Follow-Up…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Email Follow-Up guide',
  errorText: 'The Email Follow-Up guide could not answer just now.',
  wideKey: 'vault:email-follow-up-guide:wide',
};

export default function EmailFollowUpTutorChat({ currentTool, onOpenTool }) {
  return (
    <VoiceInputProvider lang="en-AU">
      <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />
    </VoiceInputProvider>
  );
}
