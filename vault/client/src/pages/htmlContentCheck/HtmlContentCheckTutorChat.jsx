import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';

/**
 * The HTML Content Check guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the
 * wording and endpoint. `onOpenTool(id)` shows a tool and scrolls to a part of it (ids in htmlContentCheckTools.mjs GUIDE_TOOLS).
 * It cannot see the jobs, pages, requests or results. Must sit inside a VoiceInputProvider (the page has one).
 */

const CONFIG = {
  endpoint: '/api/html-content-check-tutor',
  guideId: 'html-content-check',
  payloadKey: 'currentTool',
  name: 'HTML Content Check guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to check',
  intro: 'Hi! Tell me what you want to check on a web page, in your own words. I will point you to the right parts of HTML Content Check, in order. If it cannot do something, I will say so. I cannot see your jobs or pages, and I never decide whether an edit was done: you do.',
  starters: [
    'My client sent a list of edits for their About page. How do I check them?',
    'The developer says the changes are live. What do I do now?',
    'The page is on a staging site behind a login.',
    'Why is a cookie banner showing as a change?',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in HTML Content Check yet', color: '#f59e0b' },
    beyond: { label: 'Beyond HTML Content Check', color: null },
  },
  buttonTip: 'Ask the HTML Content Check guide. Tell it what you want to check, by typing or talking, and it tells you which parts of the page to use and in what order. It cannot see your jobs or pages.',
  openTip: (label) => `Show ${label} in HTML Content Check. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking HTML Content Check…',
  placeholder: 'Type or tap the mic: what do you want to check? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the HTML Content Check guide',
  errorText: 'The HTML Content Check guide could not answer just now.',
  wideKey: 'vault:html-content-check-guide:wide',
};

export default function HtmlContentCheckTutorChat({ currentTool, onOpenTool }) {
  return <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />;
}
