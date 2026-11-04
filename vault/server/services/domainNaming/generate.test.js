'use strict';
// node server/services/domainNaming/generate.test.js   (no network, no database: the model and DomScan are stood in)
const assert = require('assert');
const { generateRound, mapLimit, CHECK_BATCH, SHOW } = require('./generate');
const { cleanBrief } = require('./brief');

const brief = (o = {}) => cleanBrief({ what: 'Wine fridges for hotels', avoid: ['wine'], styles: ['invented', 'metaphor'], required: { tlds: ['com.au'], platforms: [] }, ...o });

// A stand-in for the data service: names ending in "x" are taken everywhere; names starting with "t" have .com.au taken; the rest are free.
const answer = (name) => ({
  results: ['com', 'com.au', 'org', 'io', 'ai', 'co', 'app'].map((tld) => ({
    domain: `${name}.${tld}`, tld,
    available: name.endsWith('x') ? false : (name.startsWith('t') && tld === 'com.au') ? false : true,
    source: 'rdap',
  })),
});
const calls = { status: [], model: [] };
const deps = (over = {}) => ({
  getModels: async () => ({ standard: 'test-model' }),
  callModel: async (model, prompt) => {
    calls.model.push(prompt);
    if (/ONLY a JSON array/.test(prompt)) {
      const names = [...prompt.matchAll(/^- (\w+)/gm)].map((m) => m[1]);
      return { text: JSON.stringify(names.map((n) => ({ name: n, reasoning: `Reason for ${n}.`, risks: [] }))), model, inputTokens: 1, outputTokens: 1 };
    }
    const lines = ['lumera|invented', 'tasmin|metaphor', 'tonelo|invented', 'zephyrx|invented', 'harbouria|metaphor', 'quillon|invented', 'bevaro|invented', 'googel|invented', 'getfridge|invented', 'winecool|invented', 'ab|invented', 'vexilar|metaphor', 'nordane|metaphor', 'solvane|invented', 'cinder|metaphor', 'marlow|invented', 'brindle|metaphor', 'kestrel|metaphor', 'ostra|invented', 'pellow|invented', 'ravine|metaphor', 'sorrel|metaphor', 'tamsin|invented', 'umbrex|invented', 'velora|invented', 'wrenly|invented', 'yarrow|metaphor', 'zinnia|metaphor'];
    return { text: lines.join('\n'), model, inputTokens: 1, outputTokens: 1 };
  },
  logUsage: (u) => { calls.usage = (calls.usage || []).concat(u.feature); },
  statusFor: async (name, tlds, maxAge) => { calls.status.push([name, maxAge]); return answer(name); },
  now: () => new Date('2026-11-05T01:00:00Z'),
  ...over,
});

