// The Music sidebar: one list of tools, arranged by what the person is doing (same idea as Video Tools'
// TOOL_GROUPS). Pure data + a filter, so a test can check it without a browser (musicTools.test.mjs).
// Add a new tool to the group where a person would look for it, then add its TOOL_TIPS and TOOL_HELP entry;
// the test fails if any of the three is missing. Docs: docs/music-plan.md.

export const DEFAULT_TOOL = 'score';

export const TOOL_GROUPS = [
  {
    id: 'make',
    label: 'Make',
    tools: [
      { id: 'score', label: 'Score a video', desc: 'Pick a video and a mood, get three music options cut to its length' },
      { id: 'text', label: 'Music from a description', desc: 'No video needed: describe the music and choose how long it should be' },
      { id: 'own-track', label: 'Use my own track', desc: 'Fit a music file you already have to your video' },
    ],
  },
  {
    id: 'voice',
    label: 'Voice',
    tools: [
      { id: 'voiceover', label: 'Voiceover', desc: 'Add narration over the music: write a script or upload a recording' },
    ],
  },
];

// Hover text for every item in the list: what the tool does, in plain words.
export const TOOL_TIPS = {
  score: "Choose a video and a mood (or describe the music yourself) and get three instrumental options, each cut to your video's exact length. Costs a small amount per go.",
  text: 'No video needed. Describe the music or pick a mood, choose how long it should be, and get three instrumental options you can listen to and download.',
  'own-track': "Bring a music file you already have. It is looped or trimmed to your video's length, faded and mixed in. No generation, no cost.",
  voiceover: 'Add narration. Type a script for an AI voice with an Australian accent, or upload a recording. The music dips while the voice speaks.',
};

export const GROUP_TIPS = {
  make: 'Start here: get music that fits your video, made for you or from a file you have.',
  voice: 'Put a voice over the music, and choose where it starts and how loud it is.',
};

// Opened by the (?) beside each tool title.
export const TOOL_HELP = {
  score: {
    title: 'Score a video',
    what: "Write instrumental background music for a video, cut to its exact length so it ends on your last frame.",
    features: [
      'Choose your video (up to five minutes). It is only used to read its length and to preview the mix',
      'Pick a mood, or choose Custom prompt and describe the music; tempo is optional. Not sure? Say what your video is about, or the sound you want, and press Fill in the mood for me: it picks a mood, or writes the description if none fits',
      'Three options are made so you can compare them, each previewed against your video',
      'Set the music volume and let it dip while people talk (ducking)',
      'Not happy with one? Make a new version of just that option, or make another option (up to six); compare options from the same moment',
      'The timeline shows where the picture cuts, the music and the voice. Drag the voice or the start of the music (it can snap to a cut), and change the fades, then apply them to every option with no new cost',
      'Export the music as WAV, your video with the music as MP4, or save it to Saved media',
      'Or send an option on to Video Tools to normalize, trim, mix or export for social media; your other options are still here when you come back',
    ],
  },
  text: {
    title: 'Music from a description',
    what: 'Make instrumental music of a length you choose, without a video.',
    features: [
      'Pick a mood or describe the music, set the length (5 seconds up to the limit shown), and get three options',
      'Listen to each one and download it as a WAV file',
      'Not happy with one? Make a new version of just that option, or make another option (up to six)',
      'Seed: the number a version was made from. Type it in the Seed box with the same description to get that exact music back',
      'Compare options by playing each from the same moment',
      'Add a voiceover (an AI voice with an Australian accent, or your own recording) and download the music with the voice mixed in',
      'Send it to Video Tools to trim it or mix it with a voice recording',
    ],
  },
  'own-track': {
    title: 'Use my own track',
    what: 'Fit music you already have to your video.',
    features: [
      'Choose your video, then a music file (MP3, WAV, M4A)',
      'A short track is looped with smooth crossfades; a long one is trimmed',
      'It fades in and out, then is previewed, mixed and exported like generated music',
      'Free to use, but only use music you have the rights to',
    ],
  },
  voiceover: {
    title: 'Voiceover',
    what: 'Add narration over your music, with or without a video. Make the music first, then come back here.',
    features: [
      'Write a script for an AI voice, or upload your own recording',
      'Choose when the voice starts and how loud it is',
      'The music (and your video\'s own sound) dips underneath the voice',
      'Every option\'s preview and export includes the voiceover (for music made without a video, the WAV has the voice mixed in)',
      'AI voices have a small per-use cost',
    ],
  },
};

/** Groups and tools matching `query` (name or description); everything when the query is empty. */
export function filterGroups(groups, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({ ...g, tools: g.tools.filter((t) => t.label.toLowerCase().includes(q) || t.desc.toLowerCase().includes(q)) }))
    .filter((g) => g.tools.length > 0);
}

export function groupOfTool(groups, toolId) {
  return groups.find((g) => g.tools.some((t) => t.id === toolId))?.id || null;
}
