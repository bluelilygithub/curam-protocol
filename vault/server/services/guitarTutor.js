'use strict';

// The Guitar guide (the round button on Vault's /guitar page): a person says what they want to do ("slow down a solo", "stop my
// songs going rusty", "find an easier way to play this song") and the guide points at the real controls, in order, or says plainly
// that Guitar does not do it. It only knows what is written here and it never sees a song, chord or score. Built on guideCore.js;
// the ids are the page's own, listed in client/src/pages/guitar/guitarTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'coach', label: 'Coach', group: 'Practise',
    does: 'The tab that builds a practice session of exactly the time you pick, from your own songs, loops and chord changes, with a tip for each block. A chord change comes as a route through the chords between the two (for example C#m, A, E for C#m to E), practised slowly and then faster.',
    notes: 'It uses your own songs, loops and drill scores, so it has little to offer until the Library has songs. It does not listen to you play.' },
  { id: 'strum', label: 'Strum', group: 'Practise',
    does: 'The tab for strumming. It shows a strumming pattern as eight arrows (counted 1 & 2 & 3 & 4 &) that light up in time with a click. Pick a pattern, press Start, and after one bar of clicks the arrows move. Solid arrows are strums that hit the strings; faint dashed arrows are air swings where your arm moves but misses the strings.',
    notes: 'It does not listen to you, so you judge your own timing. It shows rhythm only, not chords.' },
  { id: 'drills', label: 'Drills', group: 'Practise',
    does: 'The tab that lists the chord changes your own songs use most, worst first. Each card says in words how many times your songs switch between the two chords and in how many songs, and what your last one-minute score and best are. Press Drill on one to open it.',
    notes: 'A change that appears only once in your songs is not listed. G to C and C to G count as one pair. Finger patterns appear after you press Drill.' },
  { id: 'library', label: 'Library', group: 'Songs',
    does: 'The tab where songs are added and listed. Each song shows its key, tempo, length, a status badge and a status choice, with I played this and Remove.',
    notes: 'Open a song by clicking its row once the chords are ready.' },
  { id: 'played', label: 'I played this', group: 'Practise',
    does: 'The button on a Library row and in the open song. It logs that you played the song, with optional minutes, a 1 to 5 score for how clean it was and a note. It also resets the song\'s rusty clock.',
    notes: 'Changing the capo, transposing or marking a favourite does not count as practice. Only this button, a loop speed log or finishing a loop step does.' },
  { id: 'status', label: 'Song status', group: 'Songs',
    does: 'The choice on each Library row: Learning, Polishing or Ready. A Polishing or Ready song shows as Rusty when it has not been played for 14 days. A Learning song never goes rusty.',
    notes: 'The 14 days is fixed for now; there is no button to change it.' },
  { id: 'add-song', label: 'Add a song', group: 'Songs',
    does: 'At the top of the Library: choose Ultimate Guitar (paste the address of a free chords page), Upload audio (an mp3, wav, m4a, aac, ogg or flac file up to 25 MB, with an optional title, artist and YouTube address) or Manual chart (a blank chart you fill in).',
    notes: 'Audio detection works out chords, key and tempo from the sound and is only a guess. Check the chart and correct it.' },
  { id: 'transpose', label: 'Transpose', group: 'Songs',
    does: 'The minus and plus buttons in the bar of an open song move the whole chart down or up by semitones. The setting is remembered for the song.',
    notes: 'It changes the chord names on the chart, not the audio.' },
  { id: 'capo', label: 'Capo', group: 'Songs',
    does: 'The Capo choice in the bar of an open song says which fret your capo is on, from none to fret 7. The chart keeps showing the sounding chords. With Capo shapes ticked, the shape to finger shows in brackets under each chord.',
    notes: 'The capo is a note about your fingering; it does not rename chords.' },
  { id: 'chart', label: 'Chord chart', group: 'Songs',
    does: 'The chart in an open song, grouped by section and lyric line. Click a chord to hear it and see its shapes on the right (use the arrows to move up the neck). Double-click a chord to change its name or section. Hovering a chord shows a small diagram. Auto-scroll keeps the current chord in view while the song plays.',
    notes: 'It follows the song only when there is audio or a YouTube address to play.' },
  { id: 'add-chord', label: 'Add chord at playhead', group: 'Songs',
    does: 'A button above the chart that adds a new chord at the point the song has reached, ready to rename. Use it to fill in or fix a chart.',
    notes: 'Needs the song to be playing or at the point you want.' },
  { id: 'numerals', label: 'Key and Roman numerals', group: 'Songs',
    does: 'The Theory and capo box in an open song shows the song\'s key (detected, worked out from the chords, or chosen by you in the Key list) and puts a Roman numeral under each chord. Chords borrowed from the parallel major or minor, chords that lead to another chord, and chords outside the key are marked in colour and listed with a plain explanation.',
    notes: 'The detected key is a guess. If the numerals look wrong, choose the key yourself in the list. Turn the numerals off with the Roman numerals tick.' },
  { id: 'sing-range', label: 'Sing it in your range', group: 'Songs',
    does: 'In an open song, under Theory and capo. Pick the lowest and highest notes you can sing comfortably from the two lists (the Hear button plays a note so you can hum along, and the voice buttons fill in a usual range) and press Save my range. For the open song it then says which key suits your voice and by how many semitones to move it, shows the capo advice in that key, and a button moves the chart there.',
    notes: 'Vault cannot hear you and does not know the melody of a song. It assumes a typical tune, from a fifth below the key note to a sixth above it, so the suggested key is a good first try to adjust by ear. Your range is kept in your account; Clear forgets it.' },
  { id: 'capo-advice', label: 'Easiest capo', group: 'Songs',
    does: 'Also in the Theory and capo box: it tries the capo at each fret from none to 7 and recommends the one that leaves the fewest barre chords, for example "Capo 3, play G shapes". It lists each sounding chord with the shape to play and has buttons to set the capo.',
    notes: 'It counts a chord as easy only if it is a common open shape; check it against how you actually play.' },
  { id: 'simplify', label: 'Make it easier', group: 'Songs',
    does: 'In an open song, the Make it easier box has three choices. As written shows the chart untouched. Same sound sets the capo to the fret that leaves the fewest barre chords and shows the shapes to finger, with the chord it sounds as underneath. Easier chords does that and also swaps hard chords for easy ones (F for Fmaj7, Bm for Bm7, B for B7, or a plainer version of a hard seventh or suspended chord). It lists every swap and says what changes in the sound, and names any chord that still needs a barre. For a song detected from audio, a tick dims chords that change too fast to land.',
    notes: 'Swapped chords sound a little different from the original. Turning it off puts the capo back where it was. It changes only how the chart is shown, not the saved chords.' },
  { id: 'loops', label: 'Practice loops', group: 'Songs',
    does: 'In an open song, type a name and press Save at current to save the last five seconds up to now as a loop. Press a loop to repeat it, the cross to stop repeating and the bin to delete it.',
    notes: 'Loops need an audio file or a YouTube address on the song.' },
  { id: 'tempo', label: 'Tempo trainer', group: 'Songs',
    does: 'Appears under Practice loops when a loop is on. A speed slider from 40% to 120% slows the loop without changing the pitch. Start at 70% begins an automatic ramp: tap Clean after each clean pass and after a few in a row (you choose how many) the speed goes up 5%; Messy starts the run again. Count in and play gives four clicks first; Click keeps a metronome at the song\'s tempo; Log this speed saves the speed you reached, and a small graph shows your progress on the loop.',
    notes: 'The click keeps time but is not locked to the recording. Pitch-keeping slowdown works for uploaded audio; on a YouTube video the speed steps are the ones YouTube offers.' },
  { id: 'glossary', label: 'Words guitarists use', group: 'Practise',
    does: 'Words with a dotted underline (capo, barre chord, sus4, hammer-on, strum, semitone, Roman numeral and others) can be pressed or tapped anywhere in Guitar for a two-line explanation and, for many, a small drawing or chord diagram. It closes when you press elsewhere or Escape. The Words guitarists use button at the top of the page lists every word with its drawing and has a search box.',
    notes: 'It explains words only. Each word is underlined once in a sentence, and chord names such as Fmaj7 are not underlined.' },
  { id: 'session-builder', label: 'Build a session', group: 'Practise',
    does: 'In the Coach tab: choose how long you have (15 to 60 minutes), optionally tick what to focus on (new songs, speed and rhythm, chord changes, rusty songs, polishing) or type it in your own words, then press Build my session. The plan is worked out in code from your own library and adds up to the time you chose. Each block has Open or Start drill and I played this.',
    notes: 'If your library is small the plan says it only fills part of the time. "Rhythm" is treated as loop work with the tempo trainer, not as a strumming lesson.' },
  { id: 'explain-song', label: 'Explain this song', group: 'Songs',
    does: 'A button in the bar of an open song. It opens a window with a short theory breakdown of the open song (why its chords work together) and a few things to practise, such as a strumming pattern, a barre or a section to loop.',
    notes: 'AI writes it from the chart only, so it knows the chords and key shown, not the recording. It needs a few chords on the chart and an AI model set up in the workspace.' },
  { id: 'backing-band', label: 'Backing band', group: 'Practise',
    does: 'In the Strum tab, under the arrows. Drums and a bass play along with the beat so you strum with a band instead of only a click. Choose the drums (rock beat, pop beat or slow ballad), the bass (a root note on every beat, root and fifth, or driving eighths), the volume, and the chords the bass follows, a bar each: A progression (a well-known one in a key you pick, such as the three-chord song in A) or The chords of a song (the first eight chords of the chart of one of your songs, in order). While it plays, the chord for the bar and the next one show above the arrows and the chord loop lights up. Untick Play drums and bass to go back to the click alone.',
    notes: 'The sounds are made in your browser, so they are simple. The band does not listen to you or follow you if you slow down; it keeps its own tempo. Your choices are remembered in this browser.' },
  { id: 'strum-pattern', label: 'Strumming pattern', group: 'Practise',
    does: 'In the Strum tab: choose Down on every beat, Down up down up, The old faithful, Pop strum or Gentle ballad. The tempo slider (40 to 160 beats a minute) can be changed while it plays and the arrows keep their place; Match a song sets the tempo to one of your songs. Click on the beat and Hear the strums can each be turned off.',
    notes: 'The pattern and tempo are remembered in this browser.' },
  { id: 'pattern-ladder', label: 'Pattern ladder', group: 'Practise',
    does: 'In the Strum tab, under the arrows. The ladder starts with a down strum on every beat, then adds one up strum at a time, then lets go of any beat the pattern misses, until you reach the full pattern. The current step is explained in words. Easier step and Harder step move along it, Jump to the full pattern skips ahead, and Climb by itself moves up after 2, 4 or 8 bars.',
    notes: 'Slowing the tempo down is always fine. Untick the ladder to see the full pattern straight away.' },
  { id: 'fingerpicking', label: 'Fingerpicking ladder', group: 'Practise',
    does: 'In the Strum tab, below the strumming. Six steps teach fingerpicking: the thumb alone, a pinch, rolling up the strings, up and back down, alternating bass, then Travis picking. Choose a chord (C, G, Am, Em, D, Dm, A or E) and a small tab shows which string and fret each note is on, with the picking finger under it (p thumb, i index, m middle, a ring). Start gives one bar of clicks and then lights up each note in time, and Hear the notes plays them as soft plucked strings. Easier step and Harder step move along the ladder, and This feels comfortable marks a step you have got.',
    notes: 'Vault cannot hear you pluck, so you decide when a step is comfortable; that mark and the chosen step stay in this browser only. Only the eight listed chords have a tab, and the tab shows one chord at a time, not a chord change.' },
  { id: 'gap-click', label: 'Gap click', group: 'Practise',
    does: 'At the bottom of the Strum tab. A metronome that goes silent on purpose: some beats with the click, then some without, over and over. Press Start, hear one bar of clicks, then tap on every beat with the big Tap button or the space bar, including through the silent beats. Five steps add more silence, from one missing beat up to seven missing bars. At the end it says whether your beat stayed steady, rushed (got early) or dragged (got late) while the click was gone, with the average and worst distance from the beat in milliseconds. One steady run clears a step. Easier step and Harder step move along the ladder.',
    notes: 'Vault measures only your taps, not your guitar and not the microphone, so tap in time with how you would play. Your usual tap delay while the click is on is measured and taken off. The step reached and the steps cleared stay in this browser only.' },
  { id: 'major-minor-pairs', label: 'Major and minor pairs', group: 'Practise',
    does: 'At the top of the Drills tab: E and Em, A and Am, and D and Dm. Each card shows both chord shapes, with rings on the notes that stay held, and says in words which single note changes (the 3rd, one fret lower in the minor). Hear the two chords one after the other, press Drill for the one-minute drill on the pair.',
    notes: 'Only these three pairs are offered, because their shapes differ by exactly one note. The drill scores are kept per pair, and the best shows on the card.' },
  { id: 'barre-ladder', label: 'Barre chord ladder', group: 'Practise',
    does: 'In the Drills tab, under Major and minor pairs. Five steps lead to a barre chord: two strings pressed flat, the mini F on four strings, the full F, B flat in the A shape, and sliding the full shape up the neck. Choose a step to see its shape, what to do and a tip, press Start a 10-second hold, keep every string ringing until the timer ends, then say whether every string rang clean. Three clean holds clear a step and the next one becomes Next up.',
    notes: 'Vault cannot hear you, so you judge each hold yourself. Stopping a hold early saves nothing, and a hold that buzzed is saved but does not count. You can open any step at any time, not only the next one.' },
  { id: 'set-lists', label: 'Set lists', group: 'Songs',
    does: 'At the bottom of the Library tab. Type a name and press Create, then Edit to tick the songs to include and use the arrows to put them in playing order. Play opens the list in play mode starting with its first song.',
    notes: 'Deleting a set list does not delete its songs.' },
  { id: 'play-mode', label: 'Play mode', group: 'Songs',
    does: 'The Play mode button in the bar of an open song (or Play on a set list) opens a big full-screen chart for performing, with the current chord highlighted. Play moves along at the song tempo, staying a set number of beats (2, 4 or 8) on each chord; the minus and plus buttons change the tempo and A- and A+ change the text size. You can also move one chord at a time with the arrow keys or Page Up and Page Down, so a foot pedal or Bluetooth page turner works. In a set list there are Previous song and Next song buttons (N and P keys).',
    notes: 'It follows a set tempo or your key presses; it does not listen to you play. The screen is kept awake where the browser allows it.' },
  { id: 'finger-moves', label: 'Finger moves', group: 'Practise',
    does: 'In Drills, after you press Drill on a pair, under the choice of what to practise. For every change in the practice (A to E and E back to A, or each step of a progression and the last back to the first) it shows two small chord diagrams, with a dotted ring on any note that stays held, how many notes stay, how many fingers move, lift and land, step by step instructions such as "Keep your middle finger where it is, on the 2nd fret of the A string", and a tip (leave a finger down as an anchor, slide a finger across a string, land everything together, or treat a barre as one move). During the minute a short reminder for the change you are on appears under the big button.',
    notes: 'The fingerings are standard teaching fingerings and may differ from the ones you use; if your fingers are different, trust your own. A chord with no fingering in the table says so instead of guessing. Hide finger moves closes the section.' },
  { id: 'minute-drill', label: 'One-minute drill', group: 'Practise',
    does: 'In Drills, press Drill on a pair of chords and choose what to practise: just the two chords back and forth, or a suggested progression that goes between them through other chords (for A and E, A D E, or A E F#m D, and so on). The suggestions are well-known progressions in the key the two chords share, they say which chords are new to you, and Show more ideas lists the rest. After a 3-second countdown, go round the loop for a minute and tap the big button (or press Space) each time you land the next chord cleanly; the screen shows the chord to change to. The score is saved against the pair, compared with your best, and a pair that reaches 30 clean changes a minute stops being suggested on Today.',
    notes: 'You do the counting yourself by tapping; Vault does not listen to the guitar. If the two chords do not share a key it says so and offers only the two chords.' },
];

