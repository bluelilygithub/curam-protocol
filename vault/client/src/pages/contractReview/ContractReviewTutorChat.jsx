import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';

/**
 * The Contract Review guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the wording
 * and endpoint. `onOpenTool(id)` shows a tool and scrolls to a part of it (ids in contractReviewTools.mjs GUIDE_TOOLS).
 * It cannot see the contracts, the reviews or the answers. Must sit inside a VoiceInputProvider (the page has one).
 */

const CONFIG = {
  endpoint: '/api/contract-review-tutor',
  guideId: 'contract-review',
  payloadKey: 'currentTool',
  name: 'Contract Review guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do',
  intro: 'Hi! Tell me what you want to do with a contract, in your own words. I will point you to the right parts of Contract Review, in order. If it cannot do something, I will say so. I cannot see your contracts or their reviews, and I do not give legal advice.',
  starters: [
    'Is there anything in this contract I should worry about?',
    'The other side sent a new version. What changed?',
    'How do I get the deadlines into my calendar?',
    'How do I see it from the other party\'s side?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Contract Review yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Contract Review', color: null },
  },
  buttonTip: 'Ask the Contract Review guide. Tell it what you want to do, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your contracts.',
  openTip: (label) => `Show ${label} in Contract Review. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Contract Review…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Contract Review guide',
  errorText: 'The Contract Review guide could not answer just now.',
  wideKey: 'vault:contract-review-guide:wide',
};

export default function ContractReviewTutorChat({ currentTool, onOpenTool }) {
  return <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />;
}
