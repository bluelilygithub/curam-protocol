import React from 'react';
import SharedTutorChat from '../../components/tutor/TutorChat';

/**
 * The Tickets guide. The chat itself is the shared component (components/tutor/TutorChat.jsx); this file only supplies the wording and
 * endpoint. `onOpenTool(id)` switches the page to the view that holds the control (see ticketsTools.mjs). It cannot see any ticket.
 * TicketsPage already wraps the page in VoiceInputProvider, so the chat's microphone works.
 */

const CONFIG = {
  endpoint: '/api/tickets-tutor',
  guideId: 'tickets',
  payloadKey: 'currentTool',
  name: 'Tickets guide',
  shortName: 'guide',
  subtitle: 'Tell me what you want to do with tickets',
  intro: 'Hi! Tell me what you want to do with tickets, in your own words: log a bug, hand a ticket to someone, see what is overdue, turn a note into a ticket, or make a task from one. I will point you at the right controls, or tell you plainly if Tickets cannot do it.',
  starters: [
    'Turn an email request into a ticket',
    'Give this ticket to someone else',
    'Show me what is overdue',
    'Make a task from a ticket',
  ],
  // Status colours are deliberately outside the theme (see client/DESIGN.md).
  verdicts: {
    doable: { label: 'You can do this', color: '#16a34a' },
    partly: { label: 'Mostly, but one piece is missing', color: '#f59e0b' },
    missing: { label: 'Not in Tickets yet', color: '#f59e0b' },
    beyond: { label: 'Beyond Tickets', color: null },
  },
  buttonTip: 'Ask the Tickets guide. Tell it what you want to do, by typing or talking, and it tells you which controls to use and in what order. It cannot see your tickets.',
  openTip: (label) => `Show ${label} in Tickets. This chat stays open so you can keep following the steps.`,
  busyText: 'Checking Tickets…',
  placeholder: 'Type or tap the mic: what do you want to do? (Enter sends, Shift+Enter adds a line)',
  inputLabel: 'Ask the Tickets guide',
  errorText: 'The Tickets guide could not answer just now.',
  wideKey: 'vault:tickets-guide:wide',
};

export default function TicketsTutorChat({ currentTool, onOpenTool }) {
  return <SharedTutorChat config={CONFIG} current={currentTool} onOpen={onOpenTool} />;
}
