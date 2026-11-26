// node client/src/pages/htmlContentCheck/reviewList.test.mjs
import assert from 'node:assert/strict';
import { reviewGroups, developerList } from './reviewList.mjs';

const job = {
  name: 'Dorothy Stoner website',
  pages: [{ id: 1, label: 'The Artist', url: 'https://d.example/artist' }, { id: 2, label: '', url: 'https://d.example/events' }],
  items: [
    { ref: 'R1', kind: 'request_line', pageId: null, lineText: 'Fix the phone number' },
    { ref: 'R2', kind: 'request_line', pageId: 1, lineText: 'Add her dates' },
    { ref: 'R3', kind: 'keep', pageId: 1, lineText: 'George established himself' },
    { ref: 'R4', kind: 'request_line', pageId: 2, lineText: 'Add the 2027 launch' },
    { ref: 'R5', kind: 'held_over', pageId: 2, lineText: 'Read a Chapter' },
    { ref: 'R6', kind: 'request_line', pageId: null, lineText: 'Remove the old logo' },
  ],
};
const lines = [{ ref: 'R1', status: 'linked', links: [{ pageId: 2, changeId: 'c1' }] }, { ref: 'R6', status: 'noChange' }];
const { groups, others } = reviewGroups(job, lines);
assert.deepEqual(groups.map((g) => [g.label, g.lines.map((l) => l.ref)]), [['Across the site', ['R6']], ['The Artist', ['R2']], ['Page 2', ['R1', 'R4']]],
  'a line with no page goes under its first linked page, else across the site; an unnamed page is "Page n"');
assert.deepEqual(others.map((o) => o.ref), ['R3', 'R5'], 'Keep and Held over are kept apart');

const text = developerList({ jobName: job.name, number: 2, groups, approvals: { R2: { status: 'approved' }, R4: { status: 'needs_work', note: 'Wrong date' }, R6: { status: 'needs_work', note: null } } });
assert.equal(text, [
  'Changes still needed: Dorothy Stoner website, round 2', '',
  'Across the site', '- R6: Remove the old logo', '',
  'Page 2 (https://d.example/events)', '- R4: Add the 2027 launch', '  Note: Wrong date',
].join('\n'), 'only lines that need work, page by page, with notes');
console.log('reviewList.test.mjs: passed');
