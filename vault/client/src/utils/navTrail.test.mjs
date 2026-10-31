import assert from 'node:assert/strict';
import { isPathActive, matchEntry, trailFor } from './navTrail.mjs';

// segments, not text prefixes
assert.equal(isPathActive('/clients', '/clients'), true);
assert.equal(isPathActive('/clients', '/clients/12'), true);
assert.equal(isPathActive('/clients', '/client-projects'), false);
assert.equal(isPathActive('/clients', '/clientsfoo'), false);
assert.equal(isPathActive('/tasks', '/tasks/'), true);
assert.equal(isPathActive('/notes', '/notes?note=3'.split('?')[0]), true);
assert.equal(isPathActive('/', '/tasks'), false);
assert.equal(isPathActive('/', '/'), true);
assert.equal(isPathActive('/goals?section=mission', '/goals'), true, 'a query on the link is ignored here');

const entries = [
  { path: '/clients', label: 'CRM', group: 'Business' },
  { path: '/client-projects', label: 'Client work', group: 'Business' },
  { path: '/student/quiz', label: 'Student', group: 'Business', activeUnder: '/student' },
  { path: '/goals?section=mission', label: 'Mission' },
  { path: '/settings', label: 'Settings' },
  { path: '/', label: 'Home' },
];
assert.equal(matchEntry('/clients/12', entries).label, 'CRM');
assert.equal(matchEntry('/client-projects/3', entries).label, 'Client work');
assert.equal(matchEntry('/student/cards', entries).label, 'Student', 'activeUnder widens the section');
assert.equal(matchEntry('/goals', entries), null, 'links with a query never claim a page');
assert.equal(matchEntry('/', entries), null, 'the home page has no section');
assert.equal(matchEntry('/nowhere', entries), null);

assert.deepEqual(trailFor('/clients', entries), { group: 'Business', label: 'CRM', to: '/clients', deeper: false });
assert.deepEqual(trailFor('/clients/12', entries), { group: 'Business', label: 'CRM', to: '/clients', deeper: true });
assert.equal(trailFor('/student/cards', entries).deeper, true);
assert.equal(trailFor('/student/quiz', entries).deeper, false);
assert.equal(trailFor('/nowhere', entries), null);

console.log('navTrail: ok');
