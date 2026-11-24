// What the Tickets page shows: its two views (the list and one ticket), the hover text for them, the words for the guide, and every control
// the guide (the round button) can point at. The ids are the guide's catalogue (server/services/ticketsTutor.js);
// `node server/services/ticketsTutor.test.js` fails if the two lists drift apart. `tool` is the view the guide's Open button shows.

export const TICKET_TOOLS = [
  { id: 'list', label: 'Tickets list', group: 'Tickets list', icon: 'ticket' },
  { id: 'ticket', label: 'One ticket', group: 'One ticket', icon: 'list-checks' },
];

export const GROUPS = ['Tickets list', 'One ticket'];

export const GROUP_TIPS = {
  'Tickets list': 'Every ticket, with filters and search, and the New ticket button.',
  'One ticket': 'A single ticket: its details, description, comments and history, and the tasks made from it.',
};

export const TOOL_TIPS = {
  list: 'Find tickets with the filters and search, and start a new one.',
  ticket: 'One ticket: change its status, who has it, priority, type, due date and client; comment; make a task.',
};

export const TOOL_BLURBS = {
  list: 'Internal tickets for client work, bugs, admin and ideas.',
  ticket: 'Details, comments and history for one ticket.',
};

// The longer text: what Tickets is and how it works (also the source of the tour's wording).
export const HOW_IT_WORKS = [
  ['Finding your way', 'Tickets opens on What do you want to do? (common jobs, one click each). The menu on the left has New ticket and the lists: Active, Mine, Overdue, In progress, Waiting, Done and All tickets, and one per type. Search, priority and who has it narrow any list.'],
  ['What it is', 'An internal list of work: client requests, bugs in Vault or our sites and apps, admin, and ideas for later. Nobody outside Vault raises or sees a ticket.'],
  ['Shared', 'Everyone who has Tickets sees and can change every ticket. Each change is written to the ticket\'s history with who made it.'],
  ['A ticket', 'A number (T-12), a title and description, a type, a status (Open, In progress, Waiting, Done), a priority, a due date, an optional client and project, who raised it and who has it.'],
  ['AI from text', 'In New ticket, Fill in with AI turns a pasted or dictated request into the title, type, priority, due date, client and steps, for you to check. Nothing is saved until you press Create ticket.'],
  ['From other tools', 'Make a ticket in an open note or an Email Follow-Up case, and New ticket in a client\'s or client project\'s Tickets list, open New ticket already filled in and linked back.'],
  ['Reminders', 'A morning email lists your tickets that are overdue, due today or newly assigned to you, when there are any. The Tickets item in the Apps menu shows how many are assigned to you, red when some are overdue.'],
];

// Everything the guide can point at: the two views plus the controls inside them.
export const GUIDE_TOOLS = [
  { id: 'list', label: 'Tickets list', tool: 'list' },
  { id: 'filters', label: 'Filters and search', tool: 'list' },
  { id: 'new', label: 'New ticket', tool: 'list' },
  { id: 'ai', label: 'Fill in with AI', tool: 'list' },
  { id: 'from-tools', label: 'Make a ticket from other tools', tool: 'list' },
  { id: 'digest', label: 'Morning email and badge', tool: 'list' },
  { id: 'ticket', label: 'One ticket', tool: 'ticket' },
  { id: 'fields', label: 'Status, assignee and details', tool: 'ticket' },
  { id: 'client', label: 'Client and client project', tool: 'ticket' },
  { id: 'activity', label: 'Comments and history', tool: 'ticket' },
  { id: 'task', label: 'Make a task', tool: 'ticket' },
  { id: 'delete', label: 'Delete and undo', tool: 'ticket' },
];
