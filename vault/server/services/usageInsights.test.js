'use strict';

// node server/services/usageInsights.test.js
const assert = require('assert');
const { buildInsights, tierOf, jobOf } = require('./usageInsights');

const models = { light: 'claude-haiku-4-5', standard: 'claude-sonnet-4-6' };
const row = (feature, model_id, calls, input_tokens, output_tokens, cost, extra = {}) => ({ feature, model_id, calls, input_tokens, output_tokens, cost, cache_read: 0, cache_creation: 0, ...extra });
const find = (r, id) => r.observations.find((o) => o.id === id);

assert.deepStrictEqual(['claude-opus-4-6', 'claude-sonnet-4-6', 'gemini-2.5-pro', 'claude-haiku-4-5', 'gemini/3-flash-preview', 'deepseek-v4-flash', 'mystery'].map(tierOf),
  ['premium', 'standard', 'standard', 'light', 'light', 'light', 'unknown']);
assert.strictEqual(jobOf('tasks'), 'light');
assert.strictEqual(jobOf('seo_ads_guide'), 'light', 'guide chats are small jobs');
assert.strictEqual(jobOf('shares_observation_final'), 'judgement');
assert.strictEqual(jobOf('chat'), 'general');

// a small job on Sonnet: use the light model, and say how much
{
  const r = buildInsights([row('tasks', 'claude-sonnet-4-6', 20, 20000, 4000, 0.12)], models);
  const o = find(r, 'save:tasks:claude-sonnet-4-6');
  assert.ok(o, 'a small job on a dearer model is flagged');
  assert.strictEqual(o.kind, 'save');
  assert.ok(o.saving > 0.08 && o.saving < 0.12, 'saving is cost minus the light model price: ' + o.saving);
  assert.match(o.detail, /claude-haiku-4-5/, 'names the owner’s own light model');
}
// already on the light model, or no light model set: nothing to say
assert.strictEqual(buildInsights([row('tasks', 'claude-haiku-4-5', 20, 20000, 4000, 0.03)], models).observations.filter((o) => o.kind === 'save').length, 0);
assert.strictEqual(buildInsights([row('tasks', 'claude-sonnet-4-6', 20, 20000, 4000, 0.12)], {}).observations.filter((o) => o.kind === 'save').length, 0);
// a "light" slot that is really Sonnet is not offered as the cheap option, nor a light model as the strong one
assert.strictEqual(buildInsights([row('tasks', 'claude-opus-4-6', 20, 20000, 4000, 0.9)], { light: 'claude-sonnet-4-6', standard: 'claude-sonnet-4-6' }).observations.filter((o) => o.kind === 'save').length, 0);
assert.strictEqual(buildInsights([row('shares_observation_final', 'deepseek-v4-flash', 1, 22000, 5000, 0.004)], { light: 'claude-haiku-4-5', standard: 'claude-haiku-4-5' }).observations.filter((o) => o.kind === 'quality').length, 0);
// a general feature (chat) on Sonnet is not second-guessed
assert.deepStrictEqual(buildInsights([row('chat', 'claude-sonnet-4-6', 20, 20000, 4000, 0.12, { cache_read: 5000 })], models).observations.filter((o) => o.kind !== 'note'), []);

// a judgement job on a light model: a quality check, with the extra cost shown as negative saving
{
  const r = buildInsights([row('shares_observation_final', 'deepseek-v4-flash', 1, 22000, 5000, 0.004)], models);
  const o = find(r, 'quality:shares_observation_final:deepseek-v4-flash');
  assert.ok(o && o.kind === 'quality' && o.saving < 0);
}
// several models on one feature
{
  const r = buildInsights([row('gmail_intel', 'claude-haiku-4-5', 3, 900, 300, 0.001), row('gmail_intel', 'deepseek-v4-flash', 10, 3000, 3000, 0.002)], models);
  assert.ok(find(r, 'mixed:gmail_intel'));
}
// many tiny calls; long outputs
assert.ok(find(buildInsights([row('goals', 'claude-haiku-4-5', 12, 2400, 1200, 0.002)], models), 'tiny:goals'));
assert.ok(find(buildInsights([row('recipes_image', 'claude-haiku-4-5', 4, 1000, 9000, 0.05)], models), 'long:recipes_image'));
// chat with long prompts and no cache reads
assert.ok(find(buildInsights([row('chat', 'claude-sonnet-4-6', 6, 60000, 3000, 0.2)], models), 'cache:chat'));
assert.ok(!find(buildInsights([row('chat', 'claude-sonnet-4-6', 6, 60000, 3000, 0.2, { cache_read: 40000 })], models), 'cache:chat'), 'cached chat is fine');
// concentration and unpriced models
{
  const r = buildInsights([row('shares_observation', 'deepseek-v4-flash', 10, 100000, 100000, 0.9), row('chat', 'claude-haiku-4-5', 5, 500, 500, 0.01)], models);
  assert.ok(find(r, 'top:shares_observation'));
  assert.ok(find(r, 'unpriced') && /deepseek-v4-flash/.test(find(r, 'unpriced').title));
}
// order: savings first, biggest first; notes last
{
  const r = buildInsights([row('tasks', 'claude-sonnet-4-6', 20, 20000, 4000, 0.12), row('goals', 'claude-opus-4-6', 20, 20000, 4000, 0.6), row('shares_observation', 'deepseek-v4-flash', 10, 100000, 100000, 0.9)], models);
  const kinds = r.observations.map((o) => o.kind);
  assert.deepStrictEqual(kinds, [...kinds].sort((a, b) => ({ save: 0, quality: 1, tune: 2, note: 3 }[a] - { save: 0, quality: 1, tune: 2, note: 3 }[b])));
  const saves = r.observations.filter((o) => o.kind === 'save');
  assert.ok(saves[0].saving >= saves[1].saving);
}
// nothing in, nothing out
assert.deepStrictEqual(buildInsights([], models), { observations: [], calls: 0, cost: 0 });

console.log('usageInsights tests passed');
