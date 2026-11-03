// What the Guitar page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids are
// the guide's catalogue (server/services/guitarTutor.js); node server/services/guitarTutor.test.js fails if the two lists drift apart.
// The page's menu is its four tabs (Coach, Drills, Strum, Library; a song opens inside Library). `tool` on a guide entry says which tab its Open button switches to.

export const GUITAR_TOOLS = [
  { id: 'coach', label: 'Coach', group: 'Practise', tab: 'Coach' },
  { id: 'drills', label: 'Drills', group: 'Practise', tab: 'Drills' },
  { id: 'strum', label: 'Strum', group: 'Practise', tab: 'Strum' },
  { id: 'library', label: 'Library', group: 'Songs', tab: 'Library' },
];

export const GROUPS = ['Practise', 'Songs'];

export const GROUP_TIPS = {
  Practise: 'A session built to your time, and the chord changes and strumming to drill.',
  Songs: 'Your songs, and the chart and tools for the one you have open.',
};

export const TOOL_TIPS = {
  coach: 'Coach: a practice session built to the time you have, with chord changes practised as routes through the chords between.',
  drills: 'Drills: practise the chord changes your own songs use most, one minute at a time.',
  strum: 'Strum: strumming arrows that move with the beat, a backing band, a fingerpicking ladder and a gap click.',
  library: 'Library: add songs, say how well you know each one, and open one to see its chart, loops, key and capo.',
};

export const TOOL_BLURBS = {
  coach: 'Session builder.',
  drills: 'One-minute chord change drills.',
  strum: 'Strumming arrows, the pattern ladder, the fingerpicking ladder and the gap click.',
  library: 'Add songs, set their status and open a song to play along.',
};

// The longer text for the (i) "How Guitar works" box.
export const HOW_IT_WORKS = [
  ['Songs', 'Add a song from an Ultimate Guitar chords page, upload an audio file and let Vault work out the chords, or start a blank chart and type them in. Detection from audio is a guess, so check the chords and correct any that are wrong.'],
  ['Status', 'Mark each song Learning, Polishing or Ready. A Polishing or Ready song turns Rusty if you leave it unplayed for 14 days. Press I played this to log a session with minutes, how clean it was and a note.'],
  ['Opening a song', 'Press a song in Library and it opens in place (All songs takes you back to the list). It shows the chart, plays the song and follows along. Transpose it, set the capo, click a chord to hear it and see its shapes, and double-click one to correct it. Play the song and the chart keeps the current chord in view.'],
  ['Loops and tempo', 'Save a section as a loop, then slow it down without changing the pitch. The trainer can step the speed up after clean passes, count you in, click along and chart the speed you reach.'],
  ['Key and capo', 'Shows the key, a Roman numeral under each chord (borrowed chords and chords that lead somewhere else are marked) and the capo position with the fewest barre chords. Under it, Sing it in your range takes the lowest and highest notes you can sing comfortably (picked from a list, with a Hear button; nothing is recorded) and suggests the key that suits your voice for the open song, with a button to move the chart there.'],
  ['Words you do not know', 'Words with a dotted underline, such as capo, barre or sus4, can be pressed for a two-line explanation and a small drawing. The Words guitarists use button at the top of the page opens a searchable list of all of them.'],
  ['Coach', 'Builds a practice session of exactly the time you have from your own songs, loops and chord changes. A chord change comes as a route (for example C#m to E by way of the chords between them, taken from a real progression), practised slowly first and then faster. The plan is worked out in Vault; AI only writes the wording.'],
  ['Backing band', 'On the Strum tab, drums and a bass play along with the arrows so practice feels like playing in a band. Choose a drum beat and a bass style, then the chords the bass follows: a well-known progression in a key you pick, or the chords of one of your songs, a bar each. The chord for the bar shows above the arrows. All of it is made in your browser.'],
  ['Strumming', 'Shows a strumming pattern as arrows that move with a click, so you can see which swings hit the strings and which are air swings. The pattern ladder starts with a down strum on every beat and adds one up strum at a time until you reach the full pattern. You can change the tempo while it plays, or match the tempo of one of your songs.'],
  ['Fingerpicking', 'Under the strumming on the Strum tab, a six-step ladder teaches fingerpicking: the thumb alone, a pinch, rolling up the strings, up and back down, alternating bass and then Travis picking. A small tab for the chord you choose (C, G, Am, Em, D, Dm, A or E) lights up each note in time with a click, with the picking finger under it (p thumb, i index, m middle, a ring), and you can hear every note. The strings and frets come from a checked table, not a guess. Vault cannot hear you, so you tick a step as comfortable yourself.'],
  ['Gap click', 'At the bottom of the Strum tab, a metronome that goes quiet on purpose. You tap on every beat (the big button or the space bar) and keep tapping through the silence. Five steps add more silence each time, from one missing beat to seven missing bars. Vault measures only your taps, never your guitar: it works out your usual tap delay while the click is on, takes it off, and says whether your beat stayed steady, rushed or dragged once the click was gone. One steady run clears a step.'],
  ['Play mode and set lists', 'Play mode opens a big chart for performing. It moves along at the song tempo, or one chord at a time from the keyboard, and foot pedals and Bluetooth page turners work because they send arrow and Page keys. Set lists (in the Library) put songs in playing order and open them in play mode.'],
  ['Drills', 'Finds the chord changes your own songs use most, worst first, and says in plain words how often your songs make each one and how your drills are going. Press Drill and choose what to practise for the minute: just the two chords, or a progression that goes between them through other chords (for A and E, for example, A to D to E and back). Suggestions come from well-known progressions in the key the two chords share, and say which chords are new to you. Under the choices, Finger moves shows for every change which notes can stay held (ringed on small chord diagrams), which fingers slide or move and where to, and which lift or land, with a tip. Tap for every clean change and the score is kept. Above the cards, Major and minor pairs (E and Em, A and Am, D and Dm) shows the one note that changes between each pair, plays them one after the other, and starts the same one-minute drill on the pair. The Barre chord ladder under it takes the barre chord in five steps (two strings, the mini F, the full F, B flat, then sliding the shape up the neck); a step is cleared with three clean ten-second holds, where every string must ring.'],
];

