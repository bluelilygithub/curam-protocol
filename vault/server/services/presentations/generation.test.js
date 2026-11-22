'use strict';

// node server/services/presentations/generation.test.js — no network and no database.

const assert = require('node:assert/strict');
const { generateOutline, generateDeck } = require('./generation');

const outlineJson = JSON.stringify({
  title: 'Quarterly update', subtitle: 'What changed', nSlides: 6, aspect: '16:9',
  slides: [
    { layout: 'title', title: 'Quarterly update', bullets: [] },
    { layout: 'bullets', title: 'Headlines', bullets: ['One', 'Two'] },
  ],
});

async function run() {
  const calls = [];
  const usage = [];
  const deps = {
    getModelsForUser: async () => ({ light: 'light-model', standard: 'standard-model' }),
    callModel: async (modelId, prompt, opts) => {
      calls.push({ modelId, prompt, opts });
      return { text: calls.length === 1 ? `\`\`\`json\n${outlineJson}\n\`\`\`` : 'not json at all', model: modelId, inputTokens: 11, outputTokens: 22 };
    },
    logUsage: async (entry) => { usage.push(entry); },
  };

  const outline = await generateOutline({ userId: 7, brief: 'Explain the quarter', imageRefs: ['/api/presentations/assets/7/a.png'], deps });
  assert.equal(outline.title, 'Quarterly update');
  assert.equal(outline.nSlides, 6);
  assert.equal(outline.slides.length, 6, 'short outlines are padded to the asked length');
  assert.equal(calls[0].modelId, 'light-model');
  assert.match(calls[0].prompt, /Explain the quarter/);
  assert.equal(calls[0].opts.signal, null);

  const deck = await generateDeck({ userId: 7, outline, theme: { id: 'ocean', label: 'Ocean', font: 'Verdana' }, deps });
  assert.equal(calls[1].modelId, 'standard-model');
  assert.equal(deck.themeId, 'ocean', 'a malformed model answer falls back to the outline');
  assert.equal(deck.slides.length, 6);
  assert.equal(deck.slides[0].layout, 'title');
  assert.equal(usage.length, 2, 'both model calls log usage');
  assert.equal(usage[1].feature, 'presentations_deck');

  const noModels = { ...deps, getModelsForUser: async () => ({ light: null, standard: null }) };
  await assert.rejects(() => generateOutline({ userId: 7, brief: 'x', deps: noModels }), /No AI model/);
}

run().then(() => console.log('presentations generation tests passed')).catch((err) => { console.error(err); process.exitCode = 1; });
