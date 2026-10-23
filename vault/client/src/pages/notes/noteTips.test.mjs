// node client/src/pages/notes/noteTips.test.mjs   (part of npm run test:notes)
// Keeps Notes on the same conventions as Video Tools and the other tools: the shared Tooltip on every control (never a native title=""),
// the (i) "How Notes Works" box, the compass tour (with every tour step pointing at something that exists), and the guide chat.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NOTE_TIPS } from './noteTips.mjs';
import { HOW_IT_WORKS, NOTES_INTRO, NOTES_NOT } from './notesInfo.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../..'); // client/src
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');

const notesFiles = ['pages/NotesPage.jsx', ...fs.readdirSync(here).filter((f) => f.endsWith('.jsx')).map((f) => `pages/notes/${f}`)];
const sources = Object.fromEntries(notesFiles.map((f) => [f, read(f)]));
const all = Object.values(sources).join('\n');

// ---- the tips themselves: real sentences, not empty or shouted
const check = (key, tip) => {
  assert.strictEqual(typeof tip, 'string', `${key} is text`);
  assert.ok(tip.length >= 12 && tip.length <= 230, `${key}: a tip is a short sentence (${tip.length} characters)`);
  assert.ok(/^[A-Z"']/.test(tip) || /^[A-Z]/.test(tip.replace(/^[^A-Za-z]+/, '')), `${key}: starts with a capital`);
  assert.ok(/[.!?]$/.test(tip), `${key}: ends with a full stop`);
  assert.ok(!/  |\s$/.test(tip), `${key}: tidy spacing`);
};
for (const [key, value] of Object.entries(NOTE_TIPS)) {
  if (typeof value === 'string') check(key, value);
  else if (typeof value === 'function') { check(`${key}(…)`, value('Fri 24 Oct, 9:00 am', true)); check(`${key}(…, false)`, value('Fri 24 Oct, 9:00 am', false)); }
  else for (const [k, v] of Object.entries(value)) check(`${key}.${k || '(none)'}`, v);
}

// ---- no native tooltips: only the shared Tooltip (a title="" on a button, input, span... is the old way; <ToolInfoModal title> is a prop)
for (const [file, text] of Object.entries(sources)) {
  for (const m of text.matchAll(/\stitle=[{"']/g)) {
    const tag = text.slice(text.lastIndexOf('<', m.index) + 1, m.index).split(/\s/)[0];
    assert.ok(['ToolInfoModal'].includes(tag), `${file}: <${tag}> has a native title="" — wrap it in <Tooltip text={NOTE_TIPS.…}> instead`);
  }
}

// ---- every tip is used (no orphans), and the ones looked up by id are covered
const usesDynamic = /NOTE_TIPS\[id\]/.test(all);
for (const key of Object.keys(NOTE_TIPS)) {
  const used = new RegExp(`NOTE_TIPS\\.${key}\\b`).test(all) || (usesDynamic && (key === 'write' || key === 'preview'));
  assert.ok(used, `NOTE_TIPS.${key} is written but never used`);
}
for (const id of ['date', 'project', 'client', 'tag']) assert.ok(NOTE_TIPS.groupBy[id], `a tip for grouping by ${id}`);

// ---- the tooltip and the page conventions of the other tools
assert.match(sources['pages/NotesPage.jsx'], /import ToolInfoModal, \{ useToolInfoModal \}/, 'the (i) box is the shared ToolInfoModal');
assert.match(sources['pages/NotesPage.jsx'], /useToolInfoModal\('vault_notes_info_seen'\)/, 'it opens once, remembered per browser');
assert.match(sources['pages/NotesPage.jsx'], /<ToolInfoModal title="How Notes Works"/, 'titled like "How Video Tools Works"');
assert.match(sources['pages/NotesPage.jsx'], /NotesTutorChat/, 'the guide chat is on the page');
assert.match(sources['pages/NotesPage.jsx'], /startNotesTour/, 'the tour starts from the page');
assert.match(sources['pages/NotesPage.jsx'], /searchParams\.get\('tour'\)/, 'Settings -> Tours opens /notes?tour=1');
assert.match(sources['pages/notes/NotesListPanel.jsx'], /onInfo/, 'the (i) button is in the header');
assert.match(sources['pages/notes/NotesListPanel.jsx'], /onTour/, 'the compass button is in the header');
assert.match(sources['pages/notes/NotesListPanel.jsx'], /getIcon\('compass'/, 'the compass icon, as on the other tour buttons');
assert.match(sources['pages/notes/NotesListPanel.jsx'], /getIcon\('info'/, 'the info icon, as on the other (i) buttons');
assert.match(read('pages/SettingsPage.jsx'), /Notes Tour/, 'Settings -> Tours has a Notes card');
assert.match(read('pages/SettingsPage.jsx'), /navigate\('\/notes\?tour=1'\)/);
assert.match(read('pages/notes/NotesTutorChat.jsx'), /guideId: 'notes'/, 'the guide is registered as a guide');

// ---- the tour: every step points at something that exists, the count is right, and it is saved as seen
const tour = read('utils/tours/notesTour.js');
const targets = [...tour.matchAll(/\[data-tour="([a-z-]+)"\]/g)].map((m) => m[1]);
assert.ok(targets.length >= 10, 'the tour points at the screen');
for (const t of new Set(targets)) assert.ok(all.includes(`data-tour="${t}"`), `tour step points at data-tour="${t}" but nothing on the Notes screen has it`);
const stepCount = (tour.match(/step\('notes-/g) || []).length + (tour.match(/id: 'notes-/g) || []).length;
assert.strictEqual(Number(/const TOTAL_STEPS = (\d+)/.exec(tour)[1]), stepCount, 'the "Step n of N" count matches the steps');
assert.match(tour, /export const TOUR_KEY = 'vault_tour_notes_completed'/);
assert.match(tour, /localStorage\.setItem\(TOUR_KEY/, 'finishing or skipping is remembered');
for (let n = 1; n <= stepCount; n++) assert.ok(new RegExp(`injectStepCounter\\(${n}\\)|step\\('notes-[a-z-]+', ${n},`).test(tour), `step ${n} shows its number`);

// ---- the info box says what Notes does and what it does not
assert.ok(NOTES_INTRO.length > 80 && NOTES_NOT.length > 40);
for (const heading of ['Write', 'Find', 'Reminders', 'AI actions', 'Ask your notes', 'Recently deleted']) assert.ok(HOW_IT_WORKS.some(([h]) => h === heading), `the info box covers ${heading}`);
assert.ok(HOW_IT_WORKS.every(([h, t]) => h && t.length > 40), 'each section says something');

console.log('ok - notes follows the tool conventions: shared tooltips, (i) box, tour, guide');
