'use strict';

// node server/services/liveTvTutor.test.js   (no npm script on purpose: it would change package.json). No model is called.

const { checkGuide } = require('./guideTestKit');
const service = require('./liveTvTutor');

checkGuide({
  name: 'liveTvTutor',
  service,
  askName: 'askLiveTvTutor',
  feature: 'live_tv_guide',
  toolsFile: 'liveTv/liveTvTools.mjs',
  menuExport: 'LIVE_TV_TOOLS',
  targetKey: 'tool',
  exampleToolId: 'browse',
  exampleStepId: 'vlc',
  facts: [
    ['browse', 'notes', /Adult channels/, 'adult channels are left out'],
    ['views', 'does', /All.*Favourites.*Recent/s, 'the three tabs are named as on the page'],
    ['country', 'does', /Australia/, 'Australia is the first choice'],
    ['player', 'notes', /20 seconds/, 'the start limit is stated'],
    ['player', 'notes', /never stores or passes on any video/, 'Vault relays no video'],
    ['favourite', 'notes', /recycle bin/, 'unstarring is not binned'],
    ['vlc', 'does', /playlist file/, 'VLC gets a playlist file'],
  ],
  gaps: [/TV guide/, /Recording/, /Paid or subscription/, /country block/, /Adult channels/],
  rules: [/Other links, then Open in VLC/, /never stores or passes on video/, /refreshed once a day/],
  system: [/Never say whether a particular channel is listed/, /country block/],
  noWords: /\b(HLS|m3u8|CORS|EPG|IPTV|NSFW|CSP)\b/,
}).catch((e) => { console.error(e); process.exit(1); });
