'use strict';

// node server/services/ticketsTutor.test.js   No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./ticketsTutor');

checkGuide({
  name: 'ticketsTutor',
  service,
  askName: 'askTicketsTutor',
  feature: 'tickets_guide',
  toolsFile: 'tickets/ticketsTools.mjs',
  menuExport: 'TICKET_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'ticket',
  exampleStepId: 'fields',
  facts: [
    ['list', 'notes', /sees every ticket/, 'tickets are shared'],
    ['filters', 'does', /T-12/, 'number search is named'],
    ['filters', 'does', /Active, which is every ticket not done/, 'the default filter is explained'],
    ['new', 'does', /microphone/, 'dictation is named'],
    ['new', 'notes', /own CRM/, 'only your own clients can be linked'],
    ['ai', 'notes', /only that text, today\'s date and the names of your clients/, 'what the AI sees is stated'],
    ['ai', 'notes', /nothing is saved until Create ticket/, 'nothing is saved by the AI'],
    ['from-tools', 'does', /open note/, 'Notes is named'],
    ['from-tools', 'does', /Email Follow-Up case/, 'Email Follow-Up is named'],
    ['from-tools', 'does', /Tickets tab/, 'the client page tab is named'],
    ['digest', 'does', /at 7/, 'the email time is stated'],
    ['digest', 'notes', /No email is sent on a day with nothing to report/, 'empty days send nothing'],
    ['ticket', 'notes', /no Save button/, 'there is no Save button'],
    ['fields', 'does', /Status: Open → In progress/, 'history wording is shown'],
    ['client', 'does', /Choosing a project also chooses its client/, 'a project chooses its client'],
    ['activity', 'notes', /Change lines cannot be removed/, 'history cannot be removed'],
    ['task', 'does', /your own Tasks/, 'the task is the person\'s own'],
    ['task', 'notes', /does not change the ticket/, 'a task does not close the ticket'],
    ['delete', 'does', /30 days/, 'the recycle bin time is stated'],
    ['delete', 'notes', /same T-number/, 'the number comes back'],
  ],
  gaps: [/portal for clients/, /incoming emails into tickets/, /board with columns/, /Custom statuses/, /Time tracking/, /morning email off/, /private to some people/],
  rules: [/internal list of work/, /sees and can change every ticket/, /no Save button/, /only AI in Tickets/, /30 days/],
  system: [/never create, change or delete anything yourself/, /cannot see any ticket/],
}).catch((e) => { console.error(e); process.exit(1); });
