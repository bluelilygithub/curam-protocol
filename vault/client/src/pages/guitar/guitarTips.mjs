// Hover tips for every control on the Guitar page (the shared Tooltip, never a native title=""). One plain sentence each.
// guitarTips.test.mjs fails if a control on the page has no tip, a tip used on the page does not exist, or a tip is not a real sentence.

export const GT = {
  // Tabs
  tabToday: 'Today: what to play in the time you have, picked from your own songs, loops and chord changes.',
  tabCoach: 'Coach: a weekly review of your practice, and a practice session built to the time you have.',
  tabStrum: 'Strum: strumming arrows that move with the beat, and a ladder that builds up to a full pattern.',
  tabEar: 'Ear: train your ear on the chords and keys of your own songs.',
  tabLearn: 'Learn: tick the chords you can play, see which songs you can already play, and what to learn next.',
  tabDrills: 'Drills: practise the chord changes your own songs use most, one minute at a time.',
  tabLibrary: 'Library: add songs and say how well you know each one.',
  tabPlayer: 'Player: the chord chart for the open song, with playback, loops, the key and the capo.',

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
  strumBars: 'How many bars to stay on each step before moving up.',

  // Ear training
  earChords: 'Chords: hear a chord and name it. The choices come from your own songs.',
  earNumerals: 'Numerals: hear the key chord, then a chord from one of your songs, and name its Roman numeral.',
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
