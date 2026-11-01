'use strict';

// node server/services/youtubeTutor.test.js   (npm run test:youtube-tutor). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./youtubeTutor');

checkGuide({
  name: 'youtubeTutor',
  service,
  askName: 'askYoutubeTutor',
  feature: 'youtube_guide',
  toolsFile: 'youtube/youtubeTools.mjs',
  menuExport: 'YOUTUBE_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'search-box',
  exampleStepId: 'insights',
  facts: [
    ['search-box', 'notes', /100 new searches/, 'the daily search limit is stated'],
    ['filters', 'does', /Live now/, 'the Live now box is named'],
    ['open-playlist', 'notes', /unlisted/, 'which playlists work is stated'],
    ['browse-tabs', 'does', /Re-run/, 'history has a Re-run button'],
    ['watch', 'notes', /never downloads/, 'videos are never downloaded'],
    ['insights', 'notes', /captions only/, 'notes come from captions only'],
    ['ask', 'does', /clickable times/, 'answers carry clickable moments'],
    ['save-to-notes', 'does', /project.*client/s, 'a note can be filed under a project and a client'],
    ['transcript', 'does', /Timestamps/, 'the Timestamps view is named'],
    ['comments', 'notes', /Read only/, 'comments are read only'],
  ],
  gaps: [/Downloading a video/, /captions/, /subscribing/, /Following channels/, /quiz or flashcards/, /Private videos/],
  rules: [/captions/, /daily limit on new searches/, /never search, play or save/],
  system: [/Never state or guess what a particular video says/],
}).catch((e) => { console.error(e); process.exit(1); });