// Everything the guide can point at: the four tabs plus the controls inside them. `tool` is the tab the Open button switches to.
export const GUIDE_TOOLS = [
  { id: 'coach', label: 'Coach', tool: 'coach' },
  { id: 'drills', label: 'Drills', tool: 'drills' },
  { id: 'strum', label: 'Strum', tool: 'strum' },
  { id: 'library', label: 'Library', tool: 'library' },
  { id: 'played', label: 'I played this', tool: 'library' },
  { id: 'status', label: 'Song status', tool: 'library' },
  { id: 'add-song', label: 'Add a song', tool: 'library' },
  { id: 'transpose', label: 'Transpose', tool: 'library' },
  { id: 'capo', label: 'Capo', tool: 'library' },
  { id: 'chart', label: 'Chord chart', tool: 'library' },
  { id: 'add-chord', label: 'Add chord at playhead', tool: 'library' },
  { id: 'numerals', label: 'Key and Roman numerals', tool: 'library' },
  { id: 'simplify', label: 'Make it easier', tool: 'library' },
  { id: 'sing-range', label: 'Sing it in your range', tool: 'library' },
  { id: 'capo-advice', label: 'Easiest capo', tool: 'library' },
  { id: 'loops', label: 'Practice loops', tool: 'library' },
  { id: 'tempo', label: 'Tempo trainer', tool: 'library' },
  { id: 'glossary', label: 'Words guitarists use', tool: 'library' },
  { id: 'session-builder', label: 'Build a session', tool: 'coach' },
  { id: 'explain-song', label: 'Explain this song', tool: 'library' },
  { id: 'backing-band', label: 'Backing band', tool: 'strum' },
  { id: 'strum-pattern', label: 'Strumming pattern', tool: 'strum' },
  { id: 'pattern-ladder', label: 'Pattern ladder', tool: 'strum' },
  { id: 'fingerpicking', label: 'Fingerpicking ladder', tool: 'strum' },
  { id: 'gap-click', label: 'Gap click', tool: 'strum' },
  { id: 'major-minor-pairs', label: 'Major and minor pairs', tool: 'drills' },
  { id: 'barre-ladder', label: 'Barre chord ladder', tool: 'drills' },
  { id: 'set-lists', label: 'Set lists', tool: 'library' },
  { id: 'play-mode', label: 'Play mode', tool: 'library' },
  { id: 'finger-moves', label: 'Finger moves', tool: 'drills' },
  { id: 'minute-drill', label: 'One-minute drill', tool: 'drills' },
];