(async () => {
  // a normal round
  {
    calls.status = []; calls.model = []; calls.usage = [];
    const r = await generateRound({ userId: 1, brief: brief(), round: 1 }, deps());
    const names = r.cards.map((c) => c.name);
    assert.ok(r.cards.length > 0 && r.cards.length <= SHOW);
    // bad names never reach a card or a lookup
    for (const bad of ['ab', 'googel', 'getfridge', 'winecool']) assert.ok(!names.includes(bad) && !calls.status.some(([n]) => n === bad), `${bad} was dropped before any lookup`);
    // the required ending taken (starts with t / ends with x): dropped after the lookup, counted
    assert.ok(!names.includes('tasmin') && !names.includes('tonelo') && !names.includes('zephyrx'));
    assert.ok(r.counts.takenDropped >= 3);
    // only the best few are looked up, one request each, and the lookups say how old an answer may be
    assert.ok(calls.status.length <= CHECK_BATCH);
    assert.strictEqual(r.creditsUsed, calls.status.length);
    assert.ok(calls.status.every(([, age]) => age > 0 && age <= 3600));
    assert.ok(r.counts.generated >= 25 && r.counts.passedFilters < r.counts.generated);
    // every card says why, has availability, and carries the facts the filters need
    for (const c of r.cards) {
      assert.match(c.reasoning, /^Reason for /);
      assert.strictEqual(c.domains.checkedAt, '2026-11-05T01:00:00.000Z');
      assert.strictEqual(c.domains.results.length, 7);
      assert.ok(c.syllables >= 1 && c.spell && Array.isArray(c.risks));
      assert.strictEqual(c.round, 1);
    }
    // names with the required ending positively free
    assert.ok(r.cards.every((c) => c.domains.results.find((x) => x.tld === 'com.au').available === true));
    assert.deepStrictEqual(calls.usage, ['domains_generate', 'domains_explain']);
    assert.strictEqual(r.checkedNames.length, calls.status.length, 'every looked-up name is reported, so it is not offered again');
    assert.ok(r.cards.every((c) => r.checkedNames.includes(c.name)));
  }

  // the person's own names are always there, first, even when taken or not wanted by the filters
  {
    const r = await generateRound({ userId: 1, brief: brief({ own: 'The Staircase Suitcase\nTaxitrex', required: { tlds: ['com.au'], platforms: [] } }) }, deps());
    const names = r.cards.map((c) => c.name);
    assert.deepStrictEqual(names.slice(0, 3), ['thestaircasesuitcase', 'staircasesuitcase', 'taxitrex'], 'own names lead');
    assert.ok(r.cards.slice(0, 3).every((c) => c.own === true && c.label));
    assert.strictEqual(r.cards[0].label, 'The Staircase Suitcase');
    // taxitrex starts with t (com.au taken) and ends with x, but is the person's own name: kept, with its true availability
    assert.strictEqual(r.cards[2].domains.results.find((x) => x.tld === 'com').available, false);
  }

  // names seen in an earlier round are not offered again
  {
    const r = await generateRound({ userId: 1, brief: brief(), seen: ['lumera', 'harbouria'] }, deps());
    assert.ok(!r.cards.some((c) => ['lumera', 'harbouria'].includes(c.name)));
  }

  // feedback reaches the AI
  {
    calls.model = [];
    await generateRound({ userId: 1, brief: brief(), feedback: { more: ['lumera'], less: ['zorbo'] } }, deps());
    assert.match(calls.model[0], /liked: lumera/);
    assert.match(calls.model[0], /disliked: zorbo/);
  }

  // explanations failing costs only the explanations
  {
    let n = 0;
    const d = deps({ callModel: async (m, p) => { n += 1; if (n === 2) throw new Error('model down'); return deps().callModel(m, p); } });
    const r = await generateRound({ userId: 1, brief: brief() }, d);
    assert.ok(r.cards.length > 0);
    assert.ok(r.cards.every((c) => c.reasoning === ''));
    assert.strictEqual(r.explainError, 'model down');
  }

  // every lookup failing is an error the person is told about, not an empty page
  await assert.rejects(generateRound({ userId: 1, brief: brief() }, deps({ statusFor: async () => { throw new Error('credits have run out'); } })), /domain checks failed: credits have run out/);
  // one lookup failing leaves that name with unknown endings: still shown when nothing is required (with a required ending it would rank below names confirmed free)
  {
    const d = deps({ statusFor: async (name, t, a) => { if (name === 'lumera') throw new Error('x'); return answer(name); } });
    const r = await generateRound({ userId: 1, brief: brief({ required: { tlds: [], platforms: [] } }) }, d);
    const c = r.cards.find((x) => x.name === 'lumera');
    assert.ok(c && c.domains.results.length === 0, 'an unanswered name is shown with nothing confirmed');
  }
  // no model, no usable names
  await assert.rejects(generateRound({ userId: 1, brief: brief() }, deps({ getModels: async () => ({}) })), /No AI model/);
  await assert.rejects(generateRound({ userId: 1, brief: brief() }, deps({ callModel: async () => ({ text: 'sorry I cannot' }) })), /did not return usable names/);

  // variations: made by code (no wide AI call), judged only for avoided and seen, reasoned locally
  {
    calls.model = []; calls.status = [];
    const r = await generateRound({ userId: 1, brief: brief({ include: ['cellar'] }), mode: 'variations', seed: 'lumera', round: 2 }, deps());
    assert.strictEqual(calls.model.length, 0, 'no AI call for variations');
    const names = r.cards.map((c) => c.name);
    assert.ok(names.includes('getlumera') || names.includes('lumeraly'), names.join(','));
    assert.ok(r.cards.every((c) => /^A variation of "lumera"/.test(c.reasoning) && c.round === 2));
    assert.ok(calls.status.length <= 24 + 1);
  }
  // variations do not add or re-check the person's own names
  {
    calls.status = [];
    const r = await generateRound({ userId: 1, brief: brief({ own: 'The Staircase Suitcase' }), mode: 'variations', seed: 'lumera' }, deps());
    assert.ok(!r.cards.some((c) => c.own) && !calls.status.some(([n]) => /staircase/.test(n)));
  }

  // the concurrency limiter never runs more than the limit at once
  {
    let live = 0; let peak = 0;
    const out = await mapLimit(Array.from({ length: 30 }, (_, i) => i), 8, async (i) => { live += 1; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live -= 1; return i * 2; });
    assert.ok(peak <= 8 && peak > 1);
    assert.deepStrictEqual(out, Array.from({ length: 30 }, (_, i) => i * 2), 'order is kept');
  }

  console.log('generate tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
