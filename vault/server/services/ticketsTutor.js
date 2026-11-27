'use strict';

// The Tickets guide (the round button on Vault's /tickets page): a person says what they want to do ("track a bug", "give this to Sam", "see
// what is overdue") and the guide points at the real views and controls, in order, or says plainly that Tickets does not do it. It only knows
// what is written here and never sees any ticket. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/tickets/ticketsTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/tickets.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'list', label: 'Tickets list', group: 'Tickets list',
    does: 'The Tickets page lists tickets, most recently changed first. Each row shows the T-number, a coloured dot for priority, the title, the type and the status, then the client and project, who it is assigned to, the due date (red when overdue) and how many comments it has. Click a row to open the ticket. Tickets opens on What do you want to do?, job tiles: Log something that needs doing, Turn an email or message into a ticket, Report a bug and Park an idea (each opens New ticket, the last two with the type and priority filled in), See what is on my plate (opens Mine) and Catch up on overdue tickets (opens Overdue). Ticking Next time, open on the tool I used last skips the tiles and opens the last list; What do you want to do? at the top of the menu brings them back.',
    notes: 'Everyone who has Tickets sees every ticket. Up to 500 are shown at once; narrow the filters to see others.' },
  { id: 'filters', label: 'Filters and search', group: 'Tickets list',
    does: 'The menu on the left has New ticket, then Lists (Active, which is every ticket not done and is the usual list, Mine for tickets assigned to you, Overdue for tickets due before today and not done, In progress, Waiting, Done and All tickets) and By type (Client work, Bug, Admin, Idea, each only those not done). Its search box filters the menu, and the (i) and compass buttons beside the title open How Tickets works and the tour. Above the list, the search box finds words in titles and descriptions, or a number such as T-12, and three drop-downs filter by type, by priority and by who it is assigned to, including Nobody assigned (so All tickets plus Bug shows every bug, done or not).',
    notes: 'Opened from a client\'s or project\'s Open in Tickets link, the list shows only their tickets until Show all is pressed.' },
  { id: 'new', label: 'New ticket', group: 'Tickets list',
    does: 'The + New ticket button opens a form: title, type, priority, due date, who it is assigned to, client and client project, and description. Every text box has the microphone for dictation. Create ticket saves it and opens it.',
    notes: 'Only the title is needed; the type starts as Client work and the priority as Medium. Only people who have Tickets can be assigned. A client can only be chosen from your own CRM.' },
  { id: 'ai', label: 'Fill in with AI', group: 'Tickets list',
    does: 'At the top of New ticket, paste or dictate a messy request into the AI from text box and press Fill in with AI. It fills in the title, type, priority, due date, client and a list of steps in the description, for you to check and change before pressing Create ticket.',
    notes: 'One AI request on the workspace\'s default model. It sees only that text, today\'s date and the names of your clients; nothing is saved until Create ticket. It never invents a due date the text does not give.' },
  { id: 'from-tools', label: 'Make a ticket from other tools', group: 'Tickets list',
    does: 'Make a ticket buttons elsewhere in Vault open New ticket already filled in: in an open note (beside Make a plan: its title, text and client) and in an Email Follow-Up case (its name, what is owed and its client). A client\'s page has a Tickets tab and a client project\'s page a Tickets section, each listing their tickets with a New ticket button already filed under them and an Open in Tickets link.',
    notes: 'The ticket links back to where it came from (shown as From on the ticket). These buttons only show for people who have Tickets.' },
  { id: 'digest', label: 'Morning email and badge', group: 'Tickets list',
    does: 'Each morning at 7, everyone who has Tickets gets one email listing their open tickets that are overdue, due today, or newly assigned to them by someone else, when there are any. The Tickets item in the Apps menu shows how many open tickets are assigned to you, red when some are overdue, and the Apps button shows a dot.',
    notes: 'No email is sent on a day with nothing to report. There is no setting yet to turn the email off for one person.' },
  { id: 'ticket', label: 'One ticket', group: 'One ticket',
    does: 'An opened ticket: at the top its T-number, type, status and due date, the title (click to edit), who raised it and when, and where it came from. Beside it Make a task and Delete. Below, the description and the activity; on the right the status, assigned to, priority, type, due date and client boxes, and the tasks made from it.',
    notes: 'There is no Save button for the boxes on the right: each change saves at once. The description has its own Save description button.' },
  { id: 'fields', label: 'Status, assignee and details', group: 'One ticket',
    does: 'The boxes on the right of a ticket: Status (Open, In progress, Waiting, Done), Assigned to, Priority (High, Medium, Low), Type (Client work, Bug, Admin, Idea) and Due date. Each change saves at once and is written to the history, for example Status: Open → In progress.',
    notes: 'Setting Done records when it was closed; choosing another status reopens it. Only people who have Tickets can be assigned.' },
  { id: 'client', label: 'Client and client project', group: 'One ticket',
    does: 'The Client and Client project boxes file the ticket under one of your CRM clients and one of its projects. Choosing a project also chooses its client. The ticket then appears in that client\'s Tickets tab and the project\'s Tickets section, and links under the boxes open the client\'s page (on its Tickets tab) and the project\'s page.',
    notes: 'Only clients in your own CRM can be chosen; others see the name but no link, as the client is not in their CRM. Someone without that client can still change everything else on the ticket.' },
  { id: 'activity', label: 'Comments and history', group: 'One ticket',
    does: 'The Activity box lists comments and changes in time order, each with who and when. Type or dictate in the box at the bottom and press Comment. Changes such as status, priority, type, due date, assignee, client and title are added by themselves.',
    notes: 'A comment can be removed by the person who wrote it, or by an admin. Change lines cannot be removed.' },
  { id: 'task', label: 'Make a task', group: 'One ticket',
    does: 'Make a task at the top of a ticket adds a task to your own Tasks with the ticket\'s title, due date and priority, linked back to the ticket. A ticket has one task: once it is made, the button becomes Open task, which opens it in Tasks (or says it is in someone else\'s Tasks). The task shows From ticket T-12, which opens the ticket, and the ticket\'s history notes it.',
    notes: 'The task is yours only. The ticket\'s client and project are put on it only when they are in your own CRM. When the task is done, the ticket moves to Waiting for a last look; reopening the task moves it back to In progress. A ticket never moves to Done on its own: mark it Done yourself.' },
  { id: 'emails', label: 'Related emails', group: 'One ticket',
    does: 'The Related emails box, in New ticket and on an opened ticket, has a Find emails button (Regrab emails once it has run, with when it last ran beside it). It searches your own connected Gmail for threads about the ticket, using the title words and, when the client is in your own CRM, the client\'s contact addresses and email domains. Each thread has Attach to keep it on the ticket, or the cross to dismiss it. Show dismissed lists the dismissed ones with Restore. Attached threads have Detach. Clicking a subject opens the thread in Gmail.',
    notes: 'Only you see your emails: other people on the same ticket never see what you found or attached, and their own search is separate. A dismissed thread is never suggested again on that ticket. Regrab replaces only the suggestions you have not acted on. Gmail must be connected in Settings first. No AI is used, and only the subject, sender, date and Gmail\'s preview are kept.' },
  { id: 'delete', label: 'Delete and undo', group: 'One ticket',
    does: 'Delete at the top of a ticket asks first, then moves the ticket and its comments to your recycle bin, with an Undo button straight away. It can be put back from the recycle bin in Settings for 30 days.',
    notes: 'Restoring brings back the same T-number and history. Tasks made from it stay in Tasks but are no longer linked to it.' },
];

