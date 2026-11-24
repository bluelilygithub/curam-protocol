// node client/src/pages/tickets/ticketLogic.test.mjs
import assert from 'node:assert/strict';
import { isOverdue, dueText, listQuery, prefillFrom, shortName, ticketNo, localToday, sourceHref, statusOf } from './ticketLogic.mjs';

const today = '2026-11-24';
assert.equal(isOverdue({ dueDate: '2026-11-20', status: 'open' }, today), true);
assert.equal(isOverdue({ dueDate: '2026-11-20', status: 'done' }, today), false);
assert.equal(isOverdue({ dueDate: today, status: 'open' }, today), false);
assert.equal(isOverdue({ dueDate: null, status: 'open' }, today), false);
assert.equal(dueText({ dueDate: today, status: 'open' }, today), 'Due today');
assert.equal(dueText({ dueDate: '2026-11-23', status: 'waiting' }, today), '1 day overdue');
assert.equal(dueText({ dueDate: '2026-11-21', status: 'open' }, today), '3 days overdue');
assert.equal(dueText({ dueDate: '2026-12-03', status: 'open' }, today), 'Due 3 Dec');
assert.equal(dueText({ dueDate: '2027-01-05', status: 'open' }, today), 'Due 5 Jan 2027');
assert.equal(dueText({ dueDate: '2026-11-21', status: 'done' }, today), 'Due 21 Nov');
assert.equal(dueText({ dueDate: null }, today), '');

assert.equal(listQuery({ q: 'invoice', status: 'active', type: '', priority: 'high', assigneeId: 'me', overdue: true }), 'q=invoice&status=active&priority=high&assigneeId=me&overdue=true');
assert.equal(listQuery({ status: '' }), '');

assert.equal(prefillFrom(new URLSearchParams('title=x')), null);
assert.deepEqual(prefillFrom(new URLSearchParams('new=1&title=Fix%20it&clientId=7&sourceKind=note&sourceId=4&sourceLabel=Meeting&type=bug')),
  { title: 'Fix it', description: '', type: 'bug', clientId: 7, clientProjectId: null, sourceKind: 'note', sourceId: 4, sourceLabel: 'Meeting' });
const bad = prefillFrom(new URLSearchParams('new=1&clientId=-3&sourceKind=email&sourceId=4&type=feature'));
assert.equal(bad.clientId, null);
assert.equal(bad.sourceKind, null);
assert.equal(bad.type, 'client');

assert.equal(shortName('mike@example.com'), 'mike');
assert.equal(shortName(null), '');
assert.equal(ticketNo({ id: 12 }), 'T-12');
assert.equal(localToday(new Date(2026, 0, 5)), '2026-01-05');
assert.equal(sourceHref({ sourceKind: 'note', sourceId: '4' }), '/notes?note=4');
assert.equal(sourceHref({ sourceKind: null }), null);
assert.equal(statusOf('nope').value, 'open');
console.log('ticketLogic tests passed');
