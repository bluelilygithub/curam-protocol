// What the Guitar page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids are
// the guide's catalogue (server/services/guitarTutor.js); node server/services/guitarTutor.test.js fails if the two lists drift apart.
// The page's menu is its four tabs. `tool` on a guide entry says which tab its Open button switches to.

export const GUITAR_TOOLS = [
  { id: 'today', label: 'Today', group: 'Practise', tab: 'Today' },
  { id: 'learn', label: 'Learn', group: 'Practise', tab: 'Learn' },
  { id: 'coach', label: 'Coach', group: 'Practise', tab: 'Coach' },
  { id: 'drills', label: 'Drills', group: 'Practise', tab: 'Drills' },
  { id: 'ear', label: 'Ear', group: 'Practise', tab: 'Ear' },
  { id: 'strum', label: 'Strum', group: 'Practise', tab: 'Strum' },
  { id: 'library', label: 'Library', group: 'Songs', tab: 'Library' },
  { id: 'player', label: 'Player', group: 'Songs', tab: 'Player' },
];

export const GROUPS = ['Practise', 'Songs'];

export const GROUP_TIPS = {
  Practise: 'What to play today, and the chord changes to drill.',
  Songs: 'Your songs, and the chart and tools for the one you have open.',
};

export const TOOL_TIPS = {
  today: 'Today: what to play in the time you have, picked from your own songs, loops and chord changes.',
  learn: 'Learn: tick the chords you can play, see which songs you can already play, and what to learn next.',
  coach: 'Coach: a weekly review of your practice, and a practice session built to the time you have.',
  drills: 'Drills: practise the chord changes your own songs use most, one minute at a time.',
  ear: 'Ear: train your ear on the chords and keys of your own songs.',
  strum: 'Strum: strumming arrows that move with the beat, and a ladder that builds up to a full pattern.',
  library: 'Library: add songs and say how well you know each one.',
  player: 'Player: the chord chart for the open song, with playback, loops, the key and the capo.',
};

export const TOOL_BLURBS = {
  today: 'What to play next.',
  learn: 'Chords I can play and songs I can play now.',
  coach: 'Weekly review and session builder.',
  drills: 'One-minute chord change drills.',
  ear: 'Name chords and numerals by ear.',
  strum: 'Strumming arrows and the pattern ladder.',
  library: 'Add songs and set their status.',
  player: 'Chart, loops, tempo trainer, key and capo.',
};

// The longer text for the (i) "How Guitar works" box.
export const HOW_IT_WORKS = [
  ['Songs', 'Add a song from an Ultimate Guitar chords page, upload an audio file and let Vault work out the chords, or start a blank chart and type them in. Detection from audio is a guess, so check the chords and correct any that are wrong.'],
  ['Status', 'Mark each song Learning, Polishing or Ready. A Polishing or Ready song turns Rusty if you leave it unplayed for 14 days. Press I played this to log a session with minutes, how clean it was and a note.'],
  ['Today', 'Gives you a short list for the time you have: a song you are learning, a loop to work up, a song going rusty, a song to polish and a chord change to drill.'],
  ['Player', 'Shows the chart, plays the song and follows along. Transpose it, set the capo, click a chord to hear it and see its shapes, and double-click one to correct it. Play the song and the chart keeps the current chord in view.'],
  ['Loops and tempo', 'Save a section as a loop, then slow it down without changing the pitch. The trainer can step the speed up after clean passes, count you in, click along and chart the speed you reach.'],
  ['Key and capo', 'Shows the key, a Roman numeral under each chord (borrowed chords and chords that lead somewhere else are marked) and the capo position with the fewest barre chords.'],
  ['Milestones and reassurance', 'The Today tab shows milestones such as your first chord, first barre chord, first full song and 30 clean changes a minute. They are worked out from what you have actually done, with how close you are to the next ones, and there is no streak to keep. When something is hard in a way that is normal (sore fingertips, buzzing strings, a stretchy G chord, a barre chord that will not ring) an Is this normal? note appears while it fits, and you can put it away for good.'],
  ['Words you do not know', 'Words with a dotted underline, such as capo, barre or sus4, can be pressed for a two-line explanation and a small drawing. The Learn tab also has a searchable list of all of them.'],
  ['Learn', 'Tick the chords you can play cleanly. Vault then shows the songs in your library that use only those chords, which chord to learn next and how many songs it opens up, and, for a song you want to play, the chords to learn first and the easier songs you unlock on the way.'],
  ['Coach', 'Writes a short review of your last seven days from your own practice, loops and drills, builds a practice session of exactly the time you have from your own songs, and can explain the chords of a song and suggest what to practise. The numbers and the plan are worked out in Vault; AI only writes the wording.'],
  ['Strumming', 'Shows a strumming pattern as arrows that move with a click, so you can see which swings hit the strings and which are air swings. The pattern ladder starts with a down strum on every beat and adds one up strum at a time until you reach the full pattern. You can change the tempo while it plays, or match the tempo of one of your songs.'],
  ['Ear training', 'Plays you a chord from your own songs and you name it, or plays the key chord and then another and you name its Roman numeral. Rounds are ten questions; the chords you miss come up more, and your scores are kept. The sound comes from a synth built into Vault, not from the recording.'],
  ['Play mode and set lists', 'Play mode opens a big chart for performing. It moves along at the song tempo, or one chord at a time from the keyboard, and foot pedals and Bluetooth page turners work because they send arrow and Page keys. Set lists (in the Library) put songs in playing order and open them in play mode.'],
  ['Drills', 'Finds the chord changes your own songs use most, worst first. Each drill is one minute of switching between two chords; tap for every clean change and the score is kept.'],
];

