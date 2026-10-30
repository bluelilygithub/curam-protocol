// node client/src/pages/emailFollowUp/efTips.test.mjs   (part of npm run test:email-follow-up)
// Keeps Email Follow-Up on the same conventions as Notes and Video Tools: the shared Tooltip on every control (never a native title=""),
// the (i) "How Email Follow-Up Works" box, the compass tour (every tour step pointing at something that exists), the guide chat, the
// microphone on free-text fields, and the Settings tour card.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EF_TIPS } from './efTips.mjs';
import { HOW_IT_WORKS } from './emailFollowUpTools.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '../..'); // client/src
const read = (p) => fs.readFileSync(path.join(src, p), 'utf8');
const files = ['pages/EmailFollowUpPage.jsx', 'pages/emailFollowUp/CaseView.jsx', 'components/LinkedEmailFollowUp.jsx'];
const sources = Object.fromEntries(files.map((f) => [f, read(f)]));

// ---- the tips themselves: real sentences
const check = (key, tip) => {
  assert.strictEqual(typeof tip, 'string', `${key} is text`);
  assert.ok(tip.length >= 12 && tip.length <= 230, `${key}: a tip is a short sentence (${tip.length} characters)`);
  assert.ok(/^[A-Z"']/.test(tip), `${key}: starts with a capital`);
  assert.ok(/[.!?]$/.test(tip), `${key}: ends with a full stop`);
  assert.ok(!/  |\s$/.test(tip), `${key}: tidy spacing`);
};
for (const [key, value] of Object.entries(EF_TIPS)) {
  if (typeof value === 'function') { check(`${key}(0)`, value(0)); check(`${key}(1)`, value(1)); check(`${key}(3)`, value(3)); } else check(key, value);
}
for (const [h, t] of HOW_IT_WORKS) assert.ok(h && t.length > 30, `(i) box paragraph "${h}" has text`);

// ---- every EF_TIPS.x used on the page exists
for (const [file, text] of Object.entries(sources)) {
  for (const m of text.matchAll(/EF_TIPS\.([A-Za-z]+)/g)) assert.ok(m[1] in EF_TIPS, `${file}: EF_TIPS.${m[1]} does not exist`);
}

// ---- no native tooltips (only <ToolInfoModal title> is a prop)
for (const [file, text] of Object.entries(sources)) {
  for (const m of text.matchAll(/\stitle=[{"']/g)) {
    const tag = text.slice(text.lastIndexOf('<', m.index) + 1, m.index).split(/\s/)[0];
    assert.ok(['ToolInfoModal'].includes(tag), `${file}: <${tag}> has a native title="" — wrap it in <Tooltip text={EF_TIPS.…}> instead`);
  }
}

// ---- every Btn has a tip; every button, input, select and mic field sits inside a Tooltip
const insideTooltip = (text, index) => text.lastIndexOf('<Tooltip', index) > text.lastIndexOf('</Tooltip>', index);
const tagAt = (text, index) => text.slice(index, text.indexOf('>', index) + 1);
for (const [file, text] of Object.entries(sources)) {
  for (const m of text.matchAll(/<Btn\b/g)) {
    const chunk = text.slice(m.index, m.index + 600).split('</Btn>')[0];
    assert.ok(/tip=/.test(chunk), `${file}: a <Btn> near "${chunk.slice(0, 70).replace(/\s+/g, ' ')}" has no tip`);
  }
  for (const re of [/<button\b/g, /<input\b/g, /<select\b/g]) {
    for (const m of text.matchAll(re)) {
      if (file.endsWith('CaseView.jsx') && text.slice(Math.max(0, m.index - 140), m.index).includes('<Tooltip text={tip}>')) continue; // the Btn helper itself
      assert.ok(insideTooltip(text, m.index), `${file}: ${tagAt(text, m.index).slice(0, 80)} is not inside a <Tooltip>`);
    }
  }
  for (const m of text.matchAll(/<VoiceInput\b/g)) assert.ok(insideTooltip(text, m.index), `${file}: a <VoiceInput> is not inside a <Tooltip>`);
}

// ---- the mic: free-text fields use VoiceInput, inside a provider; email-address boxes stay typed (a spoken address is too error-prone)
const page = sources['pages/EmailFollowUpPage.jsx'];
const caseView = sources['pages/emailFollowUp/CaseView.jsx'];
assert.ok(page.includes('<VoiceInputProvider'), 'the page provides the microphone');
assert.ok((page.match(/<VoiceInput\b/g) || []).length >= 2, 'case name and obligation have a microphone');
assert.ok((caseView.match(/<VoiceInput\b/g) || []).length >= 3, 'notes, quote and subject have a microphone');

// ---- the (i) box, the tour and the guide
assert.ok(page.includes('useToolInfoModal(') && page.includes('<ToolInfoModal'), 'the (i) box is wired');
assert.ok(page.includes('startEmailFollowUpTour') && page.includes("getIcon('compass'"), 'the compass tour button is wired');
assert.ok(page.includes('<EmailFollowUpTutorChat'), 'the guide chat is on the page');

// ---- every tour step points at something that exists, and the Settings card retakes it
const tour = read('utils/tours/emailFollowUpTour.js');
const all = Object.values(sources).join('\n');
for (const m of tour.matchAll(/\[data-tour="([a-z-]+)"\]/g)) assert.ok(all.includes(`data-tour="${m[1]}"`), `tour step points at data-tour="${m[1]}" which is not on the page`);
for (const m of tour.matchAll(/TOTAL_STEPS = (\d+)/g)) assert.strictEqual((tour.match(/tour\.addStep\(/g) || []).length, Number(m[1]), 'TOTAL_STEPS matches the steps');
const settings = read('pages/SettingsPage.jsx');
assert.ok(settings.includes('emailFollowUpTour') && settings.includes('/email-follow-up?tour=1'), 'Settings has an Email Follow-Up Tour card');

// ---- the guide's Open buttons: every place the guide can show exists on the page
for (const place of ['cases', 'ledger', 'mail', 'drafts', 'coverage']) {
  assert.ok(place === 'cases' ? page.includes('data-guide="cases"') : (caseView.includes(`data-guide="${place}"`) || place === 'mail'), `the page marks data-guide="${place}"`);
}
console.log('email-follow-up tips/helpers: passed');
