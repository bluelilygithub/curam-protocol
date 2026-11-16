// node client/src/pages/translate/translateGoals.test.mjs
import assert from 'node:assert';
import { TRANSLATE_GOALS, resolvePreset } from './translateGoals.mjs';
import { TRANSLATE_TOOLS, LAYOUT_OPTIONS } from './translateTools.mjs';
import { LANGUAGES } from '../../utils/translateLanguages.js';

const toolIds = TRANSLATE_TOOLS.map((t) => t.id);
const layouts = LAYOUT_OPTIONS.map((l) => l.v);
const langs = LANGUAGES.map((l) => l.code);

assert.strictEqual(new Set(TRANSLATE_GOALS.map((g) => g.id)).size, TRANSLATE_GOALS.length, 'job ids are unique');
for (const g of TRANSLATE_GOALS) {
  assert.ok(g.title && g.blurb && g.icon, `${g.id} has a title, a blurb and an icon`);
  assert.ok(g.steps.length >= 2, `${g.id} has steps`);
  for (const s of g.steps) {
    assert.ok(toolIds.includes(s.tool), `${g.id}: step "${s.tool}" is a real screen`);
    assert.ok(s.note, `${g.id}: step "${s.tool}" says what to do`);
  }
  assert.strictEqual(new Set(g.steps.map((s) => s.tool)).size, g.steps.length, `${g.id}: no screen twice (the step bar keys on it)`);
  assert.ok(g.steps.some((s) => s.tool === 'new'), `${g.id} goes through New translation`);
  assert.ok(['llm', 'google'].includes(g.preset.engine), `${g.id}: a real translator`);
  assert.ok(layouts.includes(g.preset.layout), `${g.id}: a layout the form offers`);
  assert.strictEqual(typeof g.preset.review, 'boolean', `${g.id}: the second check is on or off`);
  if (g.preset.targetLang) assert.ok(langs.includes(g.preset.targetLang), `${g.id}: a real language`);
}

// Google is not set up: the fast job still runs, on Vault AI, and says so.
let p = resolvePreset({ engine: 'google', review: false }, { llm: true, google: false });
assert.deepStrictEqual({ e: p.engine, f: p.fellBack }, { e: 'llm', f: true });
p = resolvePreset({ engine: 'google', review: false }, { llm: true, google: true });
assert.deepStrictEqual({ e: p.engine, f: p.fellBack }, { e: 'google', f: undefined });
// Only Google is set up: a careful job runs on Google without the second check.
p = resolvePreset({ engine: 'llm', review: true }, { llm: false, google: true });
assert.deepStrictEqual({ e: p.engine, r: p.review, f: p.fellBack }, { e: 'google', r: false, f: true });

console.log('translateGoals tests passed');
