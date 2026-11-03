'use strict';
// node server/services/emailFollowUp/redact.test.js   (no database, no model)
const assert = require('assert');
const { createRedactor, luhn } = require('./redact');

const rd = () => createRedactor({ keep: ['me@mine.com', '@acme.com.au'] });

// phone numbers, in the shapes Australians write them
{
  const r = rd();
  const t = 'Call 0412 345 678 or (02) 9999 8888 or +61 412 345 678 or 1300 123 456.';
  const out = r.redact(t);
  assert.doesNotMatch(out, /0412|9999|345 678|1300 123/);
  assert.match(out, /\[PHONE_\d\]/);
  assert.strictEqual(r.restore(out), t, 'restore gives back the original exactly');
}
// the same detail gets the same placeholder, a different one a different placeholder
{
  const r = rd();
  const out = r.redact('Ring 0412 345 678 now. Again 0412 345 678. Or 0498 765 432.');
  const phs = out.match(/\[PHONE_\d\]/g);
  assert.strictEqual(phs[0], phs[1]);
  assert.notStrictEqual(phs[0], phs[2]);
}
// amounts, dates, invoice numbers and ABNs are not phone numbers
{
  const r = rd();
  const t = 'Invoice 20481 for $1,250.00 is due 14 November 2026. ABN 12 345 678 901. Order 123456789.';
  assert.strictEqual(r.redact(t), t, 'nothing here is personal');
}
// email addresses: the owner, case people and whole domains stay; others go
{
  const r = rd();
  const out = r.redact('From me@mine.com to sales@acme.com.au, cc stranger@gmail.com and Me@Mine.com.');
  assert.match(out, /me@mine\.com/);
  assert.match(out, /sales@acme\.com\.au/);
  assert.match(out, /Me@Mine\.com/, 'case does not matter for kept addresses');
  assert.doesNotMatch(out, /stranger@gmail/);
  assert.match(out, /\[EMAIL_1\]/);
}
// street addresses, with and without suburb, state and postcode
{
  const r = rd();
  const out = r.redact('The unit is at Unit 4/22 Smith Street, Paddington QLD 4064, and the other at 7 Long Rd.');
  assert.doesNotMatch(out, /Smith|Paddington|Long Rd/);
  assert.strictEqual((out.match(/\[ADDRESS_\d\]/g) || []).length, 2);
}
// labelled numbers keep the label and hide the number
{
  const r = rd();
  const out = r.redact('TFN: 123 456 782. Medicare 2123 45670 1. BSB 062-000 account number 12345678. DOB: 03/04/1980. Passport no N1234567.');
  assert.match(out, /TFN: \[TFN_1\]/);
  assert.match(out, /Medicare \[MEDICARE_1\]/);
  assert.match(out, /BSB \[BANK_1\]/);
  assert.match(out, /account number \[BANK_2\]/);
  assert.match(out, /DOB: \[DOB_1\]/);
  assert.match(out, /Passport no \[IDNUM_1\]/);
  assert.doesNotMatch(out, /123 456 782|12345678|N1234567|1980/);
}
// card numbers: only ones that pass the Luhn check
{
  assert.ok(luhn('4242 4242 4242 4242'));
  assert.ok(!luhn('1234 5678 9012 3456'));
  const r = rd();
  const out = r.redact('Card 4242 4242 4242 4242 but reference 1234 5678 9012 3456.');
  assert.match(out, /Card \[CARD_1\]/);
  assert.match(out, /1234 5678 9012 3456/);
}
// names are NOT hidden: say so plainly rather than pretend
{
  const r = rd();
  assert.strictEqual(r.redact('Dave Smith said hello'), 'Dave Smith said hello');
}
// restoring the model's reply: plain, and safe inside a JSON string
{
  const r = rd();
  const out = r.redact('Phone 0412 345 678 and 7 Long Rd.');
  const reply = JSON.stringify({ quote: out.replace(/^Phone /, '') });
  const back = JSON.parse(r.restore(reply, { json: true }));
  assert.strictEqual(back.quote, '0412 345 678 and 7 Long Rd.');
  // a placeholder the redactor never made is left alone
  assert.strictEqual(r.restore('[PHONE_99]'), '[PHONE_99]');
}
// a detail containing a quote mark cannot break the JSON
{
  const r = createRedactor();
  r.redact('Account no 12345678');
  const t = r.redact('Licence no AB"12345');
  assert.ok(typeof t === 'string');
}
// the tally says what was hidden, without saying what it was
{
  const r = rd();
  r.redact('Ring 0412 345 678, write to a@b.com, 7 Long Rd.');
  assert.deepStrictEqual(r.tally(), { EMAIL: 1, ADDRESS: 1, PHONE: 1 });
}

