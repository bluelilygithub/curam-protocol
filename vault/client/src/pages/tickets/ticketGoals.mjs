// The "What do you want to do?" job tiles above the Tickets list (shared look: components/JobStart.jsx). Tickets has no tool list, so
// each job does one thing on the list page: `newTicket` opens New ticket with those fields filled in, `filters` sets the list filters.
// `steps` name controls from GUIDE_TOOLS (ticketsTools.mjs) and are only shown on the tile.
//
//   node client/src/pages/tickets/ticketGoals.test.mjs   (checks every step and field is real)

export const TICKET_GOALS = [
  {
    id: 'log',
    title: 'Log something that needs doing',
    blurb: 'A client request, a job for later, anything you do not want to forget.',
    icon: 'plus',
    newTicket: {},
    steps: [{ tool: 'new', note: 'Type or dictate a title, then pick the type, priority, due date and client.' }],
  },
  {
    id: 'from-text',
    title: 'Turn an email or message into a ticket',
    blurb: 'Paste it in and AI fills in the ticket for you to check.',
    icon: 'mail',
    newTicket: {},
    steps: [
      { tool: 'new', note: 'New ticket opens.' },
      { tool: 'ai', note: 'Paste the email or message into AI from text and press Fill in with AI. Check it, then Create ticket.' },
    ],
  },
  {
    id: 'bug',
    title: 'Report a bug',
    blurb: 'Something broken in Vault or one of our sites or apps.',
    icon: 'alert-circle',
    newTicket: { type: 'bug', priority: 'high' },
    steps: [{ tool: 'new', note: 'Say what happened, where, and what you expected instead.' }],
  },
  {
    id: 'idea',
    title: 'Park an idea for later',
    blurb: 'Write it down now and come back to it when there is time.',
    icon: 'lightbulb',
    newTicket: { type: 'idea', priority: 'low' },
    steps: [{ tool: 'new', note: 'A title is enough; add detail if you have it.' }],
  },
  {
    id: 'mine',
    title: 'See what is on my plate',
    blurb: 'Every ticket assigned to you that is not done.',
    icon: 'user',
    filters: { status: 'active', assigneeId: 'me' },
    steps: [
      { tool: 'filters', note: 'The list shows Active and Mine.' },
      { tool: 'ticket', note: 'Open a ticket to change its status or comment.' },
    ],
  },
  {
    id: 'overdue',
    title: 'Catch up on overdue tickets',
    blurb: 'Everything past its due date and not done, whoever has it.',
    icon: 'alert-triangle',
    filters: { status: 'active', overdue: true },
    steps: [
      { tool: 'filters', note: 'The list shows Active and Overdue.' },
      { tool: 'ticket', note: 'Open each one to move its due date, reassign it or close it.' },
    ],
  },
];
