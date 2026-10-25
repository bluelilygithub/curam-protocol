// node client/src/pages/graphics/adjustHistory.test.mjs   (npm run test:graphics-adjust-history)
import assert from 'assert';
import { ADJUST_DEFAULTS, initialHistory, reducer, valuesOf, canUndo, canRedo, describeSteps, MAX_STEPS } from './adjustHistory.mjs';

const run = (...actions) => actions.reduce((s, a) => reducer(s, a), initialHistory());
const change = (key, value, label) => ({ type: 'change', sets: { [key]: value }, label });
const on = (s) => s.steps.map((x) => x.on);

// ── steps build up in order ─────────────────────────────────────────────────────────────
let s = run(change('brightness', 1.3), change('contrast', 1.2), change('hue', 40));
assert.strictEqual(s.steps.length, 3);
assert.deepStrictEqual(valuesOf(s), { ...ADJUST_DEFAULTS, brightness: 1.3, contrast: 1.2, hue: 40 });
assert.deepStrictEqual(valuesOf(initialHistory()), ADJUST_DEFAULTS);

// a change that changes nothing, or is not a setting / number, is not a step
assert.strictEqual(run(change('brightness', 1)).steps.length, 0);
assert.strictEqual(run(change('nonsense', 5)).steps.length, 0);
assert.strictEqual(run(change('brightness', 'abc')).steps.length, 0);
assert.strictEqual(reducer(s, change('hue', 40)), s, 'setting the same value again adds no step');

// ── take ONE step out without undoing the ones after it ─────────────────────────────────
const middle = s.steps[1].id; // contrast
let t = reducer(s, { type: 'toggle', id: middle });
assert.deepStrictEqual(on(t), [true, false, true]);
assert.deepStrictEqual(valuesOf(t), { ...ADJUST_DEFAULTS, brightness: 1.3, hue: 40 }, 'contrast is back to normal; brightness and hue stay');
t = reducer(t, { type: 'toggle', id: middle }); // and back on
assert.deepStrictEqual(valuesOf(t), valuesOf(s));

// the same setting changed twice: taking out the later step shows the earlier value, taking out the earlier one keeps the later
let twice = run(change('brightness', 1.2), change('brightness', 1.6));
assert.strictEqual(valuesOf(reducer(twice, { type: 'toggle', id: twice.steps[1].id })).brightness, 1.2);
assert.strictEqual(valuesOf(reducer(twice, { type: 'toggle', id: twice.steps[0].id })).brightness, 1.6);

// ── undo / redo walk the ticked steps ───────────────────────────────────────────────────
assert.ok(canUndo(s) && !canRedo(s));
let u = reducer(s, { type: 'undo' });
assert.deepStrictEqual(on(u), [true, true, false]);
assert.ok(canRedo(u));
u = reducer(reducer(u, { type: 'undo' }), { type: 'undo' });
assert.deepStrictEqual(valuesOf(u), ADJUST_DEFAULTS);
assert.ok(!canUndo(u));
assert.strictEqual(reducer(u, { type: 'undo' }), u, 'nothing left to undo');
u = reducer(u, { type: 'redo' });
assert.deepStrictEqual(on(u), [true, false, false]);
u = reducer(reducer(u, { type: 'redo' }), { type: 'redo' });
assert.deepStrictEqual(on(u), [true, true, true]);
assert.strictEqual(reducer(u, { type: 'redo' }), u, 'nothing left to redo');

// redo does not jump over an untick made in the middle: it ticks the next one after the last ticked step
let gap = reducer(s, { type: 'toggle', id: s.steps[1].id }); // [on, off, on]
gap = reducer(gap, { type: 'undo' }); // [on, off, off]
gap = reducer(gap, { type: 'redo' });
assert.deepStrictEqual(on(gap), [true, true, false], 'redo ticks the next unticked step after the last ticked one');

// ── go back to a step ───────────────────────────────────────────────────────────────────
const back = reducer(s, { type: 'backTo', id: s.steps[0].id });
assert.deepStrictEqual(on(back), [true, false, false]);
assert.deepStrictEqual(valuesOf(back), { ...ADJUST_DEFAULTS, brightness: 1.3 });
assert.strictEqual(reducer(s, { type: 'backTo', id: 999 }), s);
// and the steps after it can be brought back one at a time
assert.deepStrictEqual(on(reducer(back, { type: 'redo' })), [true, true, false]);

// ── a new change after undo drops the redo tail, but keeps an earlier untick ────────────
let branch = reducer(s, { type: 'undo' }); // [on, on, off]  (hue is the tail)
branch = reducer(branch, change('saturation', 1.5));
assert.strictEqual(branch.steps.length, 3);
assert.ok(!branch.steps.some((x) => x.sets.hue), 'the old tail (hue) is gone');
let keepOff = reducer(s, { type: 'toggle', id: s.steps[0].id }); // [off, on, on]
keepOff = reducer(keepOff, change('blur', 3));
assert.deepStrictEqual(on(keepOff), [false, true, true, true], 'an untick before a ticked step stays');

// ── preset and reset are steps too, and undoable ────────────────────────────────────────
let p = run(change('brightness', 1.4), { type: 'change', sets: { contrast: 1.1, saturation: 0.8, hue: 10 }, label: 'Preset: Warm' });
assert.strictEqual(describeSteps(p, {}, {})[1].text, 'Preset: Warm');
let r = reducer(p, { type: 'change', sets: ADJUST_DEFAULTS, label: 'Reset everything' });
assert.deepStrictEqual(valuesOf(r), ADJUST_DEFAULTS);
r = reducer(r, { type: 'undo' });
assert.strictEqual(valuesOf(r).brightness, 1.4, 'Reset can be undone');
// resetting when everything is already normal adds nothing
assert.strictEqual(reducer(initialHistory(), { type: 'change', sets: ADJUST_DEFAULTS, label: 'Reset everything' }).steps.length, 0);

// ── how a step reads ────────────────────────────────────────────────────────────────────
const labels = { brightness: 'Brightness', contrast: 'Contrast' };
const format = { brightness: (v) => Number(v).toFixed(2) };
const d = describeSteps(run(change('brightness', 1.25), change('brightness', 1.5), change('contrast', 1.1)), labels, format);
assert.deepStrictEqual(d.map((x) => x.text), ['Brightness: 1.00 → 1.25', 'Brightness: 1.25 → 1.50', 'Contrast: 1 → 1.1']);
// the "from" counts only ticked steps before it
const dd = describeSteps(reducer(run(change('brightness', 1.25), change('brightness', 1.5)), { type: 'toggle', id: 1 }), labels, format);
assert.strictEqual(dd[1].text, 'Brightness: 1.00 → 1.50');
assert.strictEqual(dd[0].on, false);
assert.strictEqual(describeSteps({ steps: [{ id: 1, on: true, sets: { hue: 1, blur: 2 }, label: null }], nextId: 2 }, {}, {})[0].text, '2 settings changed');

// ── a new picture starts over; the list cannot grow without end ─────────────────────────
assert.deepStrictEqual(reducer(s, { type: 'clear' }), initialHistory());
let many = initialHistory();
for (let i = 0; i < MAX_STEPS + 30; i += 1) many = reducer(many, change('brightness', 0.3 + ((i % 100) + 1) * 0.01 + (i >= 100 ? 0.0001 : 0)));
assert.ok(many.steps.length <= MAX_STEPS);

console.log('adjust history: ok');
