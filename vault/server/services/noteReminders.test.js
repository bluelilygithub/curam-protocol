'use strict';

// node server/services/noteReminders.test.js   (part of npm run test:notes). No database, no mail server.

const assert = require('assert');
const { advanceRepeating, ReminderError, parseRemindAt, buildReminderEmail, runNoteReminders, MAX_EMAIL_AGE_MS } = require('./noteReminders');

(async () => {
  const now = new Date('2026-10-23T05:00:00.000Z');
  const iso = (ms) => new Date(now.getTime() + ms).toISOString();

  // the time a reminder may have
  assert.strictEqual(parseRemindAt(iso(3600 * 1000), now).toISOString(), iso(3600 * 1000));
  assert.strictEqual(parseRemindAt(iso(-30 * 1000), now).getTime(), now.getTime() - 30 * 1000, 'half a minute behind is tolerated');
  for (const [bad, re] of [
    [iso(-5 * 60 * 1000), /future/], [iso(6 * 365 * 24 * 3600 * 1000), /five years/], ['not a date', /could not be read/], ['', /Pick a date/], [null, /Pick a date/], [12345, /Pick a date/],
  ]) assert.throws(() => parseRemindAt(bad, now), (e) => e instanceof ReminderError && e.status === 400 && re.test(e.message), String(bad));

  // the email: escaped, linked, and readable for an untitled note
  const mail = buildReminderEmail({ id: 42, title: 'Call <b>Sam</b> & "co"', body: 'Ring about the quote.\n\nThen <script>x</script> follow up.', appUrl: 'https://vault.example.com/' });
  assert.strictEqual(mail.subject, 'Reminder: Call <b>Sam</b> & "co"', 'the subject is plain text, not HTML');
  assert.ok(!/<b>Sam<\/b>|<script>/.test(mail.html), 'nothing from the note is left as live HTML');
  assert.ok(mail.html.includes('Call &lt;b&gt;Sam&lt;/b&gt; &amp; &quot;co&quot;'));
  assert.ok(mail.html.includes('href="https://vault.example.com/notes?note=42"'), 'one slash between the address and the path');
  assert.strictEqual(buildReminderEmail({ id: 1, title: 'Untitled', body: '', appUrl: 'http://x' }).subject, 'Reminder: a note of yours');
  assert.ok(buildReminderEmail({ id: 1, title: 'T', body: 'x'.repeat(500), appUrl: 'http://x' }).html.includes('…'), 'a long note is cut with an ellipsis');
  assert.ok(buildReminderEmail({ id: 1, title: 'x'.repeat(500), body: '', appUrl: 'http://x' }).subject.length <= 120);

  // the job: claims what is due, sends once each, puts a failed one back, skips nothing it should send
  const calls = { claim: null, sent: [], released: [], captured: [] };
  const rows = [{ id: 1, user_id: 7, title: 'One', body: 'a' }, { id: 2, user_id: 8, title: 'Two', body: 'b' }, { id: 3, user_id: 9, title: 'Three', body: 'c' }];
  const emails = { 7: 'a@example.test', 8: 'b@example.test', 9: null };
  const pool = {
    async query(sql, params) {
      if (/remind_repeat <> 'none'/.test(sql)) return { rows: [] }; // nothing repeating here
      if (/UPDATE notes SET reminder_sent_at = \$1/.test(sql)) { calls.claim = { sql, params }; return { rows }; }
      if (/SELECT email FROM users/.test(sql)) return { rows: emails[params[0]] ? [{ email: emails[params[0]] }] : [] };
      if (/reminder_sent_at = NULL/.test(sql)) { calls.released.push(params[0]); return { rows: [] }; }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  const result = await runNoteReminders(now, {
    pool, appUrl: 'https://v.example',
    sendEmail: async (m) => { calls.sent.push(m.to); if (m.to === 'b@example.test') throw new Error('smtp down'); return { ok: true }; },
    capture: async (s) => { calls.captured.push(s); },
  });
  assert.deepStrictEqual(result, { due: 3, sent: 1, failed: 2, advanced: 0 });
  assert.deepStrictEqual(calls.sent, ['a@example.test', 'b@example.test'], 'one email each; a person with no address is not mailed');
  assert.deepStrictEqual(calls.released.sort(), [2, 3], 'failed ones are released so the next run tries again');
  assert.strictEqual(calls.captured.length, 2);
  assert.deepStrictEqual(calls.captured.map((c) => c.userId).sort(), [8, 9], 'the failure is told to the person it concerns');
  assert.match(calls.claim.sql, /FOR UPDATE SKIP LOCKED/, 'two servers cannot claim the same reminder');
  assert.match(calls.claim.sql, /remind_email/, 'only reminders that asked for an email');
  assert.match(calls.claim.sql, /reminder_done_at IS NULL/, 'a reminder marked done is not emailed');
  assert.match(calls.claim.sql, /reminder_sent_at IS NULL/, 'once only');
  assert.strictEqual(calls.claim.params[0], now.toISOString());
  assert.strictEqual(calls.claim.params[1], new Date(now.getTime() - MAX_EMAIL_AGE_MS).toISOString(), 'nothing more than a day late is emailed');

  // a "not sent" reply from the mail helper counts as a failure; a broken database never throws out of the job
  const calls2 = { released: [] };
  const r2 = await runNoteReminders(now, {
    pool: { async query(sql, p) { if (/remind_repeat <> 'none'/.test(sql)) return { rows: [] }; if (/UPDATE notes SET reminder_sent_at = \$1/.test(sql)) return { rows: [rows[0]] }; if (/SELECT email/.test(sql)) return { rows: [{ email: 'a@example.test' }] }; calls2.released.push(p[0]); return { rows: [] }; } },
    sendEmail: async () => ({ ok: false, skipped: true, reason: 'email is not set up' }), capture: async () => {},
  });
  assert.deepStrictEqual(r2, { due: 1, sent: 0, failed: 1, advanced: 0 });
  assert.deepStrictEqual(calls2.released, [1]);
  const r3 = await runNoteReminders(now, { pool: { async query() { throw new Error('db down'); } }, sendEmail: async () => ({ ok: true }), capture: async () => {} });
  assert.strictEqual(r3.failed, 1);

  // ---- repeating reminders: the email says so, and one nobody marked done moves on to the latest time
  const repeatMail = buildReminderEmail({ id: 4, title: 'Water the plants', body: '', appUrl: 'https://v.example', repeat: 'weekly' });
  assert.match(repeatMail.html, /This reminder repeats \(every week\)\. Marking it done moves it to the next time\./);
  assert.ok(!/This reminder repeats/.test(buildReminderEmail({ id: 4, title: 'x', body: '', appUrl: 'https://v.example', repeat: 'none' }).html), 'a one-off says nothing about repeating');
  assert.ok(!/This reminder repeats/.test(buildReminderEmail({ id: 4, title: 'x', body: '', appUrl: 'https://v.example' }).html));

  const updates = [];
  const repeating = [
    { id: 10, remind_at: '2026-10-01T23:00:00.000Z', remind_repeat: 'weekly', remind_tz: 'Australia/Brisbane', remind_day: 2 },   // three weeks behind
    { id: 11, remind_at: '2026-10-19T23:00:00.000Z', remind_repeat: 'weekly', remind_tz: 'Australia/Brisbane', remind_day: 20 },  // its next time has not come yet
  ];
  const nowRep = new Date('2026-10-22T05:00:00Z');
  const moved = await advanceRepeating({
    async query(sql, params) {
      if (/remind_repeat <> 'none'/.test(sql)) { assert.match(sql, /reminder_done_at IS NULL/, 'one marked done is left alone'); return { rows: repeating }; }
      updates.push(params); return { rowCount: 1 };
    },
  }, nowRep);
  assert.strictEqual(moved, 1, 'only the one whose next time had come');
  assert.deepStrictEqual(updates, [[10, '2026-10-15T23:00:00.000Z']], 'it lands on the latest time, not every one missed');
  assert.strictEqual(await advanceRepeating({ async query() { throw new Error('db down'); } }, nowRep), 0, 'a broken database never throws out of the job');

  console.log('noteReminders tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
