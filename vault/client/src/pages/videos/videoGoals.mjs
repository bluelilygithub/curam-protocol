// The "What do you want to do?" job screen for Video Tools (shared screen: components/JobStart.jsx). Each job is DATA:
// a title in plain words and ordered steps, each naming a real tool id from TOOL_GROUPS in VideosPage.jsx and one line
// on what to do there.
//
//   node client/src/pages/videos/videoGoals.test.mjs   (checks every step names a real tool)

export const VIDEO_GOALS = [
  {
    id: 'social',
    title: 'Post a video on social media',
    blurb: 'Trim it, make it the right shape, add captions, get every size.',
    icon: 'share-2',
    steps: [
      { tool: 'clip', note: 'Cut it down to the part you want to post.' },
      { tool: 'reframe', note: 'Make it tall (9:16), square or widescreen.' },
      { tool: 'caption-studio', note: 'Add captions, since most people watch with the sound off.' },
      { tool: 'export-social', note: 'Get the Reels, square and widescreen versions at once.' },
    ],
  },
  {
    id: 'promo',
    title: 'Make a promo from your photos',
    blurb: 'Pictures and music in, a finished video out.',
    icon: 'images',
    steps: [
      { tool: 'slideshow', note: 'Add your pictures and music, or describe the video you want.' },
      { tool: 'end-card', note: 'Finish with a closing message and a button to act on.' },
      { tool: 'export-social', note: 'Get the sizes each platform needs.' },
    ],
  },
  {
    id: 'captions',
    title: 'Add captions to a talking video',
    blurb: 'Write out what is said, check it, burn it in.',
    icon: 'type',
    steps: [
      { tool: 'transcribe-audio', note: 'Load the video, choose "With timestamps", fix any wrong words.' },
      { tool: 'caption-studio', note: 'Style the captions and burn them into the video.' },
    ],
  },
  {
    id: 'sound',
    title: 'Fix the sound',
    blurb: 'Clean up the voice, add new music, put it back.',
    icon: 'audio-lines',
    steps: [
      { tool: 'isolate-voice', note: 'Pull the speech out from under background music or noise.' },
      { tool: 'mix-audio', note: 'Lay the clean voice over new background music, if you want.' },
      { tool: 'audio', note: 'Swap the new soundtrack into the video.' },
      { tool: 'normalize', note: 'Even out the loudness so it plays at a normal level.' },
    ],
  },
  {
    id: 'brand',
    title: 'Brand a video',
    blurb: 'Your logo on it, an opening title, a closing message.',
    icon: 'megaphone',
    steps: [
      { tool: 'overlay', note: 'Put your logo or watermark on the video.' },
      { tool: 'extend-ending', note: 'Add an opening title and a closing hold with music.' },
      { tool: 'end-card', note: 'End with a call to action.' },
    ],
  },
  {
    id: 'highlight',
    title: 'Cut a highlight reel',
    blurb: 'Pick the best parts, join them, make the file small.',
    icon: 'scissors',
    steps: [
      { tool: 'clip', note: 'Cut out each part you want and save each one.' },
      { tool: 'join', note: 'Put the parts together, with cuts or crossfades.' },
      { tool: 'convert', note: 'Make the file smaller so it is easy to share.' },
    ],
  },
  {
    id: 'gif',
    title: 'Make a GIF and a cover picture',
    blurb: 'A short looping GIF and a still for the thumbnail.',
    icon: 'image',
    steps: [
      { tool: 'clip', note: 'Cut the moment you want, a few seconds long.' },
      { tool: 'togif', note: 'Turn it into a looping GIF.' },
      { tool: 'thumbnail', note: 'Grab a still frame to use as a cover picture.' },
    ],
  },
  {
    id: 'create',
    title: 'Create a new clip',
    blurb: 'Describe it, join several takes, get it ready to post.',
    icon: 'sparkles',
    steps: [
      { tool: 'generate', note: 'Describe the clip you want, optionally from a picture.' },
      { tool: 'join', note: 'Join several generated clips into one video.' },
      { tool: 'export-social', note: 'Get the sizes each platform needs.' },
    ],
  },
];
