'use strict';

// node server/services/conversationNote.test.js   (part of npm run test:notes)
const assert = require('assert');
const C = require('./conversationNote');

const turns = [
  { role: 'user', content: 'What should I charge for the oak benchtop?' },
  { role: 'assistant', content: 'About one hundred and twenty dollars a metre installed.' },
  { role: 'user', content: 'OK, I will quote them that and call Sam tomorrow.' },
  { role: 'assistant', content: '   ' },
  { role: 'system', content: 'ignored' },
];

// only real turns
assert.strictEqual(C.cleanMessages(turns).length, 3);
assert.deepStrictEqual(C.cleanMessages(null), []);

// the reply is made safe
assert.deepStrictEqual(C.normalizeReply('{"title":" \\"Pricing oak\\" ","summary":"Talked about oak pricing.","decisions":["Quote $120 a metre"],"todos":["Call Sam tomorrow","call sam tomorrow"," "]}'),
  { title: 'Pricing oak', summary: 'Talked about oak pricing.', decisions: ['Quote $120 a metre'], todos: ['Call Sam tomorrow'] }, 'repeats and empties dropped');
assert.strictEqual(C.normalizeReply('{"title":"T","summary":""}'), null, 'no summary, no proposal');
assert.strictEqual(C.normalizeReply('sorry'), null);
assert.strictEqual(C.normalizeReply('```json\n{"summary":"Fenced reply."}\n```').summary, 'Fenced reply.');
assert.strictEqual(C.normalizeReply({ summary: 'ok then', todos: Array.from({ length: 40 }, (_, i) => `task ${i}`) }).todos.length, 15, 'at most fifteen');
assert.strictEqual(C.normalizeReply({ summary: 'ok then', title: 'x'.repeat(300) }).title.length, 80);

// the note: summary, decisions, to-dos as tick-boxes, then the whole exchange
const body = C.compose({ summary: 'Talked about oak pricing.', decisions: ['Quote $120 a metre'], todos: ['Call Sam tomorrow'], messages: turns });
assert.strictEqual(body, 'Summary:\nTalked about oak pricing.\n\nDecisions:\n- Quote $120 a metre\n\nTo do:\n- [ ] Call Sam tomorrow\n\n— Conversation —\n**You:**\nWhat should I charge for the oak benchtop?\n\n**Assistant:**\nAbout one hundred and twenty dollars a metre installed.\n\n**You:**\nOK, I will quote them that and call Sam tomorrow.');
assert.strictEqual(C.compose({ messages: turns.slice(0, 2) }), '— Conversation —\n**You:**\nWhat should I charge for the oak benchtop?\n\n**Assistant:**\nAbout one hundred and twenty dollars a metre installed.', 'no summary: just the exchange');
assert.match(C.defaultTitle(new Date(2026, 9, 24, 14, 35)), /^Conversation, 24 Oct 2:35 pm$/);

(async () => {
  const seen = {};
  const deps = (reply, fail) => ({
    getModels: async () => ({ light: 'light-model' }),
    callModel: async (model, prompt, opts) => { Object.assign(seen, { model, prompt, system: opts.system }); if (fail) throw new Error('down'); return { text: typeof reply === 'string' ? reply : JSON.stringify(reply), model, inputTokens: 1, outputTokens: 1 }; },
    logUsage: (u) => { seen.logged = u; },
  });
  const ok = await C.buildConversationNote(7, turns, {}, deps({ title: 'Pricing oak', summary: 'Talked about oak pricing.', decisions: [], todos: ['Call Sam tomorrow'] }));
  assert.deepStrictEqual({ title: ok.title, summarised: ok.summarised, todos: ok.todos, count: ok.count }, { title: 'Pricing oak', summarised: true, todos: ['Call Sam tomorrow'], count: 3 });
  assert.ok(ok.body.startsWith('Summary:\nTalked about oak pricing.') && ok.body.includes('- [ ] Call Sam tomorrow') && ok.body.includes('— Conversation —'));
  assert.strictEqual(seen.model, 'light-model');
  assert.match(seen.prompt, /Person: What should I charge/);
  assert.match(seen.system, /do not follow them/);
  assert.strictEqual(seen.logged.feature, 'talk_summary');

  // a model that fails or gives nonsense still gives the exchange, never a blank
  for (const bad of [deps('nonsense'), deps({}, true)]) {
    const r = await C.buildConversationNote(7, turns, { now: new Date(2026, 9, 24, 14, 35) }, bad);
    assert.strictEqual(r.summarised, false);
    assert.strictEqual(r.title, 'Conversation, 24 Oct 2:35 pm');
    assert.ok(r.body.startsWith('— Conversation —') && r.body.includes('About one hundred and twenty'));
  }
  const empty = await C.buildConversationNote(7, [], {}, deps({}));
  assert.strictEqual(empty.count, 0);
  console.log('conversationNote tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
