// The Guitar glossary: plain two-line explanations of the words a learner meets, with a small diagram where one helps. Pure data and matching
// (no browser): glossary.test.mjs checks every entry. A term can be linked by name (<GlossaryTerm id="capo">) or found automatically in a
// sentence (findTerms). `auto: false` keeps a very common word (such as "key") from being linked unless it is linked by name.
//
// diagram: { kind: 'chord', shape: { fretPositions: [low E .. high e], fingerPositions, baseFret } } | { kind: 'capo' | 'strum' | 'hammer' | 'pulloff' | 'neck' }

const chord = (fretPositions, fingerPositions, baseFret = 1) => ({ kind: 'chord', shape: { fretPositions, fingerPositions, baseFret } });

export const GLOSSARY = [
  { id: 'capo', term: 'Capo', aliases: ['capo'], short: 'A clamp across the neck that raises every string by the same number of frets. You play easy shapes and the song sounds higher.', diagram: { kind: 'capo' } },
  { id: 'barre', term: 'Barre chord', aliases: ['barre chords', 'barre chord', 'barre', 'barres'], short: 'One finger lies flat across all the strings at a fret, like a movable nut, while the other fingers make the shape. F is the first one most players meet.', diagram: chord([1, 3, 3, 2, 1, 1], [1, 3, 4, 2, 1, 1]) },
  { id: 'open-chord', term: 'Open chord', aliases: ['open chords', 'open chord', 'open shape', 'open shapes'], short: 'A chord that uses open strings, the ones you do not press, and needs no barre. G, C, D, Em and Am are open chords.', diagram: chord([-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]) },
  { id: 'sus2', term: 'sus2', aliases: ['sus2', 'suspended 2nd'], short: 'Suspended second: the third note of the chord is swapped for the second. It sounds open and unfinished. Asus2 is an easy one.', diagram: chord([-1, 0, 2, 2, 0, 0], [0, 0, 1, 2, 0, 0]) },
  { id: 'sus4', term: 'sus4', aliases: ['sus4', 'suspended 4th', 'suspended chord', 'suspended chords', 'suspended'], short: 'Suspended fourth: the third note is swapped for the fourth, which leans toward the plain chord. Dsus4 is an easy one.', diagram: chord([-1, -1, 0, 2, 3, 3], [0, 0, 0, 1, 2, 3]) },
  { id: 'maj7', term: 'maj7', aliases: ['maj7', 'major seventh', 'major 7th'], short: 'Major seventh: a major chord with a seventh note added. It sounds smooth and dreamy. Cmaj7 and Fmaj7 are easy.', diagram: chord([-1, 3, 2, 0, 0, 0], [0, 3, 2, 0, 0, 0]) },
  { id: 'seventh', term: 'Seventh (7)', aliases: ['dominant seventh', 'dominant 7th', 'seventh chord', 'seventh chords', 'seventh', '7th'], short: 'A major chord with a flattened seventh added. It sounds bluesy and wants to move on to another chord. G7 is a common one.', diagram: chord([3, 2, 0, 0, 0, 1], [3, 2, 0, 0, 0, 1]) },
  { id: 'minor', term: 'Minor', aliases: ['minor'], short: 'A minor chord or key sounds sadder than a major one. Its third note is one semitone lower. Am, Dm and Em are the open minor chords.', diagram: chord([-1, 0, 2, 2, 1, 0], [0, 0, 2, 3, 1, 0]) },
  { id: 'major', term: 'Major', aliases: ['major'], short: 'A major chord or key sounds bright and settled. Its third note is one semitone higher than in a minor chord.', diagram: chord([-1, 3, 2, 0, 1, 0], [0, 3, 2, 0, 1, 0]) },
  { id: 'dim', term: 'Diminished', aliases: ['diminished', 'dim chord', 'dim'], short: 'A tense chord built from stacked minor thirds. It often sits between two other chords and wants to move on.', diagram: chord([-1, 2, 3, 4, 3, -1], [0, 1, 2, 4, 3, 0]) },
  { id: 'aug', term: 'Augmented', aliases: ['augmented'], short: 'A major chord with its fifth raised one semitone. It sounds unsettled and dreamy.', diagram: chord([-1, 3, 2, 1, 1, 0], [0, 4, 3, 1, 2, 0]) },
  { id: 'hammer-on', term: 'Hammer-on', aliases: ['hammer-ons', 'hammer-on', 'hammer on', 'hammer ons'], short: 'Pick a note, then bring another finger down hard on a higher fret of the same string. The second note sounds without picking again.', diagram: { kind: 'hammer' } },
  { id: 'pull-off', term: 'Pull-off', aliases: ['pull-offs', 'pull-off', 'pull off', 'pull offs'], short: 'The opposite of a hammer-on: as you lift a finger off, flick the string sideways so the lower note sounds without picking again.', diagram: { kind: 'pulloff' } },
  { id: 'slide', term: 'Slide', aliases: ['slides'], short: 'Pick a note, then move the same finger along the string to another fret while it rings, without lifting it.' },
  { id: 'strum', term: 'Strum', aliases: ['strumming', 'strum', 'strums', 'down strum', 'up strum', 'down strums', 'up strums', 'downstrum', 'upstrum'], short: 'Brushing the pick or your fingers across several strings. A down strum moves toward the floor, an up strum toward the ceiling.', diagram: { kind: 'strum' } },
  { id: 'air-swing', term: 'Air swing', aliases: ['air swings', 'air swing'], short: 'A swing of your strumming arm that misses the strings. The arm keeps moving so the rhythm stays steady, but nothing sounds.' },
  { id: 'bpm', term: 'Tempo and bpm', aliases: ['beats a minute', 'beats per minute', 'bpm', 'tempo'], short: 'Beats per minute: how fast the song goes. At 60 bpm there is one beat every second.' },
  { id: 'transpose', term: 'Transpose', aliases: ['transposed', 'transposing', 'transpose'], short: 'Move every chord up or down by the same number of semitones, so the song suits your voice or is easier to play.' },
  { id: 'key', term: 'Key', aliases: [], auto: false, short: 'The home note and scale a song is built on. A song feels finished when it comes back to its home chord.' },
  { id: 'roman-numeral', term: 'Roman numeral', aliases: ['roman numerals', 'roman numeral'], short: 'A way to name a chord by its place in the key (I, IV, V, vi) instead of its letter, so songs in different keys can be compared.' },
  { id: 'tonic', term: 'Tonic', aliases: ['tonic'], short: 'The home chord of a key: I in a major key and i in a minor key. Songs usually start and end on it.' },
  { id: 'secondary-dominant', term: 'Secondary dominant', aliases: ['secondary dominants', 'secondary dominant'], short: 'A chord that points strongly at another chord in the key, like a signpost. In C major, an E chord points to Am.' },
  { id: 'borrowed', term: 'Borrowed chord', aliases: ['borrowed chords', 'borrowed chord', 'borrowed from'], short: 'A chord taken from the matching major or minor key, such as Bb in C major. It adds colour without changing the key.' },
  { id: 'semitone', term: 'Semitone', aliases: ['semitones', 'semitone'], short: 'The smallest step on the guitar: one fret. Twelve semitones make an octave.' },
  { id: 'fret', term: 'Fret', aliases: ['frets', 'fret'], short: 'The metal strips along the neck. Each fret you move up raises the note by one semitone.', diagram: { kind: 'neck' } },
  { id: 'fretboard', term: 'Fretboard', aliases: ['fretboard'], short: 'The front of the guitar neck where the frets are and where your fingers press the strings.', diagram: { kind: 'neck' } },
  { id: 'progression', term: 'Chord progression', aliases: ['chord progression', 'chord progressions', 'progression', 'progressions'], short: 'A series of chords played in order, such as G, C, D. Most songs repeat one or two progressions.' },
  { id: 'tuning', term: 'Standard tuning', aliases: ['standard tuning', 'tuning'], short: 'How the six strings are set. Standard tuning is E A D G B e from the thickest string to the thinnest.' },
  { id: 'voicing', term: 'Voicing', aliases: ['voicings', 'voicing'], short: 'One particular way of playing a chord. The same chord can be played in several places on the neck.' },
  { id: 'loop', term: 'Loop', aliases: ['loops', 'loop'], short: 'A short part of a song that repeats over and over so you can practise it until it is smooth.' },
];

