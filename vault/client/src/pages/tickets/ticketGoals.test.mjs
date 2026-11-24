// node client/src/pages/tickets/ticketGoals.test.mjs — every job tile names real controls and does exactly one real thing.
import assert from 'node:assert/strict';
import { TICKET_GOALS } from './ticketGoals.mjs';
import { GUIDE_TOOLS } from './ticketsTools.mjs';
import { TYPES, PRIORITIES, STATUS_FILTERS } from './ticketLogic.mjs';

const ids = new Set(GUIDE_TOOLS.map((t) => t.id));
const FILTER_KEYS = ['q', 'status', 'type', 'priority', 'assigneeId', 'overdue'];
assert.equal(new Set(TICKET_GOALS.map((g) => g.id)).size, TICKET_GOALS.length, 'job ids are unique');
for (const g of TICKET_GOALS) {
  assert.ok(g.title && g.blurb && g.icon && g.steps.length >= 1, `${g.id} is complete`);
  for (const s of g.steps) assert.ok(ids.has(s.tool) && s.note, `${g.id}: ${s.tool} is a real control with a note`);
  assert.ok(!!g.newTicket !== !!g.filters, `${g.id} either opens New ticket or filters the list`);
  if (g.newTicket) {
    if (g.newTicket.type) assert.ok(TYPES.some((t) => t.value === g.newTicket.type), `${g.id}: real type`);
    if (g.newTicket.priority) assert.ok(PRIORITIES.some((p) => p.value === g.newTicket.priority), `${g.id}: real priority`);
  }
  if (g.filters) {
    for (const k of Object.keys(g.filters)) assert.ok(FILTER_KEYS.includes(k), `${g.id}: ${k} is a list filter`);
    if (g.filters.status !== undefined) assert.ok(STATUS_FILTERS.some((f) => f.value === g.filters.status), `${g.id}: real status filter`);
  }
}
console.log('ticketGoals.test.mjs: all passed');
