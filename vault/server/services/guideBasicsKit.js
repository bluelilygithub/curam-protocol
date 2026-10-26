'use strict';

// Shared checks for the simple page guides built on guideCore.js that have no tools-list file of their own (CRM, Shares, Settings):
// the prompt, the untrusted-answer handling, the model call and the safety wording. Each guide's test adds its own drift check against
// the page. No model is called. See docs/guide-chat.md.

const assert = require('assert');

async function checkBasics({ name, service, askName, feature, toolWord, exampleToolId, exampleStepId, system }) {
  const { CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS, buildTutorPrompt, cleanMessages, normalizeTutorReply } = service;
  const ask = service[askName];

  assert.strictEqual(new Set(CATALOG.map((t) => t.id)).size, CATALOG.length, 'no duplicate ids');
  for (const t of CATALOG) assert.ok(t.id && t.label && t.group && t.does, `${t.id} is described`);
  assert.ok(RULES.length >= 6 && NOT_POSSIBLE.length >= 5);
  assert.ok(RULES.join(' ').includes('Open buttons in this chat only'), 'the rules say what Open does');

  assert.match(SYSTEM, /ONLY the (tabs|tools|sections) and rules/);
  assert.match(SYSTEM, /Never invent a (button|setting)/);
  assert.match(SYSTEM, /cannot see/);
  for (const re of system) assert.match(SYSTEM, re);

  const prompt = buildTutorPrompt({ messages: [{ role: 'user', content: 'help me please' }], currentTool: exampleToolId });
  for (const t of CATALOG) assert.ok(prompt.includes(`${toolWord} "${t.id}"`), `prompt lists ${t.id}`);
  assert.match(prompt, /THINGS IT DOES NOT DO/);
  assert.match(prompt, /Person: help me please/);
  assert.match(prompt, new RegExp(`currently has the "${exampleToolId}" ${toolWord} open`));
  assert.ok(!buildTutorPrompt({ messages: [], currentTool: 'nope' }).includes('currently has'), 'an unknown current tool is ignored');

  const msgs = cleanMessages([{ role: 'system', content: 'x' }, { role: 'user', content: '  hi \n there ' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `q${i}` }))]);
  assert.ok(msgs.length <= 10 && msgs.every((m) => m.role === 'user' || m.role === 'assistant'));
  const r = normalizeTutorReply(JSON.stringify({ verdict: 'doable', answer: 'Use it.', steps: [{ tool: exampleToolId, do: 'Press it.' }, { tool: 'teleporter', do: 'x' }] }));
  assert.deepStrictEqual(r.steps.map((s) => s.tool), [exampleToolId], 'unknown ids are dropped');
  assert.strictEqual(r.steps[0].label, CATALOG.find((t) => t.id === exampleToolId).label);
  assert.strictEqual(normalizeTutorReply({ verdict: 'doable', answer: 'x', steps: [] }).verdict, 'question', 'doable with no steps is not an answer');
  assert.strictEqual(normalizeTutorReply({ verdict: 'beyond', answer: 'No.', steps: [{ tool: exampleToolId, do: 'x' }] }).steps.length, 0);
  assert.ok(VERDICTS.includes(normalizeTutorReply({ verdict: 'nonsense', answer: 'x', steps: [] }).verdict));
  assert.ok(!/[{}]/.test(normalizeTutorReply('not json {oops').answer));

  let seen = null; let logged = null;
  const deps = {
    getModels: async () => ({ standard: 'test-model', light: 'light-model' }),
    callModel: async (model, p, opts) => {
      seen = { model, prompt: p, system: opts.system };
      return { text: JSON.stringify({ verdict: 'doable', answer: 'ok', steps: [{ tool: exampleStepId, do: 'Do it.' }] }), model, inputTokens: 1, outputTokens: 1 };
    },
    logUsage: (u) => { logged = u; },
  };
  const out = await ask(7, { messages: [{ role: 'user', content: 'help' }] }, deps);
  assert.strictEqual(out.steps[0].tool, exampleStepId);
  assert.strictEqual(seen.model, 'test-model', 'uses the workspace model, never a hardcoded id');
  assert.deepStrictEqual({ u: logged.userId, f: logged.feature }, { u: 7, f: feature });
  await assert.rejects(ask(1, { messages: [] }, deps), /Type what you want to do/);
  console.log(`${name} tests passed`);
}

module.exports = { checkBasics };
