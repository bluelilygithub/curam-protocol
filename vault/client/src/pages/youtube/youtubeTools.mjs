// What the YouTube page is made of, the plain-words help for it, and the controls its guide (the round button) can point at. The ids are the
// guide's catalogue (server/services/youtubeTutor.js); npm run test:youtube-tutor fails if the two lists drift apart.
// The page has no tool menu, so the three "tools" below are its three areas: `tool` on a guide entry says which area its Open button scrolls to
// (the page marks each area with data-guide="search-box" / "browse-tabs"; the watch window only exists once a video is open, so its controls
// scroll to the results).

export const YOUTUBE_TOOLS = [
  { id: 'search-box', label: 'Search', group: 'Find videos', icon: 'search' },
  { id: 'browse-tabs', label: 'Browse', group: 'Browse', icon: 'layout-grid' },
  { id: 'watch', label: 'Watch and study', group: 'Watch and study', icon: 'play' },
];

export const GROUPS = ['Find videos', 'Browse', 'Watch and study'];

export const GROUP_TIPS = {
  'Find videos': 'Search by topic or describe what you want, filter the results, or open a whole playlist.',
  Browse: 'Results, what is trending, your saved favourites, past searches and lists, and new videos from what you follow.',
  'Watch and study': 'Watch a video here, then get AI notes on it, ask it questions, save the notes to Notes, read the transcript or the comments.',
};

export const TOOL_TIPS = {
  'search-box': 'The search box, the sort, length and date filters, Live now, and Open playlist.',
  'browse-tabs': 'The tabs: Results, Trending, Favourites, History, Lists and Following.',
  watch: 'The watch window that opens when you click a video, with Insights & Ask, Transcript and Comments.',
};

export const TOOL_BLURBS = {
  'search-box': 'Find videos by topic or description.',
  'browse-tabs': 'Results, trending, favourites, history, lists, following.',
  watch: 'Watch, get notes, ask, save to Notes.',
};

// The longer text for the (i) "How YouTube works" box.
export const HOW_IT_WORKS = [
  ['Search', 'Type a topic, or describe what you want in your own words ("short recent videos about sourdough"). Vault works out the filters for you. Sort by relevance, newest, views or rating, pick a length and a date, or tick Live now.'],
  ['Browse', 'Results, Trending (by country and category), your Favourites, your search History (with a Re-run button and a Recently watched list) and Lists, which are whole result sets you saved under a name. You can also open a whole playlist by pasting its address.'],
  ['Follow', 'Press + Follow channel in a video\'s window, or + Follow this search under your results. New videos from them then appear on the Following tab and in Needs attention on your home page, so you do not have to keep looking. Channels are checked about every 5 hours and searches about once a day; the first look only notes what is already there.'],
  ['Watch', 'Click a video to watch it here. You can save it as a favourite, see more from its channel, read the transcript (in any language the video has captions in) or the top comments.'],
  ['Insights & Ask', 'Under the player: AI notes on the video (a summary, key points, chapters, things to do, quotes) with times you can click to jump the video, and a box to ask it questions. Both come only from the video\'s captions, so a video with no captions cannot be done. Notes are written once and kept.'],
  ['Save to Notes', 'Turns those notes into a note in Notes, with the link and clickable times, optionally filed under a project or a client.'],
  ['Limits', 'YouTube lets Vault run roughly 100 new searches a day; repeat searches are free and a warning shows when few are left. Vault does not download videos. The AI can get things wrong, so check anything important against the video.'],
];

// Everything the guide can point at. `tool` is the area the Open button scrolls to.
export const GUIDE_TOOLS = [
  { id: 'search-box', label: 'Search box', tool: 'search-box' },
  { id: 'filters', label: 'Sort, length and date filters', tool: 'search-box' },
  { id: 'open-playlist', label: 'Open playlist', tool: 'search-box' },
  { id: 'browse-tabs', label: 'Results, Trending, Favourites, History and Lists', tool: 'browse-tabs' },
  { id: 'following', label: 'Following', tool: 'browse-tabs' },
  { id: 'watch', label: 'Watch window', tool: 'watch' },
  { id: 'insights', label: 'Insights', tool: 'watch' },
  { id: 'ask', label: 'Ask this video', tool: 'watch' },
  { id: 'save-to-notes', label: 'Save to Notes', tool: 'watch' },
  { id: 'transcript', label: 'Transcript', tool: 'watch' },
  { id: 'comments', label: 'Comments', tool: 'watch' },
];
