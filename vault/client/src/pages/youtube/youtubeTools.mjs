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
  Browse: 'Results, your saved favourites, past searches and lists, and new videos from what you follow.',
  'Watch and study': 'Watch a video here, then get AI notes on it, ask it questions, save the notes to Notes, read the transcript or the comments.',
};

export const TOOL_TIPS = {
  'search-box': 'The search box, the sort, length and date filters, Live now, and Open playlist.',
  'browse-tabs': 'The tabs: Results, Favourites, History, Lists and Following.',
  watch: 'The watch window that opens when you click a video, with Insights & Ask, Transcript, Comments, Chapters and Download.',
};

export const TOOL_BLURBS = {
  'search-box': 'Find videos by topic or description.',
  'browse-tabs': 'Results, favourites, history, lists, following.',
  watch: 'Watch, get notes, ask, save to Notes.',
};

// The longer text for the (i) "How YouTube works" box.
export const HOW_IT_WORKS = [
  ['Search', 'Type a topic, or describe what you want in your own words ("short recent videos about sourdough"). Vault works out the filters for you. Sort by relevance, newest, views or rating, pick a length and a date, or tick Live now.'],
  ['Browse', 'Results, your Favourites, your search History (with a Re-run button and a Recently watched list) and Lists, which are whole result sets you saved under a name. You can also open a whole playlist by pasting its address.'],
  ['Follow', 'Press + Follow channel in a video\'s window, or + Follow this search under your results. New videos from them then appear on the Following tab and in Needs attention on your home page, so you do not have to keep looking. Channels are checked about every 5 hours and searches about once a day; the first look only notes what is already there.'],
  ['Favourites', 'Press the heart to save a video; a window then lets you pick a category from your list (or make one) and add tags. On the Favourites tab the videos are grouped by category; filter by category or tag, or search titles and saved transcripts. Create note, next to the other buttons under the player, adds a note to Notes with the video, its labels and its transcript, and then becomes Open note. Every list, including saved Lists and Following, has tick boxes and a Select all button so you can remove or delete several together; deleted favourites, lists, follows, searches and watched videos wait in the recycle bin for 30 days.'],
  ['Watch', 'Click a video to watch it here. You can save it as a favourite, see more from its channel, read the transcript (in any language the video has captions in) or the top comments.'],
  ['Insights & Ask', 'Under the player: AI notes on the video (a summary, key points, chapters, things to do, quotes) with times you can click to jump the video, and a box to ask it questions. Both come only from the video\'s captions, so a video with no captions cannot be done. Notes are written once and kept.'],
  ['Chapters', 'Under the player, Chapters lists the video\'s own chapters, taken from the times in its description or YouTube\'s automatic ones. Click one to jump the video there. They are free and need no captions; a video without chapters says so (Insights & Ask can write AI chapters instead).'],
  ['Download', 'Download, under the player, saves the video (up to 720p or 1080p, MP4) or just its sound (MP3) to your computer. Tick that you may download it first: it is yours, it has a Creative Commons licence, or its owner said yes, as YouTube\'s terms allow nothing else. The server fetches it (you can close the window and come back), then Save file puts it in your downloads and deletes it from the server. Up to 2 GB; YouTube sometimes blocks cloud servers, so it can fail.'],
  ['Save to Notes', 'Turns those notes into a note in Notes, with the link and clickable times, optionally filed under a project or a client.'],
  ['No captions?', 'Some videos have no captions Vault can read. The Transcript, Insights and Ask panels then offer Generate a transcript with AI: a window shows the video\'s length, the estimated cost and wait first, and nothing starts until you press Generate. Google\'s Gemini listens to the video (it keeps working if you close the window) and the transcript is saved with the video, marked Transcript saved. Public videos up to an hour; it can mishear names and numbers.'],
  ['Limits', 'YouTube lets Vault run roughly 100 new searches a day; repeat searches are free and a warning shows when few are left. Downloads are only for videos you may download. The AI can get things wrong, so check anything important against the video.'],
];

// Everything the guide can point at. `tool` is the area the Open button scrolls to.
export const GUIDE_TOOLS = [
  { id: 'search-box', label: 'Search box', tool: 'search-box' },
  { id: 'filters', label: 'Sort, length and date filters', tool: 'search-box' },
  { id: 'open-playlist', label: 'Open playlist', tool: 'search-box' },
  { id: 'browse-tabs', label: 'Results, Favourites, History and Lists', tool: 'browse-tabs' },
  { id: 'following', label: 'Following', tool: 'browse-tabs' },
  { id: 'favourite-labels', label: 'Categories and tags on favourites', tool: 'browse-tabs' },
  { id: 'select-several', label: 'Select several videos', tool: 'browse-tabs' },
  { id: 'note-from-video', label: 'Create note from a video', tool: 'watch' },
  { id: 'watch', label: 'Watch window', tool: 'watch' },
  { id: 'insights', label: 'Insights', tool: 'watch' },
  { id: 'ask', label: 'Ask this video', tool: 'watch' },
  { id: 'save-to-notes', label: 'Save to Notes', tool: 'watch' },
  { id: 'transcript', label: 'Transcript', tool: 'watch' },
  { id: 'comments', label: 'Comments', tool: 'watch' },
  { id: 'chapters', label: 'Chapters', tool: 'watch' },
  { id: 'download', label: 'Download', tool: 'watch' },
];
