'use strict';

// The CRM guide (the round button on Vault's CRM pages: the client list, a client's page and the pipeline): a person says what they want
// to do ("log a call", "remind me to follow up", "see which deals are open", "link a project to a client") and the guide points at the
// real controls, in order, or says plainly that the CRM does not do it. It only knows what is written here and it never sees any client,
// contact, deal or note. Built on guideCore.js; the ids are listed in client/src/pages/crm/crmGuideTools.mjs (a test keeps the two in step).
// The CRM is "clients" inside the code. See docs/guide-chat.md and docs/crm-migration.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'client-list', label: 'Client list', group: 'Clients',
    does: 'The CRM page (CRM in the sidebar). Shows every client as a card, with a search box (name or company) and status filters: All, Prospect, Active, Paused, Archived. A card can be opened, edited, switched active or archived, or deleted.',
    notes: 'Deleting a client asks "Delete? Yes / No" first.' },
  { id: 'new-client', label: 'New client', group: 'Clients',
    does: 'The + New Client button on the CRM page opens a form: name, company, status, how they like to be contacted, how they work, start date, tags and notes.',
    notes: 'Finance invoices and quotes pick their client from this list, so a client has to exist here before it can be invoiced.' },
  { id: 'client-info', label: 'Info', group: 'A client\'s page',
    does: 'The Info section of a client\'s page: their details, plus your own extra labelled fields (add, edit or remove). Edit at the top opens the same form as New client. The page can also write a short summary of the client\'s deals, touchpoints and finance history.',
    notes: 'The summary is written by the AI on request and uses only what is already recorded for that client.' },
  { id: 'outstanding', label: 'Outstanding', group: 'A client\'s page',
    does: 'Things waiting on you for this client: touchpoints marked as needing a follow-up that have not been dealt with yet.',
    notes: 'Marking a follow-up done clears it from here.' },
  { id: 'activity', label: 'Activity', group: 'A client\'s page',
    does: 'The history for the client, newest first. Log a touchpoint (call, email, meeting or note) with a note, the person involved, and a "when this actually happened" time if it was earlier. You can dictate the note, attach files, filter by type or person, tick "needs follow-up", and use + Follow up to create a linked task.',
    notes: 'Touchpoints are a past-tense log. A follow-up becomes a Task, in one direction only. Gmail search on the page can find the emails with this client.' },
  { id: 'deals', label: 'Deals', group: 'A client\'s page',
    does: 'The Deals section of a client\'s page: add, edit or delete a deal with its title, value, stage (lead, qualified, proposal, negotiation, won, lost) and expected close date.',
    notes: 'The Pipeline page lists the deals of every client together.' },
  { id: 'contacts', label: 'Contacts', group: 'A client\'s page',
    does: 'The people at the client: add, edit or delete a contact. A contact can be chosen as the person on a touchpoint.',
    notes: '' },
  { id: 'projects', label: 'Projects', group: 'A client\'s page',
    does: 'Link a Vault project to the client, or unlink it. Linked projects show with their task status (on track, in progress or has overdue tasks).',
    notes: 'Linking only connects them; the project itself is managed on the Projects page.' },
  { id: 'tasks', label: 'Tasks', group: 'A client\'s page',
    does: 'Every open task linked to the client, whether through a project or directly (for example a follow-up). Add a task, tick one done, mark it waiting on the client, add steps, and see the activity logged against it.',
    notes: 'Tasks belong to one person; there is no assigning to someone else.' },
  { id: 'pipeline', label: 'Pipeline', group: 'Deals',
    does: 'The Pipeline page (/pipeline): every deal across all clients in one table (client, deal, stage, value, expected and actual close). Filter by stage, show open deals only, click a column heading to sort, click a row to open that client.',
    notes: 'Deals are created and edited on the client\'s page, not here.' },
];

const RULES = [
  'Every client is one record shared by CRM, Projects, Tasks and Finance, so a client added here can be picked everywhere else.',
  'A touchpoint is a log of something that already happened. To plan something, use + Follow up, which creates a Task linked to the client.',
  'A task linked to a client shows in the client\'s Tasks section whether it came through a project or was linked directly.',
  'Deals belong to a client and move through the stages lead, qualified, proposal, negotiation, won and lost.',
  'Files can be attached to a touchpoint or a task; there is a size limit per file and a storage limit per person.',
  'A client page has a tour (compass icon) and an information box (info icon) that explains touchpoints, follow-ups and tasks.',
  'Deleting a client asks for confirmation first; it is not a casual action, so check before doing it.',
  'The Open buttons in this chat only take you to a page or section; they never add, change or delete anything.',
];

const NOT_POSSIBLE = [
  'Sending email from the CRM (Gmail search can only find and show existing emails).',
  'Sharing a client with another Vault user or assigning a task to someone else; everything is private to the person.',
  'Automatic reminders or sequences that run without you; a follow-up is a task you complete.',
  'Mass emailing, newsletters or marketing campaigns.',
  'Sales forecasting or reports beyond the Pipeline table and the stage counts.',
  'Importing clients from a spreadsheet or another CRM.',
  'Creating invoices or quotes from the CRM (that is in Finance, which reads the client from here).',
  'Looking at the person\'s clients, contacts or notes: this chat cannot see them.',
];

const SYSTEM = `You are the guide to the CRM in Vault (the part of Vault for clients, contacts, deals and the history of dealing with them). A person says, in everyday words, what they want to do, and you point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say the CRM cannot do.
- You cannot see any client, contact, deal, note or task. Never state or guess any of them. If they ask about their own data, say you cannot see it and say where it is shown.
- Be plain and short, as to a friend who is not technical. Explain a term such as "touchpoint" or "pipeline" in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there. Steps that happen on a client's page come after opening that client from the client list.
- If you need one more fact to answer, ask ONE short question and give no steps.
- Warn before deleting anything.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'CRM guide', feature: 'crm_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'CRM TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your clients, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askCrmTutor: guide.ask,
};
