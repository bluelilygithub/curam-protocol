// node client/src/pages/notes/richEditorConfig.test.mjs   (part of npm run test:notes)
// The Rich editor must hand back the Markdown the person would have typed. These are the shapes real notes have.
import assert from 'node:assert';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'Node', 'Element', 'HTMLElement', 'DocumentFragment', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'DOMParser', 'Range', 'Selection']) {
  if (dom.window[key] !== undefined) { try { Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true, writable: true }); } catch { /* already defined */ } }
}

const { Editor } = await import('@tiptap/core');
const { buildExtensions, editorMarkdown, roundTripChangesMeaning } = await import('./richEditorConfig.mjs');

const roundTrip = (md) => {
  const editor = new Editor({ element: document.createElement('div'), extensions: buildExtensions(), content: md });
  const out = editorMarkdown(editor);
  editor.destroy();
  return out;
};
const same = (md, label) => assert.strictEqual(roundTrip(md), md, label);

same('# Heading\n\nSome **bold**, *italic* and ~~struck~~ text.', 'headings and marks');
same('- one\n- two\n  - nested', 'bullet list, nested');
same('1. first\n2. second', 'numbered list');
same('- [ ] open thing\n- [x] done thing', 'to-do list keeps its ticks');
same('> a quote', 'quote');
same('Call [Sam](https://example.com/a) today.', 'link');
same('line one\nline two\nline three', 'single line breaks stay plain new lines, no backslash');
same('para one\n\npara two', 'paragraphs');
same('```\ncode here\n```', 'code block');
same('| Item | Qty |\n| --- | --- |\n| Nails | 4 |', 'table with a header row');
same('Total: $5 > $3 and a < b, Tom & Jerry', 'angle brackets and ampersands stay plain characters, not entities');
// a template-style note, as created from "Meeting notes"
// a list straight after a line of text gets the blank line Markdown normally has there; saving twice changes nothing more
const meeting = roundTrip('Attendees:\n\nAgenda:\n- first\n\nActions:\n- [ ] send the quote');
assert.strictEqual(meeting, 'Attendees:\n\nAgenda:\n\n- first\n\nActions:\n\n- [ ] send the quote', 'a meeting-style note');
assert.strictEqual(roundTrip(meeting), meeting, 'stable once saved');

// nothing is changed just by opening a note: the page only saves when the person edits (onUpdate), and an untouched editor never fires it
let fired = 0;
const e = new Editor({ element: document.createElement('div'), extensions: buildExtensions(), content: 'Plain text, snake_case and 1. not a list\n\nok', onUpdate: () => { fired++; } });
assert.strictEqual(fired, 0, 'opening a note does not count as an edit');
e.destroy();

// replacing the content from outside (switching notes, an AI result, dictation) does not count as the person typing
const ed = new Editor({ element: document.createElement('div'), extensions: buildExtensions(), content: 'a', onUpdate: () => { fired++; } });
ed.commands.setContent('# New\n\n- [ ] x', { emitUpdate: false });
assert.strictEqual(fired, 0);
assert.strictEqual(editorMarkdown(ed), '# New\n\n- [ ] x');
// but typing does
ed.commands.insertContent('hello');
assert.ok(fired >= 1, 'typing is an edit');
ed.destroy();

// a note Rich cannot hold exactly is recognised before anyone edits it
assert.strictEqual(roundTripChangesMeaning('- one\n- [ ] two', roundTrip('- one\n- [ ] two')), true, 'bullets and to-dos in one list');
for (const fine of ['# T\n\nAgenda:\n- first\n\nActions:\n- [ ] x\n- [x] y', 'a\nb\n\nc', '* star bullets\n* two', 'Cost [draft] 2*3', '1. one\n2. two']) {
  assert.strictEqual(roundTripChangesMeaning(fine, roundTrip(fine)), false, `no warning for: ${JSON.stringify(fine)}`);
}

console.log('ok - rich editor: Markdown in, the same Markdown out, edits only when the person edits');
process.exit(0);
