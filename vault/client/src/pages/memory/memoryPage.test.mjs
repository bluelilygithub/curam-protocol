// node client/src/pages/memory/memoryPage.test.mjs
// The Memory page keeps the help every Vault tool has (see docs/guide-chat.md): a Tooltip on each control, no browser pop-ups or native title tooltips, the
// (i) box, the guided tour, the microphone on the text boxes, and the round guide button. Reads the page source (no browser needed).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { GUIDE_TOOLS, HOW_IT_WORKS, MEMORY_TOOLS, TOOL_TIPS, TOOL_BLURBS, GROUPS, GROUP_TIPS } from './memoryTools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, '../MemoryPage.jsx'), 'utf8');
const tour = fs.readFileSync(path.join(here, '../../utils/tours/memoryTour.js'), 'utf8');

// no native browser pop-up and no native title="" tooltip (the shared Tooltip is used instead)
assert.ok(!/window\.confirm|window\.alert|\balert\(/.test(page), 'no browser pop-up: a delete asks Yes / No on the row');
assert.ok(!/\btitle="/.test(page.replace(/<Section title=/g, '').replace(/<ToolInfoModal title=/g, '')), 'no native title="" tooltips');

// every control has a Tooltip: buttons and the two text boxes
const buttons = (page.match(/<button\b/g) || []).length;
const tooltips = (page.match(/<Tooltip\b/g) || []).length;
assert.ok(tooltips >= buttons, `a Tooltip for every button (${tooltips} tooltips, ${buttons} buttons)`);
assert.equal((page.match(/<VoiceInput\b/g) || []).length, 2, 'the microphone on both text boxes (Add a memory and Search memories)');
assert.match(page, /<VoiceInputProvider/, 'the microphone provider wraps the page');
for (const label of ['A fact to remember', 'Search your memories']) assert.ok(page.includes(`label="${label}"`), `${label} box is labelled`);

// the (i) box, the tour, the guide
assert.match(page, /ToolInfoModal/);
assert.match(page, /useToolInfoModal\('vault_memory_info_seen'\)/);
assert.match(page, /HOW_IT_WORKS\.map/);
assert.match(page, /startMemoryTour/);
assert.match(page, /params\.get\('tour'\)/, '/memory?tour=1 starts the tour (the Settings -> Tours button uses it)');
assert.match(page, /<MemoryTutorChat currentTool="memory" onOpenTool=\{openToolById\}/);
assert.match(page, /aria-label="How Memory works"/);

// every part the guide can point at is marked on the page
for (const g of GUIDE_TOOLS) {
  const marked = new RegExp(`data-guide="${g.id}"|guide="${g.id}"`).test(page);
  assert.ok(marked, `the page marks "${g.id}" so the guide's Open button has somewhere to go`);
}

// every tour step points at something the page marks
const selectors = [...tour.matchAll(/data-tour="([^"]+)"/g)].map((m) => m[1]);
assert.ok(selectors.length >= 5, 'the tour points at parts of the page');
for (const sel of new Set(selectors)) assert.match(page, new RegExp(`data-tour=(?:"${sel}"|\\{[^}]*'${sel}')|tour="${sel}"`), `the page marks data-tour "${sel}"`);
assert.match(tour, /TOTAL_STEPS = 6/);
assert.equal((tour.match(/tour\.addStep\(/g) || []).length, 6, 'six steps, as the counter says');
assert.match(tour, /vault_tour_memory_completed/);

// the words on the page tell the truth: Chat does not save memories, and delete is permanent
assert.ok(!/tell Claude in chat to remember/i.test(page), 'the page does not claim Chat saves memories');
assert.match(page, /Chat reads them but does not save new ones/);
const how = HOW_IT_WORKS.flat().join(' ');
assert.match(how, /Chat reads your memories but does not save new ones/);
assert.match(how, /does not go to the recycle bin/);
assert.ok(HOW_IT_WORKS.length >= 5);

// the shared tool lists are complete
for (const t of MEMORY_TOOLS) { assert.ok(TOOL_TIPS[t.id] && TOOL_BLURBS[t.id] && GROUPS.includes(t.group)); }
for (const g of GROUPS) assert.ok(GROUP_TIPS[g]);

console.log('memoryPage.test.mjs: all passed');
