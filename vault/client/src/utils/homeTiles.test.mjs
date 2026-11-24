// node client/src/utils/homeTiles.test.mjs
import assert from 'node:assert/strict';
import { homeGroupsFor } from './homeTiles.mjs';

const visible = { notes: { id: 'notes', label: 'Notes' }, finance: { id: 'finance', label: 'Finance' }, tickets: { id: 'tickets', label: 'Tickets' } };
const layout = { sets: [{ id: 'home', groups: [
  { id: 'g1', label: 'Money', itemIds: ['shares', 'finance'] },
  { id: 'g2', label: 'Admin only', itemIds: ['users'] },
  { id: 'g3', label: 'Daily', itemIds: ['tickets', 'notes'] },
] }] };
assert.deepEqual(homeGroupsFor(layout, visible), [
  { id: 'g1', label: 'Money', items: [visible.finance] },
  { id: 'g3', label: 'Daily', items: [visible.tickets, visible.notes] },
], 'order kept, apps this person cannot open and groups left empty are dropped');
assert.deepEqual(homeGroupsFor(null, visible), [], 'not set up');
console.log('homeTiles: ok');
