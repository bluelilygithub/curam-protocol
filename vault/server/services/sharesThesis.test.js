'use strict';

// node server/services/sharesThesis.test.js   No model is called and no database is needed.

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://x@127.0.0.1:1/x';
const assert = require('assert');
const svc = require('./sharesThesis');

// ---- input cleaning ----
assert.strictEqual(svc.sanitizeThesisInput({}).error, 'symbol is required');
assert.ok(svc.sanitizeThesisInput({ symbol: 'nvda' }).error, 'empty thesis refused');
const ok = svc.sanitizeThesisInput({
  symbol: ' nvda ', exchange: 'nasdaq', thesis: 'AI chips',
  assumptions: ['Data-centre revenue keeps growing', { text: 'Margins stay above 60%', how: 'quarterly results' }, '  '],
  redLines: [{ text: 'Loses a top customer' }],
  anchors: { optimistic: '$200' },
}).value;
assert.strictEqual(ok.symbol, 'NVDA');
assert.strictEqual(ok.exchange, 'NASDAQ');
assert.strictEqual(ok.assumptions.length, 2, 'blank assumption dropped, plain strings accepted');
assert.strictEqual(ok.assumptions[1].how, 'quarterly results');
assert.strictEqual(svc.sanitizeThesisInput({ symbol: 'A', thesis: 'x', assumptions: Array(20).fill('a') }).value.assumptions.length, 7, 'capped at 7');

const thesis = {
  symbol: 'NVDA', exchange: 'NASDAQ', thesis: 'AI chips',
  assumptions: [{ text: 'A1' }, { text: 'A2' }, { text: 'A3' }],
  redLines: [{ text: 'R1' }, { text: 'R2' }],
};

// ---- reply parsing ----
const good = svc.parseCheckReply('Here you go:\n' + JSON.stringify({
  assumptions: [
    { n: 1, rating: 'intact', evidence: '' },
    { n: 2, rating: 'weakening', evidence: '2026-10-30 briefing: margins guided lower' },
    { n: 3, rating: 'broken', evidence: '' }, // no evidence: must become unclear
  ],
  redLines: [{ n: 1, triggered: true, evidence: '' }, { n: 2, triggered: false, evidence: '' }],
  drift: [{ dimension: 'moat', change: 'weakened', evidence: '' }, { dimension: 'valuation', change: 'improved', evidence: 'price fell 20%' }],
  summary: 'ok', watchNext: 'next results',
}), thesis);
assert.deepStrictEqual(good.ratings.map((r) => r.rating), ['intact', 'weakening', 'unclear'], 'rating without evidence is downgraded to unclear');
assert.strictEqual(good.redLineHits.length, 0, 'a triggered red line with no evidence does not count');
assert.strictEqual(good.drift.find((d) => d.dimension === 'moat').change, 'unclear', 'drift without evidence is not claimed');
assert.strictEqual(good.drift.find((d) => d.dimension === 'valuation').change, 'improved');

const junk = svc.parseCheckReply('I cannot do that', thesis);
assert.deepStrictEqual(junk.ratings.map((r) => r.rating), ['unclear', 'unclear', 'unclear'], 'unreadable reply is all unclear, never a made-up rating');
assert.strictEqual(svc.parseCheckReply('{bad json', thesis).ratings.length, 3);
assert.strictEqual(svc.parseCheckReply(JSON.stringify({ assumptions: [{ n: 1, rating: 'sell now', evidence: 'x' }] }), thesis).ratings[0].rating, 'unclear', 'a word outside the allowed ratings is dropped');

// ---- scoring (done here, not by the model) ----
const r = (...ratings) => ratings.map((rating, i) => ({ n: i + 1, rating }));
assert.deepStrictEqual(svc.scoreCheck({ ratings: r('intact', 'intact', 'intact') }), { healthScore: 10, verdict: 'intact' });
assert.deepStrictEqual(svc.scoreCheck({ ratings: r('intact', 'weakening', 'intact') }), { healthScore: 9, verdict: 'weakening' });
assert.deepStrictEqual(svc.scoreCheck({ ratings: r('impaired', 'intact') }), { healthScore: 8, verdict: 'impaired' });
assert.deepStrictEqual(svc.scoreCheck({ ratings: r('broken', 'intact') }), { healthScore: 7, verdict: 'broken' });
assert.deepStrictEqual(svc.scoreCheck({ ratings: r('unclear', 'unclear') }), { healthScore: 10, verdict: 'unclear' }, 'no evidence is not a pass');
assert.strictEqual(svc.scoreCheck({ ratings: r('intact'), redLineHits: [{ n: 1 }] }).verdict, 'red-line', 'a red line outranks intact assumptions');
assert.strictEqual(svc.scoreCheck({ ratings: r('intact'), redLineHits: [{ n: 1 }] }).healthScore, 7);
assert.strictEqual(svc.scoreCheck({ ratings: r('broken', 'broken', 'broken'), redLineHits: [{}, {}] }).healthScore, 0, 'never below 0');
assert.strictEqual(svc.scoreCheck({ ratings: [] }).healthScore, null);
assert.strictEqual(svc.scoreCheck({ ratings: r('weakening', 'weakening', 'weakening', 'weakening', 'weakening', 'weakening') }).verdict, 'impaired', 'score of 5 or less is impaired');

// ---- the prompt keeps the advice rules and carries the evidence ----
for (const re of [/NOT evidence about a business assumption/, /Never say buy, sell, hold/, /no company filings/, /MUST quote the specific evidence/]) {
  assert.match(svc.SYSTEM_PROMPT, re);
}
const prompt = svc.buildCheckPrompt({
  thesis: { ...thesis, assumptions: [{ text: 'A1', how: 'results' }], redLines: [{ text: 'R1' }], anchors: { neutral: '$150' } },
  position: { quantity: 10, avgCostAud: 100, priceAud: 120, valueAud: 1200, pnlAud: 200, pnlPct: 20, dayChangePct: 1 },
  trades: [{ tradedAt: '2025-01-02', side: 'buy', quantity: 10, pricePerShare: 100 }],
  briefings: [{ date: '2026-10-30', signal: 'watch', priceChangePct: -3, content: 'Guidance cut' }],
  previous: { createdAt: '2026-08-01', verdict: 'intact', healthScore: 10, ratings: [{ n: 1, rating: 'intact', evidence: '' }], summary: 's', thesisSnapshot: { thesis: 'old words' } },
  today: '2026-11-07',
});
for (const re of [/TODAY: 2026-11-07/, /1\. A1 \(how to verify: results\)/, /Guidance cut/, /PREVIOUS CHECK \(2026-08-01\)/, /rewrote the thesis text.*old words/, /neutral: \$150/]) assert.match(prompt, re);
assert.match(svc.buildCheckPrompt({ thesis, position: null, trades: [], briefings: [], previous: null, today: 'x' }), /first check/);

console.log('sharesThesis.test.js: all passed');
process.exit(0);
