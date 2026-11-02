'use strict';

// node server/services/guitarTutor.test.js. No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./guitarTutor');

checkGuide({
  name: 'guitarTutor',
  service,
  askName: 'askGuitarTutor',
  feature: 'guitar_guide',
  toolsFile: 'guitar/guitarTools.mjs',
  menuExport: 'GUITAR_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'tempo',
  exampleStepId: 'loops',
  facts: [
    ['status', 'does', /14 days/, 'rusty after 14 days'],
    ['add-song', 'does', /Ultimate Guitar.*Upload audio.*Manual chart/s, 'the three ways to add a song'],
    ['capo', 'notes', /does not rename/, 'the capo does not rename chords'],
    ['chart', 'does', /Double-click/, 'double-click corrects a chord'],
    ['numerals', 'notes', /guess/, 'the detected key is a guess'],
    ['capo-advice', 'does', /fewest barre/, 'the capo advice minimises barre chords'],
    ['tempo', 'does', /without changing the pitch/, 'slowdown keeps the pitch'],
    ['tempo', 'notes', /not locked to the recording/, 'the click is not synced'],
    ['minute-drill', 'notes', /tapping/, 'drills are counted by tapping'],
    ['weekly-review', 'does', /AI only writes the sentences/, 'AI only writes the wording'],
    ['session-builder', 'does', /adds up to the time you chose/, 'the plan adds up to the time'],
    ['explain-song', 'notes', /chart only/, 'explain reads the chart, not the recording'],
    ['coach', 'notes', /does not listen/, 'the coach does not listen'],
    ['simplify', 'does', /F for Fmaj7/, 'the example substitution'],
    ['simplify', 'notes', /sound a little different/, 'a swapped chord sounds different'],
    ['simplify', 'notes', /only how the chart is shown/, 'the saved chords are not changed'],
    ['learn', 'does', /only those chords/, 'songs use only the ticked chords'],
    ['my-chords', 'notes', /cannot hear you/, 'the tick is the persons own honest tick'],
    ['learn-next', 'does', /unlocks/, 'a suggestion says how many songs it unlocks'],
    ['song-roadmap', 'notes', /does not simplify/, 'no simplification yet'],
    ['ear', 'notes', /not from the recording/, 'ear training uses a synth, not the recording'],
    ['play-mode', 'does', /foot pedal or Bluetooth page turner/, 'pedals and page turners work through the arrow keys'],
    ['play-mode', 'notes', /does not listen/, 'play mode does not listen'],
    ['set-lists', 'notes', /does not delete its songs/, 'deleting a set list keeps the songs'],
    ['played', 'notes', /does not count as practice/, 'capo and transpose are not practice'],
  ],
  gaps: [/Hearing whether you played a chord cleanly/, /Listening to you play/, /Tabs or sheet music/, /Spotify/, /Ear training from the recording/, /live band/, /Sharing songs/],
  rules: [/14 days/, /guesses/, /AI only writes the wording/, /Open buttons in this chat only switch/],
  system: [/cannot see any of their songs/],
}).catch((e) => { console.error(e); process.exit(1); });
