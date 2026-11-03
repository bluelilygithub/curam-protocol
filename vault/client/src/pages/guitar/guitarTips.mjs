// Hover tips for every control on the Guitar page (the shared Tooltip, never a native title=""). One plain sentence each.
// guitarTips.test.mjs fails if a control on the page has no tip, a tip used on the page does not exist, or a tip is not a real sentence.

export const GT = {
  // Tabs
  tabCoach: 'Coach: a practice session built to the time you have.',
  tabStrum: 'Strum: strumming arrows that move with the beat, and a ladder that builds up to a full pattern.',
  tabDrills: 'Drills: practise the chord changes your own songs use most, one minute at a time.',
  tabLibrary: 'Library: add songs, say how well you know each one, and open one to play along.',

  // Today and the practice log
  startDrill: 'Open this chord change in Drills and start the one-minute drill.',
  openSong: 'Open this song in the Player.',
  played: 'Log that you played this: minutes, how clean it was and a note. It stops the song going rusty.',

  // Adding songs
  addUg: 'Add a song from an Ultimate Guitar chords page.',
  addUpload: 'Add a song by uploading an audio file. Vault works out the chords, key and tempo.',
  addManual: 'Add a song with a blank chart and type the chords yourself.',
  ugUrl: 'Paste the address of a free Ultimate Guitar chords page.',
  ugImport: 'Fetch the chords from that page and add the song.',
  audioFile: 'Choose an mp3, wav, m4a, aac, ogg or flac file, up to 25 MB.',
  uploadTitle: 'The song title. Leave it empty to use the file name.',
  uploadArtist: 'The artist. Optional.',
  youtubeUrl: 'A YouTube address to play along with. Optional.',
  uploadGo: 'Upload the file and detect its chords. This can take a minute or two.',
  manualTitle: 'The song title.',
  manualArtist: 'The artist. Optional.',
  manualGo: 'Create the song with an empty chart. Add chords as you play.',

  // Library rows
  songStatus: 'How well you know this song. Polishing and Ready songs turn Rusty if you leave them unplayed for 14 days.',
  removeSong: 'Remove this song and its chords from your library.',

  // Player bar
  transposeDown: 'Move the whole chart down one semitone.',
  transposeUp: 'Move the whole chart up one semitone.',
  capo: 'Where your capo is. The chart keeps the sounding chords; the capo shapes show what to finger.',
  autoScroll: 'Keep the chord being played in the middle of the chart as the song plays.',
  addChord: 'Add a chord to the chart at the point the song has reached.',
  chord: 'Click to hear this chord and see its shapes. Double-click to change it.',

  // Loops
  loopName: 'Give the loop a name, such as Solo or Chorus.',
  saveLoop: 'Save the last five seconds up to now as a loop you can repeat.',
  playLoop: 'Repeat this loop. The tempo trainer appears below it.',
  clearLoop: 'Stop repeating this loop and go back to normal speed.',
  deleteLoop: 'Delete this loop and its speed history.',

  // Chord shapes
  prevShape: 'Show the previous way to play this chord.',
  nextShape: 'Show the next way to play this chord, further up the neck.',
  pickShape: 'Show this way of playing the chord.',

  // Theory and capo
  keyChoice: 'The key the numerals are worked out in. Automatic uses the detected key. Pick one if the numerals look wrong.',
  showNumerals: 'Show a Roman numeral under each chord on the chart.',
  showShapes: 'Show the shape you finger under each chord when a capo is set.',
  useCapo: 'Set the capo to this fret.',
  shapeChip: 'The shape you finger with the capo on for this chord.',
  shapeBarre: 'This shape needs a barre.',
  shapeOpen: 'This is an open shape, with no barre.',
  numeral: 'The Roman numeral: where this chord sits in the key. Capital letters are major chords.',

  // Tempo trainer
  slower: 'Play 5% slower. The pitch stays the same.',
  faster: 'Play 5% faster.',
  speed: 'Playback speed. Slowing a song down does not change its pitch.',
  startRamp: 'Start at 70% and speed up by 5% after each run of clean passes.',
  stopRamp: 'Turn the automatic speed-up off. The speed stays where it is.',
  countIn: 'Four clicks at the song\'s tempo, then the loop plays from its start.',
  click: 'A metronome at the song\'s tempo for this speed. It keeps time but is not locked to the recording.',
  logSpeed: 'Save the current speed as one you reached on this loop, for the progress graph.',
  cleanPass: 'Tap after a pass you played cleanly. Enough in a row and the speed goes up.',
  messyPass: 'Tap after a messy pass. The run of clean passes starts again.',
  cleanTarget: 'How many clean passes in a row before the speed goes up.',

  // Drills
  drill: 'Start the one-minute drill for this chord change.',
  drillJustPair: 'Practise just these two chords, back and forth.',
  drillProgression: 'Practise going round this progression for the minute. It goes from the first chord to the second through other chords and then back.',
  singHear: 'Play this note so you can hum along and find your limit.',
  singPreset: 'Fill in a usual range for this kind of voice. You can still change either note.',
  singLow: 'The lowest note you can sing comfortably, without straining.',
  singHigh: 'The highest note you can sing comfortably, without straining.',
  singSave: 'Remember your range, so every song can be checked against it.',
  singCancel: 'Go back without changing your saved range.',
  singChange: 'Pick a different lowest or highest note.',
  singClear: 'Forget your saved range.',
  singUse: 'Move the chart to the suggested key. The capo advice updates to match, and you can change it back with Transpose.',
  barreRung: 'Choose this step of the barre chord ladder to see its shape and practise it.',
  barreStart: 'Start a ten-second hold. Press the shape and keep every string ringing until the time is up.',
  barreStop: 'Stop this hold early. Nothing is saved.',
  barreClean: 'Every string rang with no buzz or dead note. This counts towards clearing the step.',
  barreBuzz: 'Something buzzed or sounded dead. It is saved as a hold that did not count, and that is fine.',
  barreSlideUp: 'Move the shape up one fret: F becomes F sharp, then G, A flat and A.',
  barreSlideDown: 'Move the shape down one fret.',
  pairsDrill: 'Start the one-minute drill on this pair: move between the major and minor chord and tap for every clean change.',
  pairsHear: 'Play the major chord and then the minor chord, so you can hear the one note that changes.',
  pairsEar: 'Go to the Ear tab and try the Major or minor round.',
  drillMore: 'Show or hide the other progressions that go between these two chords.',
  fingerShow: 'Show or hide which fingers stay down, move, lift and land for each change in this practice.',
  startMinute: 'Start a 3-second countdown, then one minute of switching between the two chords.',
  countChange: 'Tap each time you land the new chord cleanly. The Space bar does the same.',
  cancelDrill: 'Stop and go back without saving a score.',
  stopDrill: 'Stop the minute now. No score is saved.',
  closeDrill: 'Close the drill.',
  againDrill: 'Run the minute again for this chord change.',

  // Coach
  coachReview: 'Write a short review of your last seven days from your own practice log, loops and drills.',
  coachMinutes: 'How long you have to practise.',
  coachNote: 'Say what you want to work on in your own words, such as rhythm or my chord changes. Optional.',
  coachBuild: 'Build a session of exactly this length from your own songs, loops and chord changes.',
  explainSong: 'Get a short theory breakdown of this song and things to practise. It reads the chart, not the recording.',

  // Learn
  learnChip: 'Press when you can play this chord cleanly, with every string ringing.',
  learnHave: 'Add this chord to the ones you can play.',
  learnPick: 'Choose a song you want to play and see which chords to learn first, and the easier songs you unlock on the way.',

  // Milestones and reassurance
  milestoneAll: 'Show or hide the full list of milestones, with the ones you have reached ticked.',
  milestoneClose: 'Close this message.',
  tipDismiss: 'Put this tip away for good. You can bring it back from the Is this normal? list.',
  tipRestore: 'Bring this tip back so it shows when it fits.',
  tipsAll: 'Show or hide every Is this normal? tip, including the ones you put away.',

  // Glossary
  glossTerm: 'Press for a short explanation of this word.',
  allSongs: 'Go back to the list of all your songs.',
  glossSearch: 'Search the words guitarists use and what they mean.',

  // Make it easier
  simplifyOff: 'Show the chart as written, with no capo change and no swapped chords.',
  simplifyExact: 'Keep the exact sound and only move the capo to the fret that leaves the fewest barre chords.',
  simplifyEasier: 'Move the capo and swap hard chords for easy ones, such as F for Fmaj7. The sound changes a little.',
  simplifyFewer: 'Dim the chords that change too fast to land, so you can hold the one before.',

  // Strumming
  strumPlay: 'Start with one bar of clicks, then the arrows move with the beat.',
  strumStop: 'Stop the beat.',
  strumSlower: 'Play 5 beats a minute slower.',
  strumFaster: 'Play 5 beats a minute faster.',
  strumTempo: 'The speed in beats a minute. You can change it while it plays and the arrows keep their place.',
  strumSong: 'Set the tempo to match one of your songs.',
  strumClick: 'A click on each beat of the bar, with a higher one on beat 1.',
  strumSound: 'A soft tick for each strum that hits: lower for a down strum, higher for an up strum.',
  strumLadder: 'Start with a down strum on every beat and add one up strum at a time until you reach the full pattern.',
  strumEasier: 'Go back one step in the ladder.',
  strumHarder: 'Go up one step in the ladder.',
  strumFull: 'Go straight to the full pattern.',
  strumAuto: 'Move up a step by itself after the number of bars you choose.',
  pickRung: 'Choose this step of the fingerpicking ladder to see its tab and practise it.',
  pickChord: 'Which chord to hold while you pick. The tab and the diagram change to match.',
  pickPlay: 'Start with one bar of clicks, then the tab lights up each note as you should pluck it.',
  pickStop: 'Stop the beat.',
  pickTempo: 'The speed in beats a minute. Start slow; you can change it while it plays.',
  pickSound: 'Play each note of the tab as a soft plucked string, so you can hear the pattern you are aiming for.',
  pickEasier: 'Go back one step in the fingerpicking ladder.',
  pickHarder: 'Go up one step in the fingerpicking ladder.',
  pickComfy: 'Mark this step as comfortable once you can play it evenly without looking. Tap again to take the mark off.',
  gapLevel: 'Choose this step of the gap click. Each step has more silence than the one before.',
  gapPlay: 'Start with one bar of clicks, then the click goes quiet in gaps while you keep tapping the beat.',
  gapStop: 'Stop now. Nothing is judged for a run you stop early.',
  gapTempo: 'The speed in beats a minute. Set it before you start; it cannot change during a run.',
  gapTap: 'Tap once on every beat, including the silent ones. The space bar does the same.',
  gapEasier: 'Go back one step, with less silence.',
  gapHarder: 'Go up one step, with more silence.',
  strumBars: 'How many bars to stay on each step before moving up.',

  // Backing band
  bandOn: 'Play drums and a bass along with the arrows. Untick it to practise with only the click.',
  bandDrums: 'The drum beat the band plays.',
  bandBass: 'How the bass plays: the root note of each chord on the beat, with the fifth, or on every eighth note.',
  bandVolume: 'How loud the drums and bass are. The click and the strum ticks are separate.',
  bandFromProgression: 'Use a well-known chord progression in a key you choose, one chord a bar.',
  bandFromSong: 'Use the chords of one of your songs, one chord a bar, so you can strum along as if it were that song.',
  bandKey: 'The key the progression is played in.',
  bandProgression: 'The chord progression the bass follows. It goes round, one chord a bar.',
  bandSong: 'The song whose chords the bass follows. It plays the first eight chords of its chart in order.',

  // Ear training
  earChords: 'Chords: hear a chord and name it. The choices come from your own songs.',
  earNumerals: 'Numerals: hear the key chord, then a chord from one of your songs, and name its Roman numeral.',
  earQuality: 'Major or minor: hear a chord from your songs and say whether it is major or minor. A great first ear test.',
  earBass: 'Bass note: hear a chord and name its lowest note, the root. Press Hear the bass note if you want help.',
  earProgression: 'Progression: hear the key chord and then a well-known run of chords, and say which one it was.',
  earBassHint: 'Play just the lowest note of the chord, on its own.',
  earHearBoth: 'Play the same chord as major and then as minor, so you can hear the one note that changes.',
  earStart: 'Start a round of 10 questions.',
  earReplay: 'Play the chord again.',
  earTonic: 'Play the key chord again: I in a major key, i in a minor key.',
  earAnswer: 'Choose this answer.',
  earNext: 'Go on to the next question.',
  earAgain: 'Start another round.',
  earStop: 'Stop this round. Nothing is saved.',

  // Set lists and play mode
  setName: 'Name a new set list, such as Friday gig.',
  setCreate: 'Create the set list, then choose its songs.',
  setPlay: 'Play this set list in play mode, starting with its first song.',
  setEdit: 'Choose and order the songs in this set list.',
  setDelete: 'Delete this set list. Your songs are not deleted.',
  setSong: 'Include this song in the set list.',
  setUp: 'Move this song earlier in the set list.',
  setDown: 'Move this song later in the set list.',
  setSave: 'Save the name and songs.',
  setCancel: 'Close without saving.',
  playMode: 'Play mode: a big chart that follows the song, for performing. Arrow keys and page-turner pedals move through it.',
  gigToggle: 'Start or pause the chart following the tempo of the song. The Space bar does the same.',
  gigPrev: 'Back one chord. The left arrow or Page Up does the same.',
  gigNext: 'On one chord. The right arrow or Page Down does the same.',
  gigSmaller: 'Make the chart smaller. The minus key does the same.',
  gigBigger: 'Make the chart bigger. The plus key does the same.',
  gigSlower: 'Move 5 beats a minute slower. The [ key does the same.',
  gigFaster: 'Move 5 beats a minute faster. The ] key does the same.',
  gigBeats: 'How many beats the chart stays on each chord.',
  gigPrevSong: 'Go to the previous song in the set list. The P key does the same.',
  gigNextSong: 'Go to the next song in the set list. The N key does the same.',
  gigClose: 'Close play mode. Esc does the same.',

  // Header
  howItWorks: 'How Guitar works.',
  tour: 'Take a guided tour of Guitar.',
};

// The guide's menu is the page's tabs.
export const tabTip = (tab) => GT[`tab${tab}`];

export const ADD_TIPS = { ug: GT.addUg, upload: GT.addUpload, manual: GT.addManual };

export const FOCUS_TIPS = {
  learning: 'Give more of the session to songs you are still learning.',
  loops: 'Give more of the session to loops you are working up to speed, which also builds rhythm and timing.',
  transitions: 'Give more of the session to chord changes you are slow at.',
  rusty: 'Give more of the session to songs that are going rusty.',
  polishing: 'Give more of the session to songs you are polishing.',
};
