'use strict';

// Shared checks for a page guide built on guideCore.js (Fonts, Measurements, CSS and any new one). Each guide's own test file passes
// its service, the page's tool list module (client/src/pages/<page>/<page>Tools.mjs) and a few facts the guide must not get wrong.
// No model is called. See docs/guide-chat.md.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');

/**
 * @param {object} o
 * @param {string} o.name            shown in the success line
 * @param {object} o.service         the guide's service module (CATALOG, RULES, NOT_POSSIBLE, SYSTEM, ... , ask function)
 * @param {string} o.askName         name of the ask function on the service
 * @param {string} o.feature         the usage feature name logged for the guide
 * @param {string} o.toolsFile       path of the page's tools .mjs, relative to the client/src/pages folder
 * @param {string} o.menuExport      export name of the menu tool list (e.g. 'FONT_TOOLS')
 * @param {string} o.targetKey       key on a GUIDE_TOOLS entry naming the tool its Open button shows (e.g. 'tool' or 'mode')
 * @param {Array}  o.facts           [[toolId, 'does'|'notes', RegExp, why]] statements the catalogue must make
 * @param {Array}  o.gaps            RegExps each of which must match the joined NOT_POSSIBLE text
 * @param {Array}  o.rules           RegExps each of which must match the joined RULES text
 * @param {Array}  o.system          RegExps each of which must match SYSTEM
 * @param {RegExp} [o.noWords]       words that must not appear anywhere a person reads (catalogue, rules, gaps, page wording)
 * @param {string} o.exampleToolId   a tool id used in the fake model answers
 * @param {string} o.exampleStepId   a tool id used in the fake model answer given to ask()
 */
