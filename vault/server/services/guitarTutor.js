'use strict';

// The Guitar guide (the round button on Vault's /guitar page): a person says what they want to do ("slow down a solo", "stop my
// songs going rusty", "find an easier way to play this song") and the guide points at the real controls, in order, or says plainly
// that Guitar does not do it. It only knows what is written here and it never sees a song, chord or score. Built on guideCore.js;
// the ids are the page's own, listed in client/src/pages/guitar/guitarTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'today', label: 'Today', group: 'Practise',
    does: 'The first tab. A short list for the time you have: one song you are learning, one loop to work up to speed, one song going rusty, one song to polish and one chord change to drill. Each card has Open and I played this, or Start drill.',
    notes: 'Songs and loops are picked from your own library; the list is empty until you have songs with a status.' },
  { id: 'learn', label: 'Learn', group: 'Practise',
    does: 'The tab that answers "what can I play?". Tick the chords you can play cleanly, and it lists the songs in your library that use only those chords, suggests which chord to learn next (for example "learn D and you can play 3 more songs") and, for a song you pick under I want to play, lays out the chords to learn first and the easier songs you unlock on the way.',
    notes: 'It works from the chords in your own songs, so it only knows songs you have added with chords. It does not check how you play: you tick a chord yourself.' },
  { id: 'coach', label: 'Coach', group: 'Practise',
    does: 'The tab with a weekly review and a session builder. Write my review gives a short summary of your last seven days: time played, loops you sped up, chord changes that are stalling and songs going rusty. Build my session makes a practice plan of exactly the time you pick, from your own songs, loops and chord changes, with a tip for each block.',
    notes: 'It reads your own practice log, loop speeds and drill scores, so it has little to say until you have logged some. It does not listen to you play.' },
  { id: 'ear', label: 'Ear', group: 'Practise',
    does: 'The tab for ear training with your own songs. Choose Name the chord or Name the numeral, then press Start a round of 10. You hear a chord and pick its name from four choices, or you hear the key chord and then another chord from one of your songs and pick its Roman numeral. The chords you miss come up more often, and your scores and most-missed chords are kept.',
    notes: 'The sound comes from a synth built into Vault, not from the recording. It uses the chords and keys of your own songs, so it needs a few songs with chords on their charts.' },
  { id: 'drills', label: 'Drills', group: 'Practise',
    does: 'The tab that lists the chord changes your own songs use most, worst first, with how often each appears, your last score and your best. Press Drill on one to start the one-minute drill.',
    notes: 'A change that appears only once in your songs is not listed. G to C and C to G count as one pair.' },
  { id: 'library', label: 'Library', group: 'Songs',
    does: 'The tab where songs are added and listed. Each song shows its key, tempo, length, a status badge and a status choice, with I played this and Remove.',
    notes: 'Open a song by clicking its row once the chords are ready.' },
  { id: 'player', label: 'Player', group: 'Songs',
    does: 'The tab for the open song: the chord chart with lyrics, playback (the audio file or a YouTube video), Transpose, Capo, loops, the tempo trainer, the key panel and the chord shapes.',
    notes: 'Open a song from the Library or Today first; with none open it says to select one.' },
  { id: 'played', label: 'I played this', group: 'Practise',
    does: 'The button on a Today card, a Library row and the Player bar. It logs that you played the song, with optional minutes, a 1 to 5 score for how clean it was and a note. It also resets the song\'s rusty clock.',
    notes: 'Changing the capo, transposing or marking a favourite does not count as practice. Only this button, a loop speed log or finishing a loop step does.' },
  { id: 'status', label: 'Song status', group: 'Songs',
    does: 'The choice on each Library row: Learning, Polishing or Ready. A Polishing or Ready song shows as Rusty when it has not been played for 14 days. A Learning song never goes rusty.',
    notes: 'The 14 days is fixed for now; there is no button to change it.' },
  { id: 'add-song', label: 'Add a song', group: 'Songs',
    does: 'At the top of the Library: choose Ultimate Guitar (paste the address of a free chords page), Upload audio (an mp3, wav, m4a, aac, ogg or flac file up to 25 MB, with an optional title, artist and YouTube address) or Manual chart (a blank chart you fill in).',
    notes: 'Audio detection works out chords, key and tempo from the sound and is only a guess. Check the chart and correct it.' },
  { id: 'transpose', label: 'Transpose', group: 'Songs',
    does: 'The minus and plus buttons in the Player bar move the whole chart down or up by semitones. The setting is remembered for the song.',
    notes: 'It changes the chord names on the chart, not the audio.' },
  { id: 'capo', label: 'Capo', group: 'Songs',
    does: 'The Capo choice in the Player bar says which fret your capo is on, from none to fret 7. The chart keeps showing the sounding chords. With Capo shapes ticked, the shape to finger shows in brackets under each chord.',
    notes: 'The capo is a note about your fingering; it does not rename chords.' },
  { id: 'chart', label: 'Chord chart', group: 'Songs',
    does: 'The chart in the Player, grouped by section and lyric line. Click a chord to hear it and see its shapes on the right (use the arrows to move up the neck). Double-click a chord to change its name or section. Hovering a chord shows a small diagram. Auto-scroll keeps the current chord in view while the song plays.',
    notes: 'It follows the song only when there is audio or a YouTube address to play.' },
  { id: 'add-chord', label: 'Add chord at playhead', group: 'Songs',
    does: 'A button above the chart that adds a new chord at the point the song has reached, ready to rename. Use it to fill in or fix a chart.',
    notes: 'Needs the song to be playing or at the point you want.' },
  { id: 'numerals', label: 'Key and Roman numerals', group: 'Songs',
    does: 'The Theory and capo box in the Player shows the song\'s key (detected, worked out from the chords, or chosen by you in the Key list) and puts a Roman numeral under each chord. Chords borrowed from the parallel major or minor, chords that lead to another chord, and chords outside the key are marked in colour and listed with a plain explanation.',
    notes: 'The detected key is a guess. If the numerals look wrong, choose the key yourself in the list. Turn the numerals off with the Roman numerals tick.' },
  { id: 'capo-advice', label: 'Easiest capo', group: 'Songs',
    does: 'Also in the Theory and capo box: it tries the capo at each fret from none to 7 and recommends the one that leaves the fewest barre chords, for example "Capo 3, play G shapes". It lists each sounding chord with the shape to play and has buttons to set the capo.',
    notes: 'It counts a chord as easy only if it is a common open shape; check it against how you actually play.' },
  { id: 'loops', label: 'Practice loops', group: 'Songs',
    does: 'In the Player, type a name and press Save at current to save the last five seconds up to now as a loop. Press a loop to repeat it, the cross to stop repeating and the bin to delete it.',
    notes: 'Loops need an audio file or a YouTube address on the song.' },
  { id: 'tempo', label: 'Tempo trainer', group: 'Songs',
    does: 'Appears under Practice loops when a loop is on. A speed slider from 40% to 120% slows the loop without changing the pitch. Start at 70% begins an automatic ramp: tap Clean after each clean pass and after a few in a row (you choose how many) the speed goes up 5%; Messy starts the run again. Count in and play gives four clicks first; Click keeps a metronome at the song\'s tempo; Log this speed saves the speed you reached, and a small graph shows your progress on the loop.',
    notes: 'The click keeps time but is not locked to the recording. Pitch-keeping slowdown works for uploaded audio; on a YouTube video the speed steps are the ones YouTube offers.' },
  { id: 'my-chords', label: 'Chords I can play', group: 'Practise',
    does: 'In the Learn tab: a row of chord buttons. Press a chord when you can play it cleanly and it turns on; press again to turn it off. The list saves as you go. Songs, suggestions and roadmaps update straight away.',
    notes: 'Vault cannot hear you, so this is your own honest tick. It also shows the common beginner chords even before any song uses them.' },
  { id: 'learn-next', label: 'Learn next', group: 'Practise',
    does: 'In the Learn tab: the chords worth learning next, best first. A chord that is the only one a song still needs says how many songs it unlocks and names them. I can play it adds the chord to your list.',
    notes: 'Songs that would still need two or more new chords are counted as "closer" but do not unlock yet.' },
  { id: 'song-roadmap', label: 'I want to play a song', group: 'Practise',
    does: 'In the Learn tab: choose a song from the list and it shows the path: the chords to learn, in the order that opens up the most easier songs along the way, then the song itself. If you already know every chord it says so.',
    notes: 'The song must be in your library with chords. It does not simplify chords or find substitutes yet.' },
  { id: 'weekly-review', label: 'Weekly review', group: 'Practise',
    does: 'In the Coach tab, Write my review gives a short written review of the last seven days. Vault works out every number from your practice log, loop speed history and drill scores; AI only writes the sentences, and if it writes a number that is not in your data the plain summary is shown instead.',
    notes: 'Press I played this after practising, and log loop speeds, or there is nothing to review.' },
  { id: 'session-builder', label: 'Build a session', group: 'Practise',
    does: 'In the Coach tab: choose how long you have (15 to 60 minutes), optionally tick what to focus on (new songs, speed and rhythm, chord changes, rusty songs, polishing) or type it in your own words, then press Build my session. The plan is worked out in code from your own library and adds up to the time you chose. Each block has Open or Start drill and I played this.',
    notes: 'If your library is small the plan says it only fills part of the time. "Rhythm" is treated as loop work with the tempo trainer, not as a strumming lesson.' },
  { id: 'explain-song', label: 'Explain this song', group: 'Songs',
    does: 'A button in the Player bar. It opens a window with a short theory breakdown of the open song (why its chords work together) and a few things to practise, such as a strumming pattern, a barre or a section to loop.',
    notes: 'AI writes it from the chart only, so it knows the chords and key shown, not the recording. It needs a few chords on the chart and an AI model set up in the workspace.' },
  { id: 'ear-round', label: 'Ear training round', group: 'Practise',
    does: 'In the Ear tab: pick a mode and press Start a round of 10. Play again repeats the sound; after you choose, it shows whether you were right and what the answer was. At the end you see your score and the chords you missed, and the round is saved.',
    notes: 'Stopping a round part way saves nothing.' },
  { id: 'set-lists', label: 'Set lists', group: 'Songs',
    does: 'At the bottom of the Library tab. Type a name and press Create, then Edit to tick the songs to include and use the arrows to put them in playing order. Play opens the list in play mode starting with its first song.',
    notes: 'Deleting a set list does not delete its songs.' },
  { id: 'play-mode', label: 'Play mode', group: 'Songs',
    does: 'The Play mode button in the Player bar (or Play on a set list) opens a big full-screen chart for performing, with the current chord highlighted. Play moves along at the song tempo, staying a set number of beats (2, 4 or 8) on each chord; the minus and plus buttons change the tempo and A- and A+ change the text size. You can also move one chord at a time with the arrow keys or Page Up and Page Down, so a foot pedal or Bluetooth page turner works. In a set list there are Previous song and Next song buttons (N and P keys).',
    notes: 'It follows a set tempo or your key presses; it does not listen to you play. The screen is kept awake where the browser allows it.' },
  { id: 'minute-drill', label: 'One-minute drill', group: 'Practise',
    does: 'In Drills, press Drill on a pair of chords. After a 3-second countdown, switch between the two chords for a minute and tap the big button (or press Space) each time you land the new chord cleanly. The score is saved, compared with your best, and a pair that reaches 30 clean changes a minute stops being suggested on Today.',
    notes: 'You do the counting yourself by tapping; Vault does not listen to the guitar.' },
];

