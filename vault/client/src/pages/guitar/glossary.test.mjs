// node client/src/pages/guitar/glossary.test.mjs
import assert from 'node:assert';
import { GLOSSARY, getTerm, findTerms, searchGlossary } from './glossary.mjs';

// Every entry is complete and short enough to read at a glance
assert.ok(GLOSSARY.length >= 25);
assert.strictEqual(new Set(GLOSSARY.map(g => g.id)).size, GLOSSARY.length, 'unique ids');
for (const g of GLOSSARY) {
  assert.ok(g.term && g.short, `${g.id} has a name and an explanation`);
  assert.ok(g.short.length >= 40 && g.short.length <= 200, `${g.id}: two lines at most (${g.short.length} characters)`);
  assert.ok(/^[A-Z]/.test(g.short) && /[.?!]$/.test(g.short), `${g.id}: a full sentence`);
  assert.ok(Array.isArray(g.aliases), `${g.id} lists its aliases`);
  if (g.auto !== false) assert.ok(g.aliases.length > 0, `${g.id} can be found in text`);
  if (g.diagram?.kind === 'chord') {
    const s = g.diagram.shape;
    assert.strictEqual(s.fretPositions.length, 6, `${g.id}: six strings`);
    assert.strictEqual(s.fingerPositions.length, 6);
    assert.ok(s.fretPositions.every(f => Number.isInteger(f) && f >= -1 && f <= 12));
    assert.ok(s.fretPositions.some(f => f > 0), `${g.id}: at least one finger down`);
  } else if (g.diagram) {
    assert.ok(['capo', 'strum', 'hammer', 'pulloff', 'neck'].includes(g.diagram.kind), `${g.id}: a diagram that exists`);
  }
}
// An alias belongs to one term only, or the same word would open two different explanations
const owner = new Map();
for (const g of GLOSSARY) for (const a of g.aliases) {
  const k = a.toLowerCase();
  assert.ok(!owner.has(k) || owner.get(k) === g.id, `"${a}" is claimed by both ${owner.get(k)} and ${g.id}`);
  owner.set(k, g.id);
}
// The words the plan asks for are there
for (const id of ['capo', 'barre', 'sus4', 'hammer-on']) assert.ok(getTerm(id), `${id} is in the glossary`);
assert.strictEqual(getTerm('nope'), null);

// Finding terms in a sentence
const join = (parts) => parts.map(p => p.text).join('');
const sentence = 'Put a capo on fret 3, then swap the F barre chord for Fmaj7 or Dsus4. A Capo helps.';
const parts = findTerms(sentence);
assert.strictEqual(join(parts), sentence, 'the pieces join back to the original');
const linked = parts.filter(p => p.id).map(p => `${p.text}=${p.id}`);
assert.deepStrictEqual(linked, ['capo=capo', 'fret=fret', 'barre chord=barre'], 'capo, fret and barre chord, once each');
assert.ok(!linked.some(l => l.startsWith('Fmaj7') || l.startsWith('Dsus4') || l.includes('maj7') || l.includes('sus4')), 'chord names are not linked');
// "barre chords" wins over "barre"
assert.deepStrictEqual(findTerms('Barre chords are hard.').filter(p => p.id).map(p => p.text), ['Barre chords']);
// Capitals do not matter and the original spelling is kept
assert.strictEqual(findTerms('The Capo is on.').find(p => p.id).text, 'Capo');
// Each term once only
assert.strictEqual(findTerms('capo capo capo').filter(p => p.id).length, 1);
// A word inside another word is left alone
assert.deepStrictEqual(findTerms('The capos, scapo and capology.').filter(p => p.id).map(p => p.text), [], 'no match inside other words ("capos" is not an alias)');
assert.deepStrictEqual(findTerms('Strumming and tempo, then loops.').filter(p => p.id).map(p => p.id), ['strum', 'bpm', 'loop']);
// Punctuation next to a term is fine
assert.deepStrictEqual(findTerms('(capo),').filter(p => p.id).map(p => p.id), ['capo']);
// "key" is too common to link by itself
assert.deepStrictEqual(findTerms('The key chord of the key.').filter(p => p.id), []);
assert.ok(getTerm('key'), 'but it can still be linked by name');
// Empty and odd input
assert.deepStrictEqual(findTerms(''), [{ text: '' }]);
assert.deepStrictEqual(findTerms(null), [{ text: '' }]);
assert.deepStrictEqual(findTerms('No special words here.'), [{ text: 'No special words here.' }]);
assert.strictEqual(join(findTerms('hammer-on, pull-off and slides')), 'hammer-on, pull-off and slides');
assert.deepStrictEqual(findTerms('hammer-on, pull-off').filter(p => p.id).map(p => p.id), ['hammer-on', 'pull-off']);
// A term at the very start and end
assert.deepStrictEqual(findTerms('capo').map(p => p.id), ['capo']);
assert.deepStrictEqual(findTerms('Use a capo').map(p => p.id || 'text'), ['text', 'capo']);

// Search
assert.strictEqual(searchGlossary('capo')[0].id, 'capo');
assert.ok(searchGlossary('suspended').some(g => g.id === 'sus4'));
assert.ok(searchGlossary('semitone').some(g => g.id === 'semitone'));
assert.ok(searchGlossary('flat across').some(g => g.id === 'barre'), 'finds words in the explanation');
assert.strictEqual(searchGlossary('zzzz').length, 0);
assert.strictEqual(searchGlossary('').length, GLOSSARY.length, 'empty search lists everything, in alphabetical order');
assert.strictEqual(searchGlossary('')[0].term, [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term))[0].term);

console.log('glossary tests passed');