async function checkGuide(o) {
  const svc = o.service;
  const tools = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages', o.toolsFile)).href);
  const MENU = tools[o.menuExport];
  const { GUIDE_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, HOW_IT_WORKS } = tools;
  const { CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS, buildTutorPrompt, cleanMessages, normalizeTutorReply } = svc;
  const ask = svc[o.askName];

  // ---- the guide knows exactly the tools and controls the page can show (fails if one is added to or removed from either list alone) ----
  assert.deepStrictEqual(CATALOG.map((t) => t.id).sort(), GUIDE_TOOLS.map((t) => t.id).sort(), 'the guide catalogue matches the page');
  assert.strictEqual(new Set(CATALOG.map((t) => t.id)).size, CATALOG.length, 'no duplicate ids');
  const menuIds = MENU.map((t) => t.id);
  for (const t of CATALOG) {
    assert.ok(t.group && t.does && t.label, `${t.id} is described`);
    assert.strictEqual(t.label, GUIDE_TOOLS.find((g) => g.id === t.id).label, `${t.id} uses the page's own name`);
  }
  assert.ok(GUIDE_TOOLS.every((g) => menuIds.includes(g[o.targetKey])), 'every Open button goes to a real tool');
  for (const t of MENU) {
    assert.ok(TOOL_TIPS[t.id], `${t.id} has a hover tip`);
    assert.ok(TOOL_BLURBS[t.id], `${t.id} has a blurb`);
    assert.ok(GROUPS.includes(t.group), `${t.id} is in a listed group`);
    const entry = CATALOG.find((c) => c.id === t.id);
    assert.ok(entry, `${t.id} is in the guide`);
    assert.strictEqual(entry.group, t.group, `${t.id} is in the same group in the guide`);
  }
  for (const g of GROUPS) assert.ok(GROUP_TIPS[g], `group ${g} has a tip`);
  assert.ok(Array.isArray(HOW_IT_WORKS) && HOW_IT_WORKS.length >= 3, 'the (i) box has text');

  // ---- the facts the guide must not get wrong ----
  for (const [id, field, re, why] of o.facts) {
    assert.match(CATALOG.find((t) => t.id === id)[field] || '', re, why || `${id} ${field} mentions ${re}`);
  }
  const gaps = NOT_POSSIBLE.join(' ');
  for (const re of o.gaps) assert.match(gaps, re);
  for (const re of o.rules) assert.match(RULES.join(' '), re);
  assert.match(RULES.join(' '), /Open buttons in this chat only switch to a tool/);

  // ---- wording a person reads ----
  if (o.noWords) {
    const read = [
      ...CATALOG.flatMap((t) => [t.label, t.does, t.notes || '']), ...RULES, ...NOT_POSSIBLE,
      ...Object.values(TOOL_TIPS), ...Object.values(TOOL_BLURBS), ...Object.values(GROUP_TIPS), ...HOW_IT_WORKS.flat(),
    ].join('\n');
    assert.ok(!o.noWords.test(read), `no banned words in what people read: ${(read.match(o.noWords) || [])[0]}`);
  }

  // ---- safety rules are in the instructions ----
  assert.match(SYSTEM, /ONLY the tools and rules/);
  assert.match(SYSTEM, /Never invent a button/i);
  assert.match(SYSTEM, /cannot see/);
  for (const re of o.system) assert.match(SYSTEM, re);

  // ---- the prompt carries every tool, the rules, the gaps, the conversation ----
  const prompt = buildTutorPrompt({ messages: [{ role: 'user', content: 'help me please' }], currentTool: o.exampleToolId });
  for (const t of CATALOG) assert.ok(prompt.includes(`tool "${t.id}"`), `prompt lists ${t.id}`);
  assert.match(prompt, /THINGS IT DOES NOT DO/);
  assert.match(prompt, /Person: help me please/);
  assert.match(prompt, new RegExp(`currently has the "${o.exampleToolId}" tool open`));

  // ---- conversation hygiene and the model's answer is untrusted ----
  const msgs = cleanMessages([{ role: 'system', content: 'x' }, { role: 'user', content: '  hi \n there ' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `q${i}` }))]);
  assert.ok(msgs.length <= 10 && msgs.every((m) => m.role === 'user' || m.role === 'assistant'));
  let r = normalizeTutorReply(JSON.stringify({ verdict: 'doable', answer: 'Use it.', steps: [{ tool: o.exampleToolId, do: 'Press it.' }, { tool: 'teleporter', do: 'x' }] }));
  assert.deepStrictEqual(r.steps.map((s) => s.tool), [o.exampleToolId], 'unknown ids are dropped');
  assert.strictEqual(r.steps[0].label, CATALOG.find((t) => t.id === o.exampleToolId).label);
  r = normalizeTutorReply({ verdict: 'doable', answer: 'x', steps: [] });
  assert.strictEqual(r.verdict, 'question', 'doable with no steps is not an answer');
  r = normalizeTutorReply({ verdict: 'beyond', answer: 'No.', steps: [{ tool: o.exampleToolId, do: 'x' }] });
  assert.strictEqual(r.steps.length, 0, 'a beyond answer shows no steps');
  assert.ok(VERDICTS.includes(normalizeTutorReply({ verdict: 'accountant', answer: 'x', steps: [] }).verdict));
  assert.ok(!/[{}]/.test(normalizeTutorReply('not json {oops').answer));

  // ---- ask() with a fake model ----
  let seen = null; let logged = null;
  const deps = {
    getModels: async () => ({ standard: 'test-model', light: 'light-model' }),
    callModel: async (model, p, opts) => {
      seen = { model, prompt: p, system: opts.system };
      return { text: JSON.stringify({ verdict: 'doable', answer: 'ok', steps: [{ tool: o.exampleStepId, do: 'Do it.' }] }), model, inputTokens: 1, outputTokens: 1 };
    },
    logUsage: (u) => { logged = u; },
  };
  const out = await ask(7, { messages: [{ role: 'user', content: 'help' }] }, deps);
  assert.strictEqual(out.steps[0].tool, o.exampleStepId);
  assert.strictEqual(seen.model, 'test-model', 'uses the workspace model, never a hardcoded id');
  assert.deepStrictEqual({ u: logged.userId, f: logged.feature }, { u: 7, f: o.feature });
  await assert.rejects(ask(1, { messages: [] }, deps), /Type what you want to do/);

  console.log(`${o.name} tests passed`);
  return tools;
}

module.exports = { checkGuide };
