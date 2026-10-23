// Built-in note templates and filling in {{date}}-style placeholders.
// Pure (no React, no fetch) so it is unit-tested: node client/src/pages/notes/noteTemplates.test.mjs
// The person's own templates are saved on the server (/api/notes/templates); these ones ship with the app.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n) => String(n).padStart(2, '0');

/** The person's own calendar day as YYYY-MM-DD (not UTC). */
export function localDay(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** "Fri 23 Oct 2026": the same everywhere, whatever the browser's language. */
export function formatDay(now = new Date()) {
  return `${WEEKDAYS[now.getDay()].slice(0, 3)} ${now.getDate()} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

function formatTime(now) {
  const h = now.getHours();
  return `${h % 12 || 12}:${pad(now.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/** {{date}} -> "Fri 23 Oct 2026", {{isodate}} -> "2026-10-23", {{weekday}} -> "Friday", {{time}} -> "3:30 pm". Anything else is left as typed. */
export function fillTemplate(text, now = new Date()) {
  const values = { date: formatDay(now), isodate: localDay(now), weekday: WEEKDAYS[now.getDay()], time: formatTime(now) };
  return String(text ?? '').replace(/\{\{\s*(date|isodate|weekday|time)\s*\}\}/gi, (_, key) => values[key.toLowerCase()]);
}

export const BUILT_IN_TEMPLATES = [
  { id: 'meeting', name: 'Meeting notes', hint: 'Attendees, agenda, decisions, actions', title: 'Meeting, {{date}}', tags: ['meeting'],
    body: 'Attendees:\n\nAgenda:\n- \n\nDiscussion:\n\nDecisions:\n- \n\nActions:\n- [ ] \n- [ ] \n' },
  { id: 'client-call', name: 'Client call', hint: 'Who, what they need, what was agreed, follow-ups', title: 'Call with ', tags: ['call'],
    body: 'Who: \nWhen: {{date}}, {{time}}\n\nWhat they need:\n\nWhat we agreed:\n- \n\nFollow-ups:\n- [ ] \n' },
  { id: 'weekly-review', name: 'Weekly review', hint: 'Wins, what slipped, next week', title: 'Weekly review, week of {{date}}', tags: ['review'],
    body: 'What went well:\n- \n\nWhat slipped, and why:\n- \n\nLoose ends to close:\n- [ ] \n\nTop 3 for next week:\n- [ ] \n- [ ] \n- [ ] \n' },
  { id: 'project-kickoff', name: 'Project kick-off', hint: 'Goal, scope, people, first steps', title: 'Kick-off: ', tags: ['project'],
    body: 'Goal:\n\nWhat is in scope:\n- \n\nWhat is not:\n- \n\nWho is involved:\n- \n\nKey dates:\n- \n\nFirst steps:\n- [ ] \n- [ ] \n\nRisks and questions:\n- \n' },
  { id: 'idea', name: 'Idea', hint: 'The idea, why it matters, a first test', title: 'Idea: ', tags: ['ideas'],
    body: 'The idea:\n\nWhy it matters:\n\nWhat it would take:\n- \n\nA small first test:\n- [ ] \n' },
  { id: 'todo', name: 'To-do list', hint: 'A plain checklist', title: 'To do, {{date}}', tags: [],
    body: '- [ ] \n- [ ] \n- [ ] \n' },
];

/** A template turned into the note to create: { title, body, tags } with placeholders filled in. */
export function templateToNote(template, now = new Date()) {
  return { title: fillTemplate(template.title, now).trimStart() || 'Untitled', body: fillTemplate(template.body, now), tags: Array.isArray(template.tags) ? template.tags : [] };
}
