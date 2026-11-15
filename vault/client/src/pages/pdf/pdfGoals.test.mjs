// node client/src/pages/pdf/pdfGoals.test.mjs
// Every PDF Tools job step must name a tool that really exists in MODES (PdfPage.jsx).
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PDF_GOALS } from './pdfGoals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, '..', 'PdfPage.jsx'), 'utf8');
const start = page.indexOf('const MODES = [');
const block = page.slice(start, page.indexOf('\n];', start));
const tools = new Set([...block.matchAll(/\{ id: '([a-z0-9]+)',/g)].map((m) => m[1]));
assert.ok(tools.size > 25, `could not read MODES from PdfPage.jsx (${tools.size})`);

const iconMap = fs.readFileSync(path.join(here, '..', '..', 'providers', 'iconMap.js'), 'utf8');

const ids = new Set();
for (const g of PDF_GOALS) {
  assert.ok(g.id && g.title && g.blurb && g.icon, `job ${g.id} needs id, title, blurb, icon`);
  assert.ok(new RegExp(`^\\s*'?${g.icon}'?:`, 'm').test(iconMap), `job ${g.id}: icon "${g.icon}" is not in iconMap.js`);
  assert.ok(!ids.has(g.id), `duplicate job id ${g.id}`);
  ids.add(g.id);
  assert.ok(g.steps.length >= 2, `job ${g.id} needs at least two steps`);
  const seen = new Set();
  for (const s of g.steps) {
    assert.ok(tools.has(s.tool), `job ${g.id}: "${s.tool}" is not a tool in MODES`);
    assert.ok(s.note && s.note.length < 90, `job ${g.id}: step ${s.tool} needs a short note`);
    assert.ok(!seen.has(s.tool), `job ${g.id}: ${s.tool} appears twice`);
    seen.add(s.tool);
  }
}
console.log(`pdf goals: ok (${PDF_GOALS.length} jobs, ${tools.size} tools)`);
