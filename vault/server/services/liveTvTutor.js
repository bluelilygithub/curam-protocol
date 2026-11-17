'use strict';

// The Live TV guide (the round button on Vault's /live-tv page): a person says what they want ("watch the news", "why won't this play",
// "how do I watch it on the TV") and the guide points at the real controls, in order, or says plainly that Live TV does not do it. It
// never sees the channel list, favourites or history. Built on guideCore.js; the ids are the page's own, listed in
// client/src/pages/liveTv/liveTvTools.mjs (a test keeps the two in step). See docs/guide-chat.md and docs/live-tv.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'browse', label: 'Find a channel', group: 'Find a channel',
    does: 'The box with the channel list. Each row shows the channel\'s name, country and kind, a star if it is a favourite, and whether it can play in the page or needs VLC. Press a row to play it. Show more loads the next part of a long list.',
    notes: 'The list is iptv-org\'s public list of free channels, refreshed once a day. Adult channels and channels removed after a copyright complaint are always left out.' },
  { id: 'views', label: 'All / Favourites / Recent', group: 'Find a channel',
    does: 'The three tabs at the top of the list. All is every channel (narrowed by Country, Kind of channel and Search). Favourites is the channels you starred. Recent is the channels you played lately, newest first.',
    notes: 'Favourites and Recent are yours alone; nobody else sees them.' },
  { id: 'country', label: 'Country', group: 'Find a channel',
    does: 'The Country choice narrows All to one country, with the number of channels beside each. Australia is chosen the first time.',
    notes: 'A channel\'s country is where it broadcasts from, not where it can be watched. Some only play inside their own country.' },
  { id: 'category', label: 'Kind of channel', group: 'Find a channel',
    does: 'The Kind of channel choice narrows the list to news, sport, movies, music, kids and so on.',
    notes: 'Kinds come from the iptv-org list and are not always right.' },
  { id: 'search', label: 'Search', group: 'Find a channel',
    does: 'The Search box finds channels by name, other names or network. It searches inside the chosen tab, country and kind; choose All countries to search everywhere. It has a mic for speaking the name.',
    notes: 'It searches channel names only, not programmes.' },
  { id: 'browser-only', label: 'Only ones that can play here', group: 'Find a channel',
    does: 'The tick box hides channels whose every link needs VLC (plain http links, or links that need special settings a browser cannot send).',
    notes: 'A channel that can play here may still fail: the link may be off air or only shown in its own country.' },
  { id: 'player', label: 'Watch', group: 'Watch',
    does: 'The picture box. The chosen channel starts playing (sometimes with the sound off: press the speaker to unmute). The line under it says Connecting, Playing, or why it did not play. Full screen is in the player\'s own controls.',
    notes: 'If nothing shows after 20 seconds it stops and says so. Your browser fetches the picture straight from the broadcaster; Vault never stores or passes on any video.' },
  { id: 'links', label: 'Other links', group: 'Watch',
    does: 'When a channel has more than one link, they are listed under the picture with their quality, and whether each played for you last time. Press one to try it.',
    notes: 'Try another link when the first one fails.' },
  { id: 'favourite', label: 'Favourite star', group: 'Watch',
    does: 'The star next to the channel\'s name adds it to Favourites or takes it off. The rows in the list have the same star.',
    notes: 'Taking a channel off Favourites does not go to the recycle bin; press the star again to put it back.' },
  { id: 'vlc', label: 'Open in VLC', group: 'Watch',
    does: 'Open in VLC downloads a small playlist file for the chosen link. Open it with VLC (a free video player for computers and phones) to watch there.',
    notes: 'VLC plays many links a browser cannot, including plain http links and ones that need special settings, which the file includes.' },
  { id: 'copy-link', label: 'Copy link', group: 'Watch',
    does: 'Copy link puts the chosen link on the clipboard, to paste into VLC (Media, Open Network Stream) or another player, such as one on a smart TV.',
    notes: 'A copied link may stop working at any time; the broadcaster controls it.' },
];

const RULES = [
  'Choose a channel in the list and it plays in the Watch box; nothing plays until you choose one.',
  'Many links fail: off air, only shown in their own country, or only playable on the broadcaster\'s own website. Try Other links, then Open in VLC.',
  'Channels marked as needing VLC never play in the page; they show Open in VLC and Copy link instead.',
  'Vault never stores or passes on video. The browser or VLC fetches it straight from the broadcaster.',
  'The list is iptv-org\'s public list, refreshed once a day. Adult channels and channels removed after a copyright complaint are always left out.',
  'Favourites and Recent belong to the person alone.',
  'The Open buttons in this chat only switch to a tool (they scroll to its box); they never play anything by themselves.',
];

const NOT_POSSIBLE = [
  'A TV guide (what is on now or next) or programme search: not built yet.',
  'Recording, pausing live TV for later, or downloading programmes.',
  'Paid or subscription channels, or anything that needs a login.',
  'Getting round a country block, for example with a VPN setting inside Vault.',
  'Adding your own links or playlists to the list.',
  'Casting to a TV from Vault: copy the link into the TV\'s own player app instead, if it has one.',
  'Adult channels: they are always left out.',
];

const SYSTEM = `You are the guide to Live TV in Vault for one person who watches free TV channels from around the world. They say, in everyday words, what they want to watch or what went wrong. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say Live TV cannot do.
- You cannot see the channel list, their favourites or what they watched. Never say whether a particular channel is listed or will play.
- Be plain and short, as to a friend who is not technical.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If a channel will not play, say links often fail, to try Other links, then Open in VLC.
- Never suggest ways to get round a country block or to watch paid channels for free.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'Live TV guide', feature: 'live_tv_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'LIVE TV TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to watch or what went wrong, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askLiveTvTutor: guide.ask,
};
