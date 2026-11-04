// node client/src/pages/domains/briefSummary.test.mjs   (the brief as one sentence, and the client lists match the server's)
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { briefSummary, toneWords } from './briefSummary.mjs';
import { ENDINGS, PLATFORMS, STYLES, TONES, BLANK_BRIEF, splitWords } from './constants.mjs';

const require = createRequire(import.meta.url);

// the brief example: "Short invented names, playful but premium, .com.au required."
assert.strictEqual(
  briefSummary({ styles: ['invented'], tone: { playfulSerious: 2, premiumApproachable: 1 }, required: { tlds: ['com.au'], platforms: [] } }),
  'Invented word names, playful but very premium, .com.au required.',
);
assert.strictEqual(briefSummary(BLANK_BRIEF), 'Names in any style.');
assert.strictEqual(
  briefSummary({ styles: ['metaphor', 'compound', 'personal'], tone: { localGlobal: 5 }, include: ['harbour', 'light'], avoid: ['wine'], required: { tlds: ['com.au', 'org'], platforms: ['instagram', 'tiktok'] }, own: 'The Staircase Suitcase\nDorothy Stoner' }),
  'Metaphor, compound and founder or personal name names, very global, built around harbour and light, avoiding wine, .com.au and .org required, free on Instagram and TikTok. Includes your 2 own names.',
);
assert.match(briefSummary({ own: 'Dorothy Stoner' }), /Includes your own name\.$/);
assert.deepStrictEqual(toneWords({ playfulSerious: 3 }), []);
assert.deepStrictEqual(toneWords({ playfulSerious: 1, modernClassic: 4 }), ['very playful', 'classic']);
assert.deepStrictEqual(toneWords(null), []);

assert.deepStrictEqual(splitWords(' Harbour, light;  HARBOUR\nsea '), ['harbour', 'light', 'sea']);
assert.deepStrictEqual(splitWords(''), []);
assert.strictEqual(splitWords('a,b,c,d,e,f,g,h,i,j').length, 8);

// the lists the page offers are the lists the server accepts
{
  const server = require('../../../../server/services/domainSets.js');
  const brief = require('../../../../server/services/domainNaming/brief.js');
  assert.deepStrictEqual(ENDINGS, server.ENDINGS);
  assert.deepStrictEqual(STYLES.map((s) => s[0]), brief.STYLE_IDS);
  assert.deepStrictEqual(STYLES.map((s) => s[1]), brief.STYLES.map((s) => s[1]));
  assert.deepStrictEqual(TONES, brief.TONES);
  // the server accepts every platform the page offers
  const cleaned = server.cleanRequirements({ tlds: ENDINGS, platforms: PLATFORMS.map((p) => p[0]) });
  assert.deepStrictEqual(cleaned.platforms, PLATFORMS.map((p) => p[0]));
  // a blank brief survives the server's cleaner unchanged
  assert.deepStrictEqual(brief.cleanBrief(BLANK_BRIEF), BLANK_BRIEF);
}

console.log('briefSummary tests passed');
