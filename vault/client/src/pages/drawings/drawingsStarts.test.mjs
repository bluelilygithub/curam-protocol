// node client/src/pages/drawings/drawingsStarts.test.mjs
import assert from 'node:assert';
import { STARTS, ACTIONS } from './drawingsStarts.mjs';
import { TEMPLATES } from './diagramTemplates.mjs';
import { semanticMap } from '../../providers/iconMap.js';

const ids = new Set();
for (const s of STARTS) {
  assert.ok(!ids.has(s.id), `unique id ${s.id}`); ids.add(s.id);
  assert.ok(ACTIONS.includes(s.action), `${s.id} has a known action`);
  assert.ok(s.title && s.blurb, `${s.id} has words`);
  assert.ok(semanticMap[s.icon], `${s.id} icon ${s.icon} exists`);
  if (s.action === 'template') assert.ok(TEMPLATES.some((t) => t.id === s.template), `${s.id} names a real template`);
}
console.log(`drawingsStarts: ${STARTS.length} cards ok`);
