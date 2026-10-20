import assert from 'assert';
import { contextReasons, toolReason } from './restyleContext.mjs';
import { RESTYLE_TOOLS } from './restyleTools.mjs';

const base = { pageLoaded: false, previewBuilt: false, hasSelection: false, changeCount: 0, canUndo: false, canRedo: false, saved: false, hasCss: false };

// nothing loaded: everything that needs a page says so
let r = contextReasons(base);
assert.match(r.build, /Build the preview first/);
assert.strictEqual(r.selection, r.build, 'with no preview, "click something" would be a puzzle: it says build first');
assert.match(r.page, /Load a page first/);
assert.match(r.edits, /Make a change first/);
assert.match(r.css, /no CSS to take away/);
assert.match(r.undo, /Nothing to undo/);
assert.match(r.redo, /not undone anything/);
assert.match(r.saved, /Save the page first/);

// a preview, nothing clicked
r = contextReasons({ ...base, pageLoaded: true, previewBuilt: true });
assert.strictEqual(r.build, undefined);
assert.strictEqual(r.preview, undefined);
assert.match(r.selection, /Click something in the preview/);
assert.strictEqual(r.page, undefined);

// clicked, changed, saved: nothing is held back except redo
r = contextReasons({ pageLoaded: true, previewBuilt: true, hasSelection: true, changeCount: 2, canUndo: true, canRedo: false, saved: true, hasCss: true });
assert.deepStrictEqual(Object.keys(r), ['redo']);

// every menu item's `needs` has an answer: a new kind of need cannot be added without a reason for it
const kinds = new Set(RESTYLE_TOOLS.map((t) => t.needs).filter(Boolean));
const all = contextReasons(base);
for (const k of kinds) assert.ok(all[k], `the need "${k}" has a reason`);
const tool = (id) => RESTYLE_TOOLS.find((t) => t.id === id);
assert.match(toolReason(tool('text'), contextReasons({ ...base, pageLoaded: true, previewBuilt: true })), /Click something/);
assert.strictEqual(toolReason(tool('page'), all), undefined, 'a tool with no need is always open');
assert.match(toolReason(tool('changes'), all), /Make a change first/, 'Changes so far waits for a change');
assert.match(toolReason(tool('session'), all), /Make a change first/);
assert.match(toolReason(tool('source'), all), /Load a page first/);
assert.strictEqual(toolReason(tool('source'), contextReasons({ ...base, pageLoaded: true })), undefined);
assert.strictEqual(toolReason(undefined, all), undefined);

console.log('restyle context tests passed');
