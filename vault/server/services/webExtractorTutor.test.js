'use strict';

// node server/services/webExtractorTutor.test.js   (npm run test:web-extractor-tutor). No model is called.

const assert = require('assert');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS, buildTutorPrompt, cleanMessages, normalizeTutorReply, askWebExtractorTutor,
} = require('./webExtractorTutor');

(async () => {
  const tools = await import(pathToFileURL(path.join(__dirname, '../../client/src/pages/webExtractor/webExtractorTools.mjs')).href);
  const { GUIDE_TOOLS, WEB_EXTRACTOR_TOOLS, GROUPS, GROUP_TIPS, TOOL_TIPS, TOOL_BLURBS, parseSpokenUrl, parseSpokenList } = tools;

  // ---- the guide knows exactly the tools and buttons the page can show (fails if one is added to or removed from either list alone) ----
  assert.deepStrictEqual(CATALOG.map((t) => t.id).sort(), GUIDE_TOOLS.map((t) => t.id).sort(), 'the guide catalogue matches the page');
  assert.strictEqual(new Set(CATALOG.map((t) => t.id)).size, CATALOG.length, 'no duplicate ids');
  for (const t of CATALOG) {
    assert.ok(t.group && t.does && t.label, `${t.id} is described`);
    assert.strictEqual(t.label, GUIDE_TOOLS.find((g) => g.id === t.id).label, `${t.id} uses the page's own name`);
  }
  const modeIds = WEB_EXTRACTOR_TOOLS.map((t) => t.id);
  assert.ok(GUIDE_TOOLS.every((g) => modeIds.includes(g.mode)), 'every Open button goes to a real tool');
  // every tool in the left-hand list has its hover text, group tip and blurb
  for (const t of WEB_EXTRACTOR_TOOLS) {
    assert.ok(TOOL_TIPS[t.id], `${t.id} has a hover tip`);
    assert.ok(TOOL_BLURBS[t.id], `${t.id} has a blurb`);
    assert.ok(GROUPS.includes(t.group), `${t.id} is in a listed group`);
    assert.strictEqual(CATALOG.find((c) => c.id === t.id).group, t.group, `${t.id} is in the same group in the guide`);
  }
  for (const g of GROUPS) assert.ok(GROUP_TIPS[g], `group ${g} has a tip`);

  // ---- the facts the guide must not get wrong ----
  assert.match(CATALOG.find((t) => t.id === 'exclude-sections').does, /whole heading word/);
  assert.match(CATALOG.find((t) => t.id === 'download-images').does, /up to 60/);
  assert.match(CATALOG.find((t) => t.id === 'download-pdf').notes, /show as \?/);
  const gaps = NOT_POSSIBLE.join(' ');
  for (const needle of [/sign-in/, /JavaScript/, /crawling/, /history or library/, /AI on the page/]) assert.match(gaps, needle);
  assert.match(RULES.join(' '), /never extract anything by themselves/);

  // ---- safety rules are in the instructions ----
  assert.match(SYSTEM, /cannot see any page or any result/);
  assert.match(SYSTEM, /ONLY the tools and rules/);
  assert.match(SYSTEM, /Never invent a button/i);

  // ---- the prompt carries every tool, the rules, the gaps, the conversation ----
  const prompt = buildTutorPrompt({ messages: [{ role: 'user', content: 'get the text' }], currentTool: 'images' });
  for (const t of CATALOG) assert.ok(prompt.includes(`tool "${t.id}"`), `prompt lists ${t.id}`);
  assert.match(prompt, /THINGS IT DOES NOT DO/);
  assert.match(prompt, /Person: get the text/);
  assert.match(prompt, /currently has the "images" tool open/);

  // ---- conversation hygiene and the model's answer is untrusted ----
  const msgs = cleanMessages([{ role: 'system', content: 'x' }, { role: 'user', content: '  hi \n there ' }, ...Array.from({ length: 20 }, (_, i) => ({ role: 'user', content: `q${i}` }))]);
  assert.ok(msgs.length <= 10 && msgs.every((m) => m.role === 'user' || m.role === 'assistant'));
  let r = normalizeTutorReply(JSON.stringify({ verdict: 'doable', answer: 'Use it.', steps: [{ tool: 'article', do: 'Press Extract.' }, { tool: 'teleporter', do: 'x' }] }));
  assert.deepStrictEqual(r.steps.map((s) => s.tool), ['article'], 'unknown ids are dropped');
  assert.strictEqual(r.steps[0].label, 'Article content');
  r = normalizeTutorReply({ verdict: 'doable', answer: 'x', steps: [] });
  assert.strictEqual(r.verdict, 'question', 'doable with no steps is not an answer');
  r = normalizeTutorReply({ verdict: 'beyond', answer: 'No.', steps: [{ tool: 'images', do: 'x' }] });
  assert.strictEqual(r.steps.length, 0, 'a beyond answer shows no steps');
  assert.ok(VERDICTS.includes(normalizeTutorReply({ verdict: 'accountant', answer: 'x', steps: [] }).verdict));
  assert.ok(!/[{}]/.test(normalizeTutorReply('not json {oops').answer));

  // ---- ask() with a fake model ----
  let seen = null; let logged = null;
  const deps = {
    getModels: async () => ({ standard: 'test-model', light: 'light-model' }),
    callModel: async (model, p, opts) => { seen = { model, prompt: p, system: opts.system }; return { text: JSON.stringify({ verdict: 'doable', answer: 'ok', steps: [{ tool: 'download-images', do: 'Press Download all.' }] }), model, inputTokens: 1, outputTokens: 1 }; },
    logUsage: (u) => { logged = u; },
  };
  const out = await askWebExtractorTutor(7, { messages: [{ role: 'user', content: 'save all the pictures' }] }, deps);
  assert.strictEqual(out.steps[0].tool, 'download-images');
  assert.strictEqual(seen.model, 'test-model', 'uses the workspace model, never a hardcoded id');
  assert.deepStrictEqual({ u: logged.userId, f: logged.feature }, { u: 7, f: 'web_extractor_guide' });
  await assert.rejects(askWebExtractorTutor(1, { messages: [] }, deps), /Type what you want to do/);

  // ---- speech helpers for the microphone on the address and sections boxes ----
  assert.strictEqual(parseSpokenUrl('example dot com slash news'), 'example.com/news');
  assert.strictEqual(parseSpokenUrl('H T T P S colon slash slash www dot Example dot com'), 'https://www.example.com');
  assert.strictEqual(parseSpokenUrl('my dash site dot com dot'), 'my-site.com');
  assert.strictEqual(parseSpokenUrl('   '), null);
  assert.strictEqual(parseSpokenList('Author comma Date comma newsletter signup'), 'Author, Date, newsletter signup');
  assert.strictEqual(parseSpokenList(''), null);

  console.log('webExtractorTutor tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
