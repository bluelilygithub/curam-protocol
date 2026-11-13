// node client/src/pages/videos/videoGoals.test.mjs
// Every Video Tools job step must name a tool that really exists in TOOL_GROUPS (and is not a link to another page).
import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VIDEO_GOALS } from './videoGoals.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, '..', 'VideosPage.jsx'), 'utf8');
const start = page.indexOf('const TOOL_GROUPS = [');
const block = page.slice(start, page.indexOf('\n];', start));
const tools = new Set([...block.matchAll(/\{ id: '([a-z0-9-]+)', label: '[^']+', desc: '[^']*'( \}|,)/g)].filter((m) => !m[0].includes('link')).map((m) => m[1]));
const links = new Set([...block.matchAll(/\{ id: '([a-z0-9-]+)'[^\n]*link:/g)].map((m) => m[1]));
assert.ok(tools.size > 25, `could not read TOOL_GROUPS from VideosPage.jsx (${tools.size})`);

const ids = new Set();
for (const g of VIDEO_GOALS) {
  assert.ok(g.id && g.title && g.blurb && g.icon, `job ${g.id} needs id, title, blurb, icon`);
  assert.ok(!ids.has(g.id), `duplicate job id ${g.id}`);
  ids.add(g.id);
  assert.ok(g.steps.length >= 2, `job ${g.id} needs at least two steps`);
  const seen = new Set();
  for (const s of g.steps) {
    assert.ok(!links.has(s.tool), `job ${g.id}: "${s.tool}" opens another page, it cannot be a step`);
    assert.ok(tools.has(s.tool), `job ${g.id}: "${s.tool}" is not a tool in TOOL_GROUPS`);
    assert.ok(s.note && s.note.length < 90, `job ${g.id}: step ${s.tool} needs a short note`);
    assert.ok(!seen.has(s.tool), `job ${g.id}: ${s.tool} appears twice`);
    seen.add(s.tool);
  }
}
console.log(`video goals: ok (${VIDEO_GOALS.length} jobs, ${tools.size} tools)`);
