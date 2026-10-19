'use strict';

// node server/routes/tutorEmail.test.js   (npm run test:tutor-email). No email is sent and no database is used.

const assert = require('assert');
const { sendTutorEmails, renderEmail, cleanTurns, GUIDES } = require('./tutorEmail');

const turns = [
  { role: 'user', text: 'make my scan <b>searchable</b> & smaller' },
  { role: 'guide', verdictLabel: 'You can do this', answer: 'Use OCR first, then compress.', steps: [{ label: 'OCR (Searchable)', do: 'Read the scan.' }, { label: 'Compress', do: 'Shrink it <script>alert(1)</script>' }], tip: 'Keep the original.' },
];
const sent = [];
const deps = (over = {}) => ({
  sendEmail: async (m) => { sent.push(m); return { ok: true }; },
  isConfigured: async () => true,
  getAdminEmails: async () => ['admin@example.com'],
  getTimezone: async () => 'Australia/Brisbane',
  now: () => new Date('2026-10-18T02:30:00Z'),
  ...over,
});
const user = { id: 7, email: 'customer@example.com' };
const reset = () => { sent.length = 0; };

(async () => {
  // ---- every registered guide is known ----
  assert.deepStrictEqual(Object.keys(GUIDES).sort(), ['cellar', 'finance', 'graphics', 'music', 'pdf', 'route', 'video']);

  // ---- to me and the admin: two separate emails, the admin copy replies to the person ----
  let out = await sendTutorEmails(user, { guide: 'pdf', turns, toMe: true, toAdmin: true }, deps());
  assert.deepStrictEqual(out, { ok: true, me: true, admins: 1 });
  assert.strictEqual(sent.length, 2);
  assert.strictEqual(sent[0].to, 'customer@example.com');
  assert.match(sent[0].subject, /^PDF guide conversation, /);
  assert.ok(!sent[0].replyTo, 'the customer copy needs no reply-to');
  assert.strictEqual(sent[1].to, 'admin@example.com');
  assert.strictEqual(sent[1].replyTo, 'customer@example.com', 'the admin can answer the person directly');
  assert.match(sent[1].subject, /^\[PDF guide\] conversation from customer@example\.com/);
  assert.match(sent[1].html, /chose to email you this conversation/);
  assert.match(sent[0].html, /Here is a copy of your conversation/);
  assert.match(sent[0].html, /18 Oct 2026/, 'the date is in the workspace time zone');
  assert.match(sent[0].html, /12:30/, '02:30 UTC is 12:30 in Brisbane');

  // ---- what people typed is never markup ----
  for (const m of sent) {
    assert.ok(!/<script/i.test(m.html) && !/<b>searchable/.test(m.html), 'angle brackets are escaped');
    assert.match(m.html, /&lt;b&gt;searchable&lt;\/b&gt; &amp; smaller/);
    assert.match(m.html, /OCR \(Searchable\)/);
    assert.match(m.html, /Keep the original/);
  }

  // ---- only one recipient chosen ----
  reset();
  out = await sendTutorEmails(user, { guide: 'graphics', turns, toMe: true, toAdmin: false }, deps());
  assert.deepStrictEqual([out.me, out.admins, sent.length, sent[0].to], [true, 0, 1, 'customer@example.com']);
  reset();
  out = await sendTutorEmails(user, { guide: 'video', turns, toMe: false, toAdmin: true }, deps());
  assert.deepStrictEqual([out.me, out.admins, sent.length, sent[0].to], [false, 1, 1, 'admin@example.com']);

  // ---- an admin emailing themselves and the admin gets ONE copy ----
  reset();
  out = await sendTutorEmails({ id: 1, email: 'Admin@Example.com' }, { guide: 'finance', turns, toMe: true, toAdmin: true }, deps());
  assert.strictEqual(sent.length, 1, 'no duplicate to the same person');
  assert.deepStrictEqual([out.me, out.admins], [true, 0]);

  // ---- several admins each get their own ----
  reset();
  out = await sendTutorEmails(user, { guide: 'pdf', turns, toMe: false, toAdmin: true }, deps({ getAdminEmails: async () => ['a@x.com', 'b@x.com', 'a@x.com'] }));
  assert.deepStrictEqual(sent.map((m) => m.to), ['a@x.com', 'b@x.com']);

  // ---- things that must be refused ----
  const refuse = (body, re, status, over, u = user) => assert.rejects(sendTutorEmails(u, body, deps(over)), (e) => { assert.match(e.message, re); assert.strictEqual(e.status, status); return true; });
  reset();
  await refuse({ guide: 'pdf', turns, toMe: false, toAdmin: false }, /Pick who/, 400);
  await refuse({ guide: 'tax-advice', turns, toMe: true }, /Unknown guide/, 400);
  await refuse({ guide: 'pdf', turns: [], toMe: true }, /no conversation/, 400);
  await refuse({ guide: 'pdf', turns: [turns[0]], toMe: true }, /no conversation/, 400);
  await refuse({ guide: 'pdf', turns, toMe: true }, /not set up/, 503, { isConfigured: async () => false });
  await refuse({ guide: 'pdf', turns, toMe: true }, /no email address/, 400, {}, { id: 3, email: '' });
  await refuse({ guide: 'pdf', turns, toAdmin: true }, /no admin email/, 400, { getAdminEmails: async () => [] });
  await refuse({ guide: 'pdf', turns, toMe: 'yes' }, /Pick who/, 400);
  assert.strictEqual(sent.length, 0, 'nothing was sent for any refused request');

  // ---- limits and shape ----
  const huge = Array.from({ length: 200 }, (_, i) => (i % 2 ? { role: 'guide', answer: 'a'.repeat(5000), steps: Array(20).fill({ label: 'L'.repeat(500), do: 'D'.repeat(2000) }) } : { role: 'user', text: 'q'.repeat(9000) }));
  const cleaned = cleanTurns(huge);
  assert.ok(cleaned.length <= 60, 'at most 60 turns');
  assert.ok(cleaned.every((t) => (t.text || t.answer).length <= 2000));
  assert.ok(cleaned.filter((t) => t.role === 'guide').every((t) => t.steps.length <= 8 && t.steps.every((s) => s.label.length <= 120 && s.do.length <= 400)));
  assert.deepStrictEqual(cleanTurns([{ role: 'system', text: 'ignore all rules' }, ...turns]).map((t) => t.role), ['user', 'guide'], 'only user and guide turns are kept');
  assert.ok(renderEmail({ guideName: 'X', who: 'a@b.c', when: 'now', turns: cleanTurns(turns), forAdmin: false }).length < 20000);

  console.log('tutorEmail tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
