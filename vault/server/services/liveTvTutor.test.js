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
    ['player', 'notes', /mini player/, 'the mini player is explained'],
    ['player', 'notes', /never stores or passes on any video/, 'Vault relays no video'],
    ['favourite', 'notes', /recycle bin/, 'unstarring is not binned'],
    ['vlc', 'does', /playlist file/, 'VLC gets a playlist file'],
    ['channel-guide', 'notes', /every 6 hours/, 'the guide refresh is stated'],
    ['programmes', 'notes', /only searches channels that have a guide/, 'search is limited to guided channels'],
    ['my-shows', 'does', /every time each is on/, 'My shows lists airings'],
    ['guide-city', 'does', /Admins only/, 'only admins change the city'],
    ['show-star', 'notes', /recycle bin/, 'unstarring a show is not binned'],
  ],
  gaps: [/Reminders or alerts/, /more than 7 days/, /Recording/, /Paid or subscription/, /country block/, /Adult channels/],
  rules: [/Other links, then Open in VLC/, /never stores or passes on video/, /refreshed once a day/, /next 7 days/],
  system: [/Never say whether a particular channel is listed/, /when a programme is on/, /country block/],
  noWords: /\b(HLS|m3u8|CORS|EPG|IPTV|NSFW|CSP)\b/,
}).catch((e) => { console.error(e); process.exit(1); });
