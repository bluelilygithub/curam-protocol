// node client/src/pages/guitar/guitarTips.test.mjs
// Keeps Guitar on the same conventions as Finance, Video Tools and Email Follow-Up: the shared Tooltip on every control (never a native
// title=""), the (i) "How Guitar Works" box, the compass tour (every step pointing at something the page marks), the guide chat and the
// Settings tour card. Controls inside the two small dialogs (CorrectionModal, PracticeDialog) are labelled in words and are left out,
// because a tooltip sits below a dialog.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GT, ADD_TIPS, FOCUS_TIPS, tabTip } from './guitarTips.mjs';
import { HOW_IT_WORKS, GUITAR_TOOLS, GUIDE_TOOLS } from './guitarTools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../..'); // client/src
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');

// ---- the tips themselves: real sentences
for (const [key, tip] of Object.entries(GT)) {
  assert.strictEqual(typeof tip, 'string', `${key} is text`);
  assert.ok(tip.length >= 12 && tip.length <= 230, `${key}: a tip is a short sentence (${tip.length} characters)`);
  assert.ok(/^[A-Z"']/.test(tip), `${key}: starts with a capital`);
  assert.ok(/[.!?]$/.test(tip), `${key}: ends with a full stop`);
  assert.ok(!/  |\s$/.test(tip), `${key}: tidy spacing`);
}
for (const tab of ['Coach', 'Drills', 'Strum', 'Library']) assert.ok(tabTip(tab), `tab ${tab} has a tip`);
for (const [k, tip] of Object.entries(FOCUS_TIPS)) assert.ok(/^[A-Z].*\.$/.test(tip), `focus tip ${k} is a sentence`);
for (const id of ['ug', 'upload', 'manual']) assert.ok(ADD_TIPS[id], `add mode ${id} has a tip`);
for (const [h, t] of HOW_IT_WORKS) assert.ok(h && t.length > 30, `(i) box paragraph "${h}" has text`);

// ---- no component shares its name with a logic module (EarTraining.jsx and earTraining.mjs). On a case-insensitive disk (Windows, Mac)
// `import X from './EarTraining'` then picks the .mjs and the page goes blank, while Linux (the server) would have worked.
{
  const seen = new Map();
  for (const f of fs.readdirSync(here)) {
    const stem = f.replace(/\.(test\.)?(m?js|jsx)$/, '').toLowerCase();
    if (f.includes('.test.')) continue;
    assert.ok(!seen.has(stem), `${f} and ${seen.get(stem)} have the same name apart from capitals or the extension: rename one`);
    seen.set(stem, f);
  }
}

const files = ['pages/GuitarPage.jsx', 'pages/guitar/CoachView.jsx', 'pages/guitar/SimplifyPanel.jsx', 'pages/guitar/StrumTrainer.jsx', 'pages/guitar/FingerpickLadder.jsx', 'pages/guitar/GapClick.jsx', 'pages/guitar/BandPanel.jsx', 'pages/guitar/GlossaryTerm.jsx', 'pages/guitar/GlossaryList.jsx', 'pages/guitar/FingerMoves.jsx', 'pages/guitar/MajorMinorPairs.jsx', 'pages/guitar/BarreLadder.jsx', 'pages/guitar/SingAlong.jsx', 'pages/guitar/SetLists.jsx', 'pages/guitar/GigMode.jsx', 'pages/guitar/TheoryPanel.jsx', 'pages/guitar/TempoTrainer.jsx', 'pages/guitar/TransitionDrills.jsx'];
const sources = Object.fromEntries(files.map((f) => [f, read(f)]));

// Take the two dialogs out of the page text
const withoutDialogs = (text) => {
  let out = text;
  for (const name of ['CorrectionModal', 'PracticeDialog']) {
    const a = out.indexOf(`function ${name}(`);
    if (a === -1) continue;
    const next = [...out.slice(a + 10).matchAll(/\n(?:function |const [A-Z_]+ = |\/\*\* |export default)/g)][0];
    const b = next ? a + 10 + next.index : out.length;
    out = out.slice(0, a) + out.slice(b);
  }
  return out;
};

// ---- every GT.x used on a page exists
for (const [file, text] of Object.entries(sources)) {
  for (const m of text.matchAll(/\bGT\.([A-Za-z]+)/g)) assert.ok(m[1] in GT, `${file}: GT.${m[1]} does not exist`);
}

// ---- no native tooltips (title is a prop only on Dialog and ToolInfoModal)
for (const [file, text] of Object.entries(sources)) {
  for (const m of text.matchAll(/\stitle=[{"']/g)) {
    const tag = text.slice(text.lastIndexOf('<', m.index) + 1, m.index).split(/\s/)[0];
    assert.ok(['Dialog', 'ToolInfoModal'].includes(tag), `${file}: <${tag}> has a native title="" — wrap it in <Tooltip text={GT.…}> instead`);
  }
}

// ---- every button, input, select and textarea sits inside a Tooltip
const insideTooltip = (text, index) => text.lastIndexOf('<Tooltip', index) > text.lastIndexOf('</Tooltip>', index);
for (const [file, full] of Object.entries(sources)) {
  const text = withoutDialogs(full);
  for (const m of text.matchAll(/<(button|input|select|textarea)\b/g)) {
    const tag = text.slice(m.index, text.indexOf('>', m.index) + 1).replace(/\s+/g, ' ').slice(0, 90);
    assert.ok(insideTooltip(text, m.index), `${file}: no tooltip on ${tag}`);
  }
}

// ---- the header: title, (i) box, compass tour, and the guide chat
const page = sources['pages/GuitarPage.jsx'];
assert.match(page, /<h1[^>]*>Guitar<\/h1>/, 'the page has its title');
assert.match(page, /How Guitar Works/, 'the (i) box is titled with the app name');
assert.match(page, /useToolInfoModal\('vault_guitar_info_seen'\)/);
assert.match(page, /startGuitarTour\(/);
assert.match(page, /<GuitarTutorChat\b/);

// ---- every tour step points at something the page marks (or is a centred step)
const tour = read('utils/tours/guitarTour.js');
const marks = [...tour.matchAll(/\[data-tour="([a-z-]+)"\]/g)].map((m) => m[1]);
assert.ok(marks.length >= 6, 'the tour points at several parts of the page');
const everything = Object.values(sources).join(' ');
for (const mark of new Set(marks)) assert.ok(everything.includes(`data-tour="${mark}"`), `the page marks data-tour="${mark}"`);
assert.match(tour, /Guitar — Quick Tour/, 'the tour is titled with the app name');
assert.match(tour, new RegExp(`TOTAL_STEPS = ${(tour.match(/tour\.addStep\(/g) || []).length}`), 'the step counter matches the number of steps');

// ---- the Open buttons switch to a real tab
const tabNames = GUITAR_TOOLS.map((t) => t.tab);
for (const t of tabNames) assert.ok(new RegExp(`'${t}'`).test(page), `the page has a ${t} tab`);
assert.ok(GUIDE_TOOLS.every((g) => GUITAR_TOOLS.some((t) => t.id === g.tool)), 'every guide control opens a real tab');

// ---- Settings has the tour card
const settings = read('pages/SettingsPage.jsx');
assert.match(settings, /Guitar Tour/);
assert.match(settings, /navigate\('\/guitar\?tour=1'\)/);

console.log('guitarTips tests passed');
