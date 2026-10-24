// node client/src/pages/talk/talkTips.test.mjs   (part of npm run test:notes)
// Talk it through follows the same conventions as the other tools: a real tip on every control, every tip used, no native title="".
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TALK_TIPS } from './talkTips.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const files = [path.join(here, '../TalkPage.jsx'), ...fs.readdirSync(here).filter((f) => f.endsWith('.jsx')).map((f) => path.join(here, f))];
const all = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

for (const [key, tip] of Object.entries(TALK_TIPS)) {
  assert.ok(tip.length >= 12 && tip.length <= 260, `${key}: a tip is a short sentence`);
  assert.ok(/^[A-Z]/.test(tip) && /[.!?]$/.test(tip), `${key}: starts with a capital, ends with a full stop`);
  assert.ok(new RegExp(`TALK_TIPS\\.${key}\\b`).test(all), `TALK_TIPS.${key} is written but never used`);
}
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const m of text.matchAll(/\stitle=[{"']/g)) {
    const tag = text.slice(text.lastIndexOf('<', m.index) + 1, m.index).split(/\s/)[0];
    assert.ok(tag === 'ToolInfoModal', `${path.basename(f)}: <${tag}> has a native title="" at ${m.index}; use <Tooltip text={TALK_TIPS.…}>`); // <ToolInfoModal title> is a prop
  }
}
// the (i) box, the tour and the guide, as on the other tools
import { TALK_INTRO, HOW_TALK_WORKS, TALK_NOT } from './talkInfo.mjs';
assert.ok(TALK_INTRO.length > 80 && TALK_NOT.length > 40);
for (const heading of ['Talk', 'Going back and forth', 'The switches', 'Ending it']) assert.ok(HOW_TALK_WORKS.some(([h]) => h === heading), `the info box covers ${heading}`);
assert.ok(HOW_TALK_WORKS.every(([h, t]) => h && t.length > 40), 'each section says something');
const page = fs.readFileSync(path.join(here, '../TalkPage.jsx'), 'utf8');
assert.match(page, /useToolInfoModal\('vault_talk_info_seen'\)/, 'the (i) box opens once, remembered per browser');
assert.match(page, /<ToolInfoModal title="How Talk it through works"/);
assert.match(page, /NotesTutorChat/, 'the Notes guide, which knows Talk it through, is on the page');
assert.match(page, /searchParams\.get\('tour'\)/, 'Settings -> Tours opens /talk?tour=1');
const tour = fs.readFileSync(path.join(here, '../../utils/tours/talkTour.js'), 'utf8');
const targets = [...tour.matchAll(/\[data-tour="([a-z-]+)"\]/g)].map((m) => m[1]);
for (const t of new Set(targets)) assert.ok(page.includes(`data-tour="${t}"`), `the tour points at data-tour="${t}" but nothing on the Talk screen has it`);
const stepCount = (tour.match(/\bstep\('talk-/g) || []).length + (tour.match(/id: 'talk-/g) || []).length;
assert.strictEqual(Number(/const TOTAL_STEPS = (\d+)/.exec(tour)[1]), stepCount, 'the "Step n of N" count matches the steps');
for (let n = 1; n <= stepCount; n++) assert.ok(new RegExp(`injectStepCounter\\(${n}\\)|step\\('talk-[a-z-]+', ${n},`).test(tour), `step ${n} shows its number`);
assert.match(tour, /export const TOUR_KEY = 'vault_tour_talk_completed'/);
const settings = fs.readFileSync(path.join(here, '../SettingsPage.jsx'), 'utf8');
assert.match(settings, /Talk Tour/, 'Settings -> Tours has a Talk card');
assert.match(settings, /navigate\('\/talk\?tour=1'\)/);

console.log('ok - talk follows the tool conventions: a tip on every control, none unused, no native titles');
