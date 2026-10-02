#!/usr/bin/env node
/**
 * Chat list panel grouping/filtering — date buckets (local calendar days), project grouping,
 * multi-word search and pinned filtering.
 *
 * Run: node client/src/utils/chatPanelGroups.test.mjs
 */
import assert from 'assert';
import { daysAgo, dateGroupLabel, groupByDate, groupByProject, filterSessions, pinnedOnly } from './chatPanelGroups.mjs';

let n = 0;
function test(name, fn) {
  try { fn(); n += 1; console.log(`PASS  ${name}`); }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.message}`); process.exitCode = 1; }
}

// "Now" is Wednesday 15 Oct 2025, 09:30 local time.
const NOW = new Date(2025, 9, 15, 9, 30);
const at = (y, m, d, h = 12, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

test('calendar days, not 24-hour blocks: 23:50 last night is Yesterday, 00:05 today is Today', () => {
  assert.strictEqual(dateGroupLabel(at(2025, 10, 14, 23, 50), NOW), 'Yesterday');
  assert.strictEqual(dateGroupLabel(at(2025, 10, 15, 0, 5), NOW), 'Today');
});

test('bucket boundaries: 2-7 days = Previous 7 days, 8-30 = Previous 30 days, 31+ = Older', () => {
  assert.strictEqual(dateGroupLabel(at(2025, 10, 13), NOW), 'Previous 7 days'); // 2 days
  assert.strictEqual(dateGroupLabel(at(2025, 10, 8), NOW), 'Previous 7 days');  // 7 days
  assert.strictEqual(dateGroupLabel(at(2025, 10, 7), NOW), 'Previous 30 days'); // 8 days
  assert.strictEqual(dateGroupLabel(at(2025, 9, 15), NOW), 'Previous 30 days'); // 30 days
  assert.strictEqual(dateGroupLabel(at(2025, 9, 14), NOW), 'Older');            // 31 days
});

test('a timestamp slightly in the future (clock skew) is Today, not a crash', () => {
  assert.strictEqual(daysAgo(at(2025, 10, 15, 9, 45), NOW), 0);
  assert.strictEqual(dateGroupLabel(at(2025, 10, 16, 1, 0), NOW), 'Today');
});

test('an unreadable date lands in Older rather than throwing', () => {
  assert.strictEqual(dateGroupLabel('garbage', NOW), 'Older');
  assert.strictEqual(dateGroupLabel(null, NOW), 'Older');
});

test('groupByDate: fixed order, empty groups dropped, newest first inside a group', () => {
  const s = [
    { sessionId: 'old', lastAt: at(2025, 6, 1) },
    { sessionId: 'today-early', lastAt: at(2025, 10, 15, 7, 0) },
    { sessionId: 'yest', lastAt: at(2025, 10, 14, 15) },
    { sessionId: 'today-late', lastAt: at(2025, 10, 15, 9, 0) },
  ];
  const g = groupByDate(s, NOW);
  assert.deepStrictEqual(g.map((x) => x.label), ['Today', 'Yesterday', 'Older']);
  assert.deepStrictEqual(g[0].items.map((x) => x.sessionId), ['today-late', 'today-early']);
});

test('groupByProject: Quick chat for no project, most recently active project first', () => {
  const s = [
    { sessionId: 'a', projectId: 1, projectName: 'Acme', lastAt: at(2025, 10, 10) },
    { sessionId: 'b', projectId: null, projectName: null, lastAt: at(2025, 10, 14) },
    { sessionId: 'c', projectId: 1, projectName: 'Acme', lastAt: at(2025, 10, 12) },
    { sessionId: 'd', projectId: 2, projectName: 'Beta', lastAt: at(2025, 10, 13) },
  ];
  const g = groupByProject(s);
  assert.deepStrictEqual(g.map((x) => x.label), ['Quick chat', 'Beta', 'Acme']);
  assert.deepStrictEqual(g[2].items.map((x) => x.sessionId), ['c', 'a']);
});

test('a project with an id but no name is labelled "Project", not Quick chat', () => {
  assert.strictEqual(groupByProject([{ sessionId: 'x', projectId: 9, projectName: null, lastAt: at(2025, 10, 1) }])[0].label, 'Project');
});

const sessions = [
  { sessionId: '1', title: 'Quote for Acme', firstUserMsg: 'draft a quote', lastMsg: 'here is the quote', projectName: 'Sales', projectId: 1, starred: 1 },
  { sessionId: '2', title: null, firstUserMsg: 'Fix the login bug', lastMsg: 'patched', projectName: null, projectId: null, starred: 0 },
  { sessionId: '3', title: 'Holiday ideas', firstUserMsg: 'where to go', lastMsg: 'Try Tasmania', projectName: 'Personal', projectId: 2, starred: 0 },
];

test('search matches title, first question, last reply and project name, case-insensitively', () => {
  assert.deepStrictEqual(filterSessions(sessions, 'ACME').map((s) => s.sessionId), ['1']);
  assert.deepStrictEqual(filterSessions(sessions, 'login').map((s) => s.sessionId), ['2']);
  assert.deepStrictEqual(filterSessions(sessions, 'tasmania').map((s) => s.sessionId), ['3']);
  assert.deepStrictEqual(filterSessions(sessions, 'personal').map((s) => s.sessionId), ['3']);
});

test('multi-word search needs every word (AND), in any order', () => {
  assert.deepStrictEqual(filterSessions(sessions, 'quote acme').map((s) => s.sessionId), ['1']);
  assert.deepStrictEqual(filterSessions(sessions, 'acme tasmania').map((s) => s.sessionId), []);
});

test('empty / whitespace query returns everything; chats without a project match "quick chat"', () => {
  assert.strictEqual(filterSessions(sessions, '   ').length, 3);
  assert.strictEqual(filterSessions(sessions, undefined).length, 3);
  assert.deepStrictEqual(filterSessions(sessions, 'quick chat').map((s) => s.sessionId), ['2']);
});

test('pinned filter uses the starred flag', () => {
  assert.deepStrictEqual(pinnedOnly(sessions).map((s) => s.sessionId), ['1']);
});

console.log(`\n${n} tests passed${process.exitCode ? ' — WITH FAILURES' : ''}`);