const RULES = [
  'Tickets is an internal list of work for client work, bugs, admin and ideas. Nobody outside Vault can raise or see a ticket.',
  'Everyone who has Tickets sees and can change every ticket. Admins always have it; for members an admin turns it on in Settings, Feature Access, and can switch it off for one person.',
  'Every change to a ticket is saved at once (there is no Save button except Save description) and written to its history.',
  'The only AI in Tickets is the Fill in with AI button (one AI request) and this guide chat. Related emails is a plain Gmail search, not AI.',
  'Related emails are private: only the person who found or attached an email sees it, even though the ticket itself is shared.',
  'A deleted ticket waits 30 days in the recycle bin in Settings, and an Undo button appears straight away.',
  'The Open buttons in this chat only switch to a tool on the page; they never create, change or delete a ticket by themselves.',
];

const NOT_POSSIBLE = [
  'A form or portal for clients to raise tickets themselves, or emailing a client from a ticket: Tickets is internal only.',
  'Turning incoming emails into tickets by themselves: use Make a ticket in an Email Follow-Up case, or New ticket (its Related emails box can find and attach the threads).',
  'Sharing an attached email with the rest of the team: related emails are private to the person who attached them. Paste the important part into a comment instead.',
  'A board with columns to drag tickets between: change the Status box instead, and use the lists in the menu on the left to see each group.',
  'Custom statuses, types or fields, categories or queues: the statuses, types and priorities are fixed.',
  'Time tracking, recurring tickets or attachments on a ticket: put links in the description, or make a task.',
  'Turning the morning email off for one person: it is only sent on days with something to report.',
  'Keeping a ticket private to some people: everyone with Tickets sees every ticket.',
];

const SYSTEM = `You are the guide to Tickets in Vault, an internal list of work (client work, bugs, admin and ideas) shared by everyone who has it. People say, in everyday words, what they want to do. You point them to the right view and controls and say plainly when Tickets cannot do something.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Tickets cannot do.
- You cannot see any ticket, its title, its comments or who has it. Never state or guess what a ticket says, and never create, change or delete anything yourself: point at the controls.
- Be plain and short, as to a colleague who is not technical. Avoid jargon.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- Be clear about where each control is: the Tickets list, inside an opened ticket, or another page (Notes, Email Follow-Up, a client or project page) for Make a ticket.
- If they ask for something in the list of things Tickets does not do, say so plainly and suggest the nearest thing that does work.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Tickets guide', feature: 'tickets_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'TICKETS VIEWS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your tickets, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askTicketsTutor: guide.ask,
};
