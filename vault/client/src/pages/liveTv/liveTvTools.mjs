// What the Live TV page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids are
// the guide's catalogue (server/services/liveTvTutor.js); node server/services/liveTvTutor.test.js fails if the two lists drift apart.
// The page has two boxes: `tool` on a guide entry says which box its Open button scrolls to (data-guide="browse" / "player").

export const LIVE_TV_TOOLS = [
  { id: 'browse', label: 'Find a channel', group: 'Find a channel', icon: 'search' },
  { id: 'player', label: 'Watch', group: 'Watch', icon: 'tv' },
];

export const GROUPS = ['Find a channel', 'Watch'];

export const GROUP_TIPS = {
  'Find a channel': 'Pick a country or a kind of channel, or search by name, then choose a channel from the list.',
  Watch: 'The chosen channel plays here. If it will not play in the browser, copy its link or open it in VLC.',
};

export const TOOL_TIPS = {
  browse: 'The channel list: free channels from around the world, by country, kind or name. Your favourites, recently watched, programme search and My shows are one tap away.',
  player: 'Plays the chosen channel in the page, with its TV guide underneath. Some channels only play in a separate player such as VLC; the buttons under the picture handle that.',
};

export const TOOL_BLURBS = {
  browse: 'Free channels, programme search and My shows.',
  player: 'Watch here with the TV guide, or open the channel in VLC.',
};

// The longer text for the (i) "How Live TV works" box.
export const HOW_IT_WORKS = [
  ['Where the channels come from', 'The list is the public iptv-org project, which collects links to channels that broadcasters put on the internet for free. Vault refreshes it once a day. Adult channels and channels removed after a copyright complaint are always left out.'],
  ['Playing a channel', 'Choose a channel and it plays in the box. Your browser fetches the picture straight from the broadcaster: Vault never stores or passes on any video.'],
  ['Why some will not play', 'Many links stop working, are only shown in their own country, or only let the broadcaster\'s own website play them. When one fails, try its other links if it has any, or open it in VLC (a free video player), which plays more of them.'],
  ['Favourites and recent', 'Press the star to keep a channel in Favourites. Recent shows what you watched lately, and each link says whether it played for you last time. Nobody else sees yours.'],
  ['TV guide', 'Many channels show what is on now and a 7-day guide under the picture. It comes from a free guide that covers Australian free-to-air channels and some streaming channels, updated every 6 hours. Search it in Programmes, and star a programme to see every time it is on in My shows.'],
  ['Be sensible', 'Being on the list does not make a channel licensed for your country. Treat it like any free-to-air link you find online.'],
];

// Everything the guide can point at: the two boxes plus the controls inside them. `tool` is the box the Open button scrolls to.
export const GUIDE_TOOLS = [
  { id: 'browse', label: 'Find a channel', tool: 'browse' },
  { id: 'views', label: 'All / Favourites / Recent', tool: 'browse' },
  { id: 'country', label: 'Country', tool: 'browse' },
  { id: 'category', label: 'Kind of channel', tool: 'browse' },
  { id: 'search', label: 'Search', tool: 'browse' },
  { id: 'browser-only', label: 'Only ones that can play here', tool: 'browse' },
  { id: 'player', label: 'Watch', tool: 'player' },
  { id: 'links', label: 'Other links', tool: 'player' },
  { id: 'favourite', label: 'Favourite star', tool: 'player' },
  { id: 'vlc', label: 'Open in VLC', tool: 'player' },
  { id: 'copy-link', label: 'Copy link', tool: 'player' },
  { id: 'channel-guide', label: 'TV guide', tool: 'player' },
  { id: 'show-star', label: 'Programme star', tool: 'player' },
  { id: 'programmes', label: 'Programmes', tool: 'browse' },
  { id: 'my-shows', label: 'My shows', tool: 'browse' },
  { id: 'guide-city', label: 'Guide city', tool: 'browse' },
];