const RULES = [
  'Add songs in the Library, then set each song\'s status. Coach builds its session from the songs, loops and chord changes in your own library.',
  'A Polishing or Ready song turns Rusty after 14 days without practice. Pressing I played this, or logging a loop speed, is what counts as practice.',
  'Press a song in the Library and it opens in place to show its chart (All songs goes back to the list). The key, the Roman numerals and the capo advice are worked out from that song\'s chords.',
  'Chord detection from audio and the detected key are guesses. The chart can always be corrected by double-clicking a chord.',
  'Loops and the tempo trainer need audio or a YouTube address on the song. The trainer slows playback without changing the pitch.',
  'Chord change drills are counted by your taps; the score is saved against the pair of chords.',
  'Strumming arrows, the pattern ladder, the fingerpicking ladder and the gap click show rhythm against a click; they do not listen to you play.',
  'Set lists are made in the Library and played in play mode. Foot pedals and page turners work because they send arrow or Page keys.',
  'In the Coach tab the numbers and the plan are worked out by Vault from your own practice; AI only writes the wording, and its wording is checked before it is shown.',
  'The Open buttons in this chat only switch to a tool (they switch to its tab); they never change a song or start a drill by themselves.',
];

const NOT_POSSIBLE = [
  'Listening to you play, or judging how well you played: practice scores and clean passes are tapped in by you.',
  'Tabs or sheet music with exact finger positions for every note: it shows chords, lyrics and chord shapes only.',
  'Pulling chords from YouTube or from Spotify: songs come from an Ultimate Guitar page, an audio file you upload, or a blank chart.',
  'Teaching lessons or lead guitar: the coach explains the chords of a song and suggests what to practise, but there is no soloing map or scale diagram yet.',
  'Ear training: there is no ear tab, because a built-in synth sounds nothing like a guitar.',
  'Keeping a song in step with a live band or a backing track: play mode moves at a set tempo or when you press a key, it does not listen.',
  'Sharing songs or practice history with other people.',
  'A streak counter, milestones or reminders to practise: none of these are built.',
  'Hearing whether you played a chord cleanly or in time, a built-in tuner, or riff tab: none of these are built yet.',
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
