import assert from 'assert';
import { parseKey, keyLabel, analyseChord, estimateKey, optimiseCapo, capoAdvice, shapeCost, analyseSong, shapeAtCapo } from './theory.mjs';

// Key text from the audio detector
assert.deepStrictEqual(parseKey('C major'), { tonic: 0, mode: 'major' });
assert.deepStrictEqual(parseKey('A minor'), { tonic: 9, mode: 'minor' });
assert.deepStrictEqual(parseKey('Eb major'), { tonic: 3, mode: 'major' });
assert.strictEqual(parseKey('nonsense'), null);
assert.strictEqual(parseKey(null), null);
assert.strictEqual(keyLabel(parseKey('F# minor')), 'F# minor');

const C = parseKey('C major');
const a = (root, q = '') => analyseChord(C, root, q);

// Diatonic
assert.deepStrictEqual([a('C').numeral, a('D', 'm').numeral, a('E', 'm').numeral, a('F').numeral, a('G').numeral, a('A', 'm').numeral],
  ['I', 'ii', 'iii', 'IV', 'V', 'vi']);
assert.strictEqual(a('B', 'dim').numeral, 'vii°');
assert.strictEqual(a('G', '7').numeral, 'V7');
assert.strictEqual(a('F', 'maj7').numeral, 'IVmaj7');
assert.strictEqual(a('A', 'm7').numeral, 'vi7');
assert.ok(['C', 'D', 'E', 'F', 'G', 'A'].every((r, i) => a(r, ['', 'm', 'm', '', '', 'm'][i]).kind === 'diatonic'));

// Borrowed from the parallel minor
assert.strictEqual(a('Bb').kind, 'borrowed');
assert.strictEqual(a('Bb').numeral, 'bVII');
assert.strictEqual(a('Ab').numeral, 'bVI');
assert.strictEqual(a('F', 'm').numeral, 'iv');
assert.strictEqual(a('F', 'm').kind, 'borrowed');
assert.match(a('Bb').note, /parallel minor/);

// Secondary dominants: the example from the plan, E in C major is V of vi
const e = a('E');
assert.strictEqual(e.kind, 'secondary');
assert.strictEqual(e.numeral, 'V/vi');
assert.match(e.note, /V of vi/);
assert.match(e.note, /Am/);
assert.strictEqual(a('A', '7').numeral, 'V7/ii');
assert.strictEqual(a('D').numeral, 'V/V');
assert.strictEqual(a('C', '7').numeral, 'V7/IV');
assert.strictEqual(a('B', '7').numeral, 'V7/iii');

// Chromatic: nothing sensible to say
assert.strictEqual(a('F#', 'm').kind, 'chromatic');

// Minor key: V and V7 are ordinary, natural-minor steps have no flat
const Am = parseKey('A minor');
const m = (root, q = '') => analyseChord(Am, root, q);
assert.deepStrictEqual([m('A', 'm').numeral, m('C').numeral, m('D', 'm').numeral, m('E').numeral, m('F').numeral, m('G').numeral],
  ['i', 'III', 'iv', 'V', 'VI', 'VII']);
assert.strictEqual(m('E', '7').kind, 'diatonic');
assert.strictEqual(m('D').kind, 'borrowed');     // major IV from A major
assert.strictEqual(m('A', '7').numeral, 'V7/iv'); // leads to Dm
assert.strictEqual(analyseChord(null, 'C', ''), null);
assert.strictEqual(analyseChord(C, 'H', ''), null);

// Key estimate from chords
const ch = (...names) => names.map(n => ({ root: n.replace(/m$/, ''), quality: n.endsWith('m') ? 'm' : '' }));
assert.deepStrictEqual(estimateKey(ch('C', 'G', 'Am', 'F', 'C')), { tonic: 0, mode: 'major' });
assert.deepStrictEqual(estimateKey(ch('Am', 'F', 'C', 'G', 'Am')), { tonic: 9, mode: 'minor' });
assert.strictEqual(estimateKey([]), null);

// Capo: Bb F Gm Eb all need barres at capo 0; capo 3 turns them into G D Em C
const flat = ch('Bb', 'F', 'Gm', 'Eb');
const cap = optimiseCapo(flat);
assert.strictEqual(cap.best.capo, 3);
assert.strictEqual(cap.best.barres, 0);
assert.ok(cap.baseline.barres >= 3);
assert.deepStrictEqual(cap.best.shapes.map(s => s.shape).sort(), ['C', 'D', 'Em', 'G']);
assert.strictEqual(cap.best.shapes.find(s => s.concert === 'Bb').shape, 'G');
assert.strictEqual(capoAdvice(cap.best, parseKey('Bb major')), 'Capo 3, play G shapes');
assert.strictEqual(capoAdvice(cap.best, parseKey('G minor')), 'Capo 3, play Em shapes');
// Already easy: stay at capo 0
const easy = optimiseCapo(ch('G', 'C', 'D', 'Em'));
assert.strictEqual(easy.best.capo, 0);
assert.strictEqual(capoAdvice(easy.best, parseKey('G major')), 'No capo needed');
// Weight matters: a chord played often counts more than one played once
const weighted = optimiseCapo([...ch('F', 'F', 'F', 'F', 'F'), ...ch('C')]);
assert.ok(weighted.best.capo > 0 || weighted.best.barres === 0);
assert.strictEqual(optimiseCapo([]), null);
assert.strictEqual(shapeCost('F'), 3);
assert.strictEqual(shapeCost('Em'), 0);

// Whole-song analysis
const ev = (id, root, q = '') => ({ id, chordRoot: root, chordQuality: q });
const song = [ev(1, 'C'), ev(2, 'E'), ev(3, 'A', 'm'), ev(4, 'F'), ev(5, 'E'), ev(6, 'Bb'), ev(7, 'G')];
const an = analyseSong({ keyDetected: 'C major', chords: song });
assert.strictEqual(an.keySource, 'detected');
assert.strictEqual(an.byId.get(2).numeral, 'V/vi');
assert.deepStrictEqual(an.flagged.map(f => [f.label, f.count, f.kind]), [['E', 2, 'secondary'], ['Bb', 1, 'borrowed']]);
// Numerals do not change when the chart is transposed; the key and the capo advice follow it
const up = analyseSong({ keyDetected: 'C major', chords: song, transpose: 2 });
assert.strictEqual(up.byId.get(2).numeral, 'V/vi');
assert.strictEqual(up.playedKey.tonic, 2);
// No detected key: worked out from the chords
assert.strictEqual(analyseSong({ keyDetected: null, chords: song }).keySource, 'estimated');
// A key the person chose wins
assert.strictEqual(analyseSong({ keyDetected: 'C major', chords: song, keyOverride: { tonic: 9, mode: 'minor' } }).keySource, 'chosen');
assert.strictEqual(analyseSong({ keyDetected: 'C major', chords: [] }), null);
// Shape at capo
assert.strictEqual(shapeAtCapo('Bb', '', 0, 3), 'G');
assert.strictEqual(shapeAtCapo('Bb', '', 2, 5), 'G'); // transposed up 2 (to C), capo 5 -> G shape

console.log('theory tests passed');
