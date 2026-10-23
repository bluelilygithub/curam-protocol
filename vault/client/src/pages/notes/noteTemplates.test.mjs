import assert from 'node:assert';
import { localDay, formatDay, fillTemplate, dailyPayload, DAILY_TEMPLATE, BUILT_IN_TEMPLATES, templateToNote } from './noteTemplates.mjs';

const friday = new Date(2026, 9, 23, 15, 30); // Fri 23 Oct 2026, 3:30 pm local
const morning = new Date(2026, 0, 5, 0, 5);

assert.strictEqual(localDay(friday), '2026-10-23');
assert.strictEqual(localDay(new Date(2026, 9, 23, 23, 59)), '2026-10-23', '11:59 pm is still that day (not UTC)');
assert.strictEqual(localDay(morning), '2026-01-05');
assert.strictEqual(formatDay(friday), 'Fri 23 Oct 2026');
assert.strictEqual(formatDay(morning), 'Mon 5 Jan 2026');

assert.strictEqual(fillTemplate('Meeting, {{date}}', friday), 'Meeting, Fri 23 Oct 2026');
assert.strictEqual(fillTemplate('{{ isodate }} {{weekday}} {{time}}', friday), '2026-10-23 Friday 3:30 pm');
assert.strictEqual(fillTemplate('{{TIME}}', morning), '12:05 am', 'midnight reads 12:05 am');
assert.strictEqual(fillTemplate('noon {{time}}', new Date(2026, 0, 1, 12, 0)), 'noon 12:00 pm');
assert.strictEqual(fillTemplate('keep {{unknown}} and {single}', friday), 'keep {{unknown}} and {single}', 'other braces are left as typed');
assert.strictEqual(fillTemplate(null, friday), '');
assert.strictEqual(fillTemplate('{{date}} and {{date}}', friday), 'Fri 23 Oct 2026 and Fri 23 Oct 2026');

// the daily note: the day it is for, a dated title, a heading and empty to-dos to fill in
const daily = dailyPayload(friday);
assert.strictEqual(daily.date, '2026-10-23');
assert.strictEqual(daily.title, 'Daily note, Fri 23 Oct 2026');
assert.ok(daily.body.startsWith('# Fri 23 Oct 2026\n'));
assert.ok(!daily.body.includes('{{'), 'no placeholder is left in what is sent');
assert.match(DAILY_TEMPLATE.body, /Top 3/);

// built-in templates are all usable: named, hinted, unique, and every placeholder is one we fill
const ids = BUILT_IN_TEMPLATES.map((t) => t.id);
assert.strictEqual(new Set(ids).size, ids.length, 'unique ids');
for (const t of BUILT_IN_TEMPLATES) {
  assert.ok(t.name && t.hint && typeof t.title === 'string' && t.body, `${t.id} is complete`);
  const note = templateToNote(t, friday);
  assert.ok(!/\{\{/.test(note.title + note.body), `${t.id}: nothing left to fill by hand`);
  assert.ok(Array.isArray(note.tags));
  assert.ok(t.name.length <= 60 && t.title.length <= 200 && t.body.length <= 20000, `${t.id} fits what the server accepts`);
}
assert.deepStrictEqual(templateToNote({ title: 'Call with ', body: 'x', tags: ['call'] }, friday), { title: 'Call with ', body: 'x', tags: ['call'] }, 'a title ending in a space is kept so the cursor can continue it');
assert.strictEqual(templateToNote({ title: '', body: '', tags: undefined }, friday).title, 'Untitled');
assert.deepStrictEqual(templateToNote({ title: 'T', body: 'B' }, friday).tags, []);

console.log('ok - note templates: local day, placeholders, built-ins, daily payload');
