'use strict';

// node server/services/restyle/restyleHistory.test.js   (npm run test:restyle-history). The CSS tool's history of the session
// (client/src/pages/restyle/history.mjs): recording, merging a dragged slider, undo / redo / go to a point, and taking back one entry
// while keeping the later ones.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

const load = (f) => import(pathToFileURL(path.join(__dirname, '../../../client/src/pages/restyle', f)).href);

(async () => {
  const H = await load('history.mjs');
  const E = await load('editModel.mjs');

  const T = (selector, extra = {}) => ({ selector, label: selector, state: '', media: '', ...extra });
  const S0 = { edits: [], tokens: [] };
  const step = (state, target, changes) => ({ edits: E.setProps(state.edits, target, changes), tokens: state.tokens });
  const rec = (h, label, before, after, at, mergeKey = null) => H.record(h, { label, before, after, at, mergeKey });

  // ---- recording ----
  let h = H.emptyHistory();
  const S1 = step(S0, T('.card h2'), [{ prop: 'fontSize', value: '28px', was: '16px' }]);
  h = rec(h, 'Text size', S0, S1, 1000);
  const S2 = step(S1, T('.card h2'), [{ prop: 'color', value: '#111', was: '#bbb' }]);
  h = rec(h, 'Text colour', S1, S2, 2000);
  const S3 = step(S2, T('.button'), [{ prop: 'backgroundColor', value: '#0a5', was: '#c75' }]);
  h = rec(h, 'Button background', S2, S3, 3000);
  assert.strictEqual(h.entries.length, 3);
  assert.strictEqual(h.cursor, 3);
  assert.strictEqual(h.entries[0].changes.length, 1);
  assert.deepStrictEqual(h.entries[0].changes[0].from, null, 'a new property has no earlier value');
  assert.strictEqual(h.entries[0].changes[0].to.value, '28px');
  assert.strictEqual(rec(h, 'No change', S3, S3, 4000), h, 'a change that changes nothing makes no entry');
  assert.ok(H.canUndo(h) && !H.canRedo(h));

  // ---- undo, redo, go to a point ----
  let r = H.undo(h);
  assert.strictEqual(r.history.cursor, 2);
  assert.deepStrictEqual(r.state, S2, 'undo gives the state before the last entry');
  h = r.history;
  assert.ok(H.canRedo(h));
  r = H.redo(h);
  assert.deepStrictEqual(r.state, S3);
  h = r.history;
  assert.strictEqual(H.redo(h), null, 'nothing to go forward to');
  r = H.goTo(h, 0);
  assert.deepStrictEqual(r.state, S0, 'point 0 is the start');
  assert.strictEqual(r.history.cursor, 0);
  assert.strictEqual(r.history.entries.length, 3, 'going back keeps the later entries so they can be gone forward to');
  const atStart = r.history;
  assert.strictEqual(H.undo(atStart), null);
  assert.deepStrictEqual(H.goTo(atStart, 2).state, S2);
  assert.deepStrictEqual(H.goTo(atStart, 3).state, S3);
  assert.strictEqual(H.goTo(atStart, 0), null, 'already there');
  assert.strictEqual(H.goTo(atStart, 4), null);
  assert.strictEqual(H.goTo(H.emptyHistory(), 0), null);

  // ---- a new change after going back starts a new line ----
  const back = H.goTo(h, 1).history;
  const S2b = step(S1, T('.button'), [{ prop: 'padding', value: '4px', was: '8px' }]);
  const branched = rec(back, 'Padding', S1, S2b, 5000);
  assert.strictEqual(branched.entries.length, 2, 'the undone entries are dropped');
  assert.strictEqual(branched.cursor, 2);
  assert.strictEqual(branched.entries[1].label, 'Padding');

  // ---- a dragged slider is one entry ----
  let drag = H.emptyHistory();
  let prev = S0;
  [30, 31, 32, 34, 40].forEach((n, i) => {
    const next = step(S0, T('.card h2'), [{ prop: 'fontSize', value: `${n}px`, was: '16px' }]);
    drag = rec(drag, `Text size ${n}px`, prev, next, 1000 + i * 100, 'size');
    prev = next;
  });
  assert.strictEqual(drag.entries.length, 1, 'changes with one merge key close together are one entry');
  assert.strictEqual(drag.entries[0].label, 'Text size 40px');
  assert.deepStrictEqual(drag.entries[0].before, S0, 'it still goes back to before the drag started');
  assert.strictEqual(drag.entries[0].after.edits[0].props.fontSize.value, '40px');
  const later = rec(drag, 'Text size 20px', prev, step(S0, T('.card h2'), [{ prop: 'fontSize', value: '20px', was: '16px' }]), 1000 + 400 + H.MERGE_WINDOW_MS + 1, 'size');
  assert.strictEqual(later.entries.length, 2, 'the same control a while later is a new entry');
  // dragging back to where it started leaves no entry
  let there = rec(H.emptyHistory(), 'Size 30', S0, step(S0, T('p'), [{ prop: 'fontSize', value: '30px', was: '16px' }]), 1000, 'k');
  there = rec(there, 'Size back', step(S0, T('p'), [{ prop: 'fontSize', value: '30px', was: '16px' }]), S0, 1100, 'k');
  assert.strictEqual(there.entries.length, 0, 'ending where it began is no change at all');
  assert.strictEqual(there.cursor, 0);
  // a different merge key, or none, never merges
  const apart = rec(rec(H.emptyHistory(), 'a', S0, S1, 1000, 'x'), 'b', S1, S2, 1100, 'y');
  assert.strictEqual(apart.entries.length, 2);
  assert.strictEqual(rec(rec(H.emptyHistory(), 'a', S0, S1, 1000), 'b', S1, S2, 1100).entries.length, 2);

  // ---- the cap ----
  let big = H.emptyHistory();
  let s = S0;
  for (let i = 0; i < H.MAX_ENTRIES + 20; i += 1) {
    const next = step(s, T(`.item-${i}`), [{ prop: 'color', value: '#123', was: '#000' }]);
    big = rec(big, `c${i}`, s, next, i * 10000);
    s = next;
  }
  assert.strictEqual(big.entries.length, H.MAX_ENTRIES, 'the oldest entries are dropped past the cap');
  assert.strictEqual(big.entries[0].label, 'c20');
  assert.strictEqual(big.cursor, H.MAX_ENTRIES);

  // ---- take back just one entry, keeping later ones ----
  // entry 0 sized the heading, entry 1 coloured it, entry 2 changed the button; take back entry 1 (the colour) only.
  const rv = H.revertEntry(h, 1, S3);
  assert.strictEqual(rv.reverted, 1);
  assert.deepStrictEqual(rv.kept, []);
  const heading = rv.state.edits.find((e) => e.selector === '.card h2');
  assert.strictEqual(heading.props.fontSize.value, '28px', 'the earlier entry is kept');
  assert.ok(!heading.props.color, 'the colour is taken back');
  assert.strictEqual(rv.state.edits.find((e) => e.selector === '.button').props.backgroundColor.value, '#0a5', 'the later entry is kept');
  // taking back the only property of a rule removes the rule
  assert.ok(!H.revertEntry(h, 2, S3).state.edits.some((e) => e.selector === '.button'));
  // a change that a later entry changed again is kept and reported, not undone
  const S4 = step(S3, T('.card h2'), [{ prop: 'fontSize', value: '40px', was: '16px' }]);
  const h4 = rec(h, 'Text size again', S3, S4, 6000);
  const kept = H.revertEntry(h4, 0, S4);
  assert.strictEqual(kept.reverted, 0);
  assert.deepStrictEqual(kept.kept, ['.card h2: fontSize']);
  assert.strictEqual(kept.state.edits.find((e) => e.selector === '.card h2').props.fontSize.value, '40px');
  // taking back a removal puts the property back; a "previous value" is restored exactly
  const S5 = { edits: E.removeProp(S3.edits, T('.card h2'), 'color'), tokens: [] };
  const h5 = rec(h, 'Took the colour off', S3, S5, 7000);
  const restored = H.revertEntry(h5, 3, S5);
  assert.strictEqual(restored.state.edits.find((e) => e.selector === '.card h2').props.color.value, '#111');
  assert.strictEqual(restored.state.edits.find((e) => e.selector === '.card h2').props.color.was, '#bbb');
  // state and screen size are part of what a change is
  const hover = step(S1, T('.card h2', { state: 'hover' }), [{ prop: 'fontSize', value: '30px', was: '28px' }]);
  const hh = rec(rec(H.emptyHistory(), 'normal', S0, S1, 1000), 'hover', S1, hover, 5000);
  const rh = H.revertEntry(hh, 1, hover);
  assert.strictEqual(rh.state.edits.length, 1, 'only the hover rule goes');
  assert.strictEqual(rh.state.edits[0].state, '');
  // it never changes the state it was given
  const frozen = JSON.stringify(S3);
  H.revertEntry(h, 0, S3);
  assert.strictEqual(JSON.stringify(S3), frozen);

  // ---- brand colours ----
  const tok = { id: 1, kind: 'color', name: 'Main', value: '#cc785c' };
  const withTok = { edits: [], tokens: [tok] };
  let th = rec(H.emptyHistory(), 'Added a brand colour', S0, withTok, 1000);
  assert.strictEqual(th.entries[0].changes[0].kind, 'token');
  assert.strictEqual(H.revertEntry(th, 0, withTok).state.tokens.length, 0, 'an added brand colour can be taken back');
  const recoloured = { edits: [], tokens: [{ ...tok, value: '#00aa55' }] };
  th = rec(th, 'Changed it', withTok, recoloured, 9000);
  assert.strictEqual(H.revertEntry(th, 1, recoloured).state.tokens[0].value, '#cc785c');
  const used = { edits: E.setProps([], T('h1'), [{ prop: 'color', value: E.tokenRef(tok), was: '' }]), tokens: [tok] };
  const usedH = rec(rec(H.emptyHistory(), 'Added', S0, withTok, 1000), 'Used it', withTok, used, 9000);
  const blocked = H.revertEntry(usedH, 0, used);
  assert.strictEqual(blocked.reverted, 0, 'a brand colour that something still uses is not taken away');
  assert.match(blocked.kept[0], /brand colour Main/);
  const removed = { edits: [], tokens: [] };
  const rmH = rec(rec(H.emptyHistory(), 'Added', S0, withTok, 1000), 'Removed', withTok, removed, 9000);
  assert.strictEqual(H.revertEntry(rmH, 1, removed).state.tokens[0].name, 'Main', 'a removed brand colour can be brought back');

  console.log('restyle history tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
