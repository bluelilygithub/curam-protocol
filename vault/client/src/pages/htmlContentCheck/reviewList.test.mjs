// node client/src/pages/htmlContentCheck/reviewList.test.mjs
import assert from 'node:assert/strict';
import { changeText, openQuestionsPrompt } from './reviewList.mjs';

assert.equal(changeText({ type: 'changed', before: { text: 'Phone 03 1111' }, after: { text: 'Phone 03 2222' } }), '"Phone 03 1111" became "Phone 03 2222"');
assert.equal(changeText({ type: 'added', after: { type: 'image', src: 'https://x.example/a.jpg', text: 'Easel' } }), 'Added picture https://x.example/a.jpg ("Easel")');

const view = {
  pages: [
    { pageId: 1, label: 'The Artist', url: 'https://d.example/artist', results: { diff: { vsBaseline: { changes: [
      { id: 'c1', type: 'changed', before: { text: 'Phone 03 1111' }, after: { text: 'Phone 03 3333' } },
      { id: 'c2', type: 'changed', before: { text: 'We sell wine.' }, after: { text: 'We proudly sell wine.' } },
    ] } } } },
    { pageId: 2, label: '', url: 'https://d.example/events', results: { diff: { vsBaseline: { changes: [] } } } },
  ],
  review: {
    attention: [
      { type: 'change', pageId: 1, changeId: 'c2', reason: 'questioned', decision: { status: 'question', note: null } },
      { type: 'change', pageId: 1, changeId: 'c9', reason: 'unmarked', decision: null }, // unmarked: not an open question
      { type: 'line', ref: 'R1', reason: 'changedSinceApproval', links: [{ pageId: 1, changeId: 'c1' }], decision: { status: 'approved' } },
      { type: 'line', ref: 'R2', reason: 'noChange', links: [], decision: null },
      { type: 'line', ref: 'R3', reason: 'questioned', links: [], decision: { status: 'question', note: 'Use the new logo' } },
      { type: 'line', ref: 'R4', reason: 'notMatched', links: [] },
    ],
  },
};
const items = [
  { ref: 'R1', pageId: 1, lineText: 'Change the phone to 03 2222' },
  { ref: 'R2', pageId: 2, lineText: 'Add the 2027 launch' },
  { ref: 'R3', pageId: null, lineText: 'Swap the logo' },
  { ref: 'R4', pageId: 1, lineText: 'x' },
];
assert.equal(openQuestionsPrompt({ jobName: 'Dorothy Stoner', items, view }), [
  "I'm checking edits on a website (Dorothy Stoner) against what the client asked for. These items are still open. Please fix each one on the live pages and change nothing else.",
  '',
  'Page: Across the site',
  '- Request R3: "Swap the logo"',
  '  Problem: Use the new logo',
  '',
  'Page: The Artist (https://d.example/artist)',
  '- A change nobody asked for: "We sell wine." became "We proudly sell wine."',
  '  Problem: Not requested: put it back as it was unless there is a reason for it.',
  '- Request R1: "Change the phone to 03 2222"',
  '  Problem: This was approved, but the change has gone or changed since.',
  '  What the page shows now: "Phone 03 1111" became "Phone 03 3333"',
  '',
  'Page: Page 2 (https://d.example/events)',
  '- Request R2: "Add the 2027 launch"',
  '  Problem: No change was found on the page for this request.',
].join('\n'));
assert.equal(openQuestionsPrompt({ jobName: 'x', items, view: { pages: [], review: { attention: [] } } }), '', 'nothing open: nothing to copy');
console.log('reviewList.test.mjs: passed');