// Everything the guide can point at: the four tabs plus the controls inside them. `tool` is the tab the Open button switches to.
export const GUIDE_TOOLS = [
  { id: 'today', label: 'Today', tool: 'today' },
  { id: 'learn', label: 'Learn', tool: 'learn' },
  { id: 'coach', label: 'Coach', tool: 'coach' },
  { id: 'drills', label: 'Drills', tool: 'drills' },
  { id: 'ear', label: 'Ear', tool: 'ear' },
  { id: 'strum', label: 'Strum', tool: 'strum' },
  { id: 'library', label: 'Library', tool: 'library' },
  { id: 'player', label: 'Player', tool: 'player' },
  { id: 'played', label: 'I played this', tool: 'today' },
  { id: 'status', label: 'Song status', tool: 'library' },
  { id: 'add-song', label: 'Add a song', tool: 'library' },
  { id: 'transpose', label: 'Transpose', tool: 'player' },
  { id: 'capo', label: 'Capo', tool: 'player' },
  { id: 'chart', label: 'Chord chart', tool: 'player' },
  { id: 'add-chord', label: 'Add chord at playhead', tool: 'player' },
  { id: 'numerals', label: 'Key and Roman numerals', tool: 'player' },
  { id: 'simplify', label: 'Make it easier', tool: 'player' },
  { id: 'capo-advice', label: 'Easiest capo', tool: 'player' },
  { id: 'loops', label: 'Practice loops', tool: 'player' },
  { id: 'tempo', label: 'Tempo trainer', tool: 'player' },
  { id: 'milestones', label: 'Milestones', tool: 'today' },
  { id: 'is-this-normal', label: 'Is this normal?', tool: 'today' },
  { id: 'glossary', label: 'Words guitarists use', tool: 'learn' },
  { id: 'my-chords', label: 'Chords I can play', tool: 'learn' },
  { id: 'learn-next', label: 'Learn next', tool: 'learn' },
  { id: 'song-roadmap', label: 'I want to play a song', tool: 'learn' },
  { id: 'weekly-review', label: 'Weekly review', tool: 'coach' },
  { id: 'session-builder', label: 'Build a session', tool: 'coach' },
  { id: 'explain-song', label: 'Explain this song', tool: 'player' },
  { id: 'strum-pattern', label: 'Strumming pattern', tool: 'strum' },
  { id: 'pattern-ladder', label: 'Pattern ladder', tool: 'strum' },
  { id: 'ear-round', label: 'Ear training round', tool: 'ear' },
  { id: 'set-lists', label: 'Set lists', tool: 'library' },
  { id: 'play-mode', label: 'Play mode', tool: 'player' },
  { id: 'minute-drill', label: 'One-minute drill', tool: 'drills' },
];