console.log('redact tests passed');

// ---- end to end with a stand-in model: it never sees the details, and the quote still matches the ORIGINAL text ----
(async () => {
  const { extractFromSource } = require('./extract');
  const ask = require('./caseAsk');
  const text = 'Hi, I will send the signed form to 7 Long Rd by Friday 14 November 2026. Ring me on 0412 345 678 or write to dave@gmail.com.';
  const source = { id: 5, kind: 'message', channel: 'inbound', fromAddr: 'dave@gmail.com', toAddr: 'me@mine.com', subject: 'Form', receivedAt: '2026-11-03T00:00:00Z', text };
  let seen = '';
  let sawSystem = '';
  const deps = {
    getModels: async () => ({ light: 'm' }),
    logUsage: () => {},
    callModel: async (_m, prompt, opts) => {
      seen = prompt; sawSystem = opts.system;
      // the stand-in quotes the placeholder exactly as it saw it
      const quote = prompt.match(/I will send the signed form to \[ADDRESS_\d\] by Friday 14 November 2026\./)[0];
      return { text: JSON.stringify({ mentions: [{ kind: 'commitment', direction: 'they_owe', claimType: 'agreed', party: 'dave@gmail.com', items: ['signed form'], quote, dueRaw: 'Friday 14 November 2026' }] }) };
    },
  };
  const ctx = { tz: 'Australia/Brisbane', ownerEmail: 'me@mine.com', obligation: 'Dave owes the signed form', redact: true, keep: [] };
  const out = await extractFromSource(1, source, ctx, deps);
  assert.doesNotMatch(seen, /Long Rd|0412|345 678/, 'the model never saw the address or the phone number');
  assert.match(sawSystem, /placeholders such as \[PHONE_1\]/, 'the model is told what the placeholders mean');
  assert.strictEqual(out.mentions.length, 1, JSON.stringify(out.dropped));
  assert.strictEqual(out.mentions[0].quote, 'I will send the signed form to 7 Long Rd by Friday 14 November 2026.', 'the ledger quote is the original wording');
  assert.match(seen, /me@mine\.com/, 'the owner address is kept');

  // with redaction off the text goes as written and the system prompt is untouched
  const off = await extractFromSource(1, source, { ...ctx, redact: false }, { ...deps, callModel: async (_m, prompt, opts) => { seen = prompt; sawSystem = opts.system; return { text: JSON.stringify({ mentions: [] }) }; } });
  assert.match(seen, /7 Long Rd/);
  assert.doesNotMatch(sawSystem, /placeholders/);
  assert.deepStrictEqual(off.mentions, []);

  // Ask: the question and the correspondence are hidden, the cited quote is checked against the original, the answer shows the real detail
  const sources = [{ id: 5, label: 'From Dave', channel: 'inbound', kind: 'message', parseStatus: 'parsed', receivedAt: '2026-11-03T00:00:00Z', fromAddr: 'dave@gmail.com', toAddr: 'me@mine.com', subject: 'Form', text }];
  const corpus = ask.buildCorpus(sources, { tz: 'Australia/Brisbane', ownerEmail: 'me@mine.com' });
  let askSeen = '';
  const reply = (prompt) => JSON.stringify({ answer: 'He will post it to ' + prompt.match(/\[ADDRESS_\d\]/)[0] + ' [S1].', found: true, citations: [{ source: 1, quote: prompt.match(/I will send the signed form to \[ADDRESS_\d\]/)[0] }] });
  const answer = await ask.askCase(1, { title: 'T', obligation: 'O', aliases: [], redact: true }, corpus, 'Where is it going? Call 0412 345 678.', [], {
    resolveModel: async () => 'm', logUsage: () => {}, callModel: async (_m, prompt) => { askSeen = prompt; return { text: reply(prompt) }; },
  });
  assert.doesNotMatch(askSeen, /Long Rd|0412 345 678/, 'the question and the mail are hidden');
  assert.match(answer.answer, /7 Long Rd/, 'the answer shows the real address');
  assert.strictEqual(answer.citations.length, 1);
  assert.strictEqual(answer.citations[0].quote, 'I will send the signed form to 7 Long Rd', 'the citation is the original wording');
  console.log('redact end-to-end passed');
})().catch((e) => { console.error(e); process.exit(1); });