const RULES = [
  'Add songs in the Library, then set each song\'s status. Today builds its list from the songs, loops and chord changes in your own library.',
  'A Polishing or Ready song turns Rusty after 14 days without practice. Pressing I played this, or logging a loop speed, is what counts as practice.',
  'Open a song in the Player to see its chart. The key, the Roman numerals and the capo advice are worked out from that song\'s chords.',
  'Chord detection from audio and the detected key are guesses. The chart can always be corrected by double-clicking a chord.',
  'Loops and the tempo trainer need audio or a YouTube address on the song. The trainer slows playback without changing the pitch.',
  'Chord change drills are counted by your taps; the score is saved against the pair of chords.',
  'In the Learn tab you tick the chords you can play; songs, suggestions and roadmaps come only from the chords in your own songs.',
  'Set lists are made in the Library and played in play mode. Foot pedals and page turners work because they send arrow or Page keys.',
  'In the Coach tab the numbers and the plan are worked out by Vault from your own practice; AI only writes the wording, and its wording is checked before it is shown.',
  'The Open buttons in this chat only switch to a tool (they switch to its tab); they never change a song or start a drill by themselves.',
];

const NOT_POSSIBLE = [
  'Listening to you play, or judging how well you played: practice scores and clean passes are tapped in by you.',
  'Tabs or sheet music with exact finger positions for every note: it shows chords, lyrics and chord shapes only.',
  'Pulling chords from YouTube or from Spotify: songs come from an Ultimate Guitar page, an audio file you upload, or a blank chart.',
  'Teaching lessons or lead guitar: the coach explains the chords of a song and suggests what to practise, but there is no soloing map or scale diagram yet.',
  'Ear training from the recording itself: the ear tab plays chords from a built-in synth, using the chords and keys of your own songs.',
  'Keeping a song in step with a live band or a backing track: play mode moves at a set tempo or when you press a key, it does not listen.',
  'Sharing songs or practice history with other people.',
  'Hearing whether you played a chord cleanly, a built-in tuner, simplifying a song with easier chord substitutes, or riff tab: none of these are built yet.',
];

const SYSTEM = `You are the guide to Guitar in Vault for one person who learns songs, practises them and keeps them from going rusty. They say, in everyday words, what they want to do. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Guitar cannot do.
- You cannot see any of their songs, chords, scores or practice history. Never state or guess what is in their library.
- Be plain and short, as to a friend who is not technical. Explain any music word (capo, Roman numeral, barre) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they ask about a skill (a solo, a rhythm, a strum), do not teach it. Say what Guitar can do to help them practise it, such as a loop and the tempo trainer.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Guitar guide', feature: 'guitar_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'GUITAR TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with your guitar practice, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askGuitarTutor: guide.ask,
};