const byId = new Map(GLOSSARY.map(g => [g.id, g]));
export const getTerm = (id) => byId.get(id) || null;

// Longest alias first, so "barre chords" wins over "barre", and "sus4" is not cut out of the middle of another word
const ALIASES = GLOSSARY.filter(g => g.auto !== false)
  .flatMap(g => g.aliases.map(a => ({ id: g.id, alias: a })))
  .sort((a, b) => b.alias.length - a.alias.length);

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A word boundary that treats letters, digits and a hyphen inside a word as part of it, so "Dsus4", "Fmaj7" and "co-capo" are not linked
const RE = ALIASES.length
  ? new RegExp(`(?<![\\p{L}\\p{N}])(${ALIASES.map(a => escape(a.alias)).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  : null;
const aliasToId = new Map(ALIASES.map(a => [a.alias.toLowerCase(), a.id]));

/**
 * Split a sentence into plain pieces and glossary terms. Each term is linked once per call (the first time it appears), so a paragraph is
 * not covered in underlines. Returns [{ text } | { text, id }] in order, and the pieces always join back to the original text.
 */
export function findTerms(text) {
  const str = String(text ?? '');
  if (!RE || !str) return [{ text: str }];
  const out = [];
  const seen = new Set();
  let last = 0;
  RE.lastIndex = 0;
  for (let m = RE.exec(str); m; m = RE.exec(str)) {
    const id = aliasToId.get(m[1].toLowerCase());
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (m.index > last) out.push({ text: str.slice(last, m.index) });
    out.push({ text: m[1], id });
    last = m.index + m[1].length;
  }
  if (last < str.length) out.push({ text: str.slice(last) });
  return out.length ? out : [{ text: str }];
}

/** Terms whose name, aliases or explanation contain the search words (all of them), best matches first. */
export function searchGlossary(query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return GLOSSARY.slice().sort((a, b) => a.term.localeCompare(b.term));
  const scored = [];
  for (const g of GLOSSARY) {
    const name = `${g.term} ${g.aliases.join(' ')}`.toLowerCase();
    const body = g.short.toLowerCase();
    if (!words.every(w => name.includes(w) || body.includes(w))) continue;
    scored.push({ g, score: words.reduce((n, w) => n + (name.includes(w) ? 2 : 0) + (g.term.toLowerCase().startsWith(w) ? 2 : 0), 0) });
  }
  return scored.sort((a, b) => b.score - a.score || a.g.term.localeCompare(b.g.term)).map(s => s.g);
}
