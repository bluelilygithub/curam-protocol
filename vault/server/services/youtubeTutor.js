'use strict';

// The YouTube guide (the round button on Vault's /youtube page): a person says what they want to do ("find a short recent video about X",
// "get the main points of this one", "keep what it says in my notes") and the guide points at the real controls, in order, or says plainly
// that YouTube in Vault does not do it. It only knows what is written here and it never sees any search, video or note.
// Built on guideCore.js; the ids are the page's own, listed in client/src/pages/youtube/youtubeTools.mjs (a test keeps the two in step).
// See docs/guide-chat.md and docs/youtube-agent.md.

const { createGuide, REPLY_FORMAT, VERDICT_HELP } = require('./guideCore');

const CATALOG = [
  { id: 'search-box', label: 'Search box', group: 'Find videos',
    does: 'The box at the top. Type a topic, or describe what you want in your own words ("short recent videos about sourdough"): Vault works out the sort order, length and date from the description and shows what it understood in a line under the box, which you can dismiss. The microphone beside it searches by speaking. Press Enter or Search.',
    notes: 'Each new search uses part of YouTube\'s daily allowance (about 100 new searches a day); searching for the same thing again is free for a few hours.' },
  { id: 'filters', label: 'Sort, length and date filters', group: 'Find videos',
    does: 'Three lists beside the box: sort by relevance, newest, most viewed or highest rated; length (short under 4 minutes, medium 4 to 20, long over 20); and published within the past hour, day, week, month or year. A Live now box limits results to streams that are broadcasting at the moment.',
    notes: 'They apply to the next search.' },
  { id: 'open-playlist', label: 'Open playlist', group: 'Find videos',
    does: 'Paste a YouTube playlist address (or just its id) into the box under the search form and press Open playlist to see its videos in order.',
    notes: 'Public and unlisted playlists only.' },
  { id: 'browse-tabs', label: 'Results, Trending, Favourites, History and Lists', group: 'Browse',
    does: 'The row of tabs under the search. Results holds the current search. Trending shows what is popular now, with a country and a category list. Favourites are videos you saved with the heart. History lists your past searches with a Re-run button and keeps a Recently watched list you can clear. Lists are whole result sets saved under a name ("Save this search as a list" on the results), which you can reopen later.',
    notes: 'A video can be both a favourite and in a list. Saving a list keeps the videos, not new results.' },
  { id: 'following', label: 'Following', group: 'Browse',
    does: 'Follow a channel with + Follow channel in a video\'s window (or + Follow this channel in a channel view), or follow a search with + Follow this search under the results. The Following tab then lists new videos from everything you follow, with Check now and Mark all as seen, and the channels and searches you follow with an Unfollow button each. New videos also appear in Needs attention on the home page.',
    notes: 'You can follow up to 30 channels and 5 searches. Channels are checked about every 5 hours; searches about once a day because each uses a lot of YouTube\'s daily allowance. The first check only notes what is already there, so only videos published afterwards count as new. It does not send email or phone alerts.' },
  { id: 'watch', label: 'Watch window', group: 'Watch and study',
    does: 'Click any video to watch it here, on YouTube\'s own player. Buttons under it: Insights & Ask, Transcript, Comments, More from this channel, + Follow channel, save as a favourite, and Open on YouTube.',
    notes: 'Vault never downloads or stores the video; it plays from YouTube.' },
  { id: 'insights', label: 'Insights', group: 'Watch and study',
    does: 'Press Insights & Ask under the player. Write notes for this video produces a short summary, key points, chapters, things to do and quotes, each with a time you can click to jump the video there. The notes are written once and kept for next time; Refresh writes them again.',
    notes: 'They are written by AI from the video\'s captions only, so a video with no captions cannot be done, and they can contain mistakes. A very long video is read only as far as the AI can take, and the panel says so.' },
  { id: 'ask', label: 'Ask this video', group: 'Watch and study',
    does: 'The Ask this video tab next to Insights. Type a question (or press a suggested one) and get an answer taken from what is said in the video, with the moments it comes from as clickable times. Follow-up questions remember the last few.',
    notes: 'It answers only from the captions: if the video does not say, it says so. It cannot see the pictures or hear the sound.' },
  { id: 'save-to-notes', label: 'Save to Notes', group: 'Watch and study',
    does: 'Once the notes are written, Save to Notes in the same panel turns them into a note in Notes with the video link, the summary, key points and chapters with clickable times, tick-box things to do and quotes. You can file it under one of your projects and link it to a client first. A message links to the new note.',
    notes: 'The note says it was written by AI. Editing it later is done in Notes.' },
  { id: 'transcript', label: 'Transcript', group: 'Watch and study',
    does: 'The Transcript button shows the video\'s captions as text. A language list appears when the video has captions in more than one language. Timestamps shows it line by line with a time on each line (click a time to jump the video), Summarize gives a short summary instead, and Copy copies what is shown.',
    notes: 'Only works for videos that have captions.' },
  { id: 'comments', label: 'Comments', group: 'Watch and study',
    does: 'The Comments button shows the video\'s top public comments with author, likes and how long ago, and Load more for the next page.',
    notes: 'Read only. A video with comments turned off says so.' },
];

const RULES = [
  'Find a video first (search, a trending video, a favourite or a playlist), then click it to open the watch window. Insights, Ask, Transcript and Comments are all inside that window.',
  'Insights, Ask and Transcript read only the video\'s captions. No captions means none of them work for that video.',
  'Notes written by AI are saved, so asking for them again is instant; Refresh writes them again.',
  'There is a daily limit on new searches set by YouTube. Repeat searches are free, and the page warns when few are left.',
  'The Open buttons in this chat only switch to a tool (they scroll to its area); they never search, play or save anything by themselves.',
];

const NOT_POSSIBLE = [
  'Downloading a video or its audio (Vault only plays videos from YouTube).',
  'Understanding what is shown or heard beyond the captions: charts, demonstrations, music or tone.',
  'Posting, liking, subscribing or replying to comments, or managing your own channel.',
  'Email or phone alerts when a new video appears (new videos show on the Following tab and in Needs attention only).',
  'Making a quiz or flashcards from a video (not built yet).',
  'Searching inside the transcripts of videos you saved, or comparing several videos side by side (not built yet).',
  'Private videos and videos with no captions (notes and questions need captions).',
];

const SYSTEM = `You are the guide to YouTube in Vault for one person who searches YouTube, watches videos and wants to get the useful parts out of them. They say, in everyday words, what they want to do. You point them to the right controls, in order, and explain how each works.

Rules:
- Use ONLY the tools and rules given below. Never invent a button or a feature, and never promise something the notes say YouTube in Vault cannot do.
- You cannot see any search, video, note or answer. Never state or guess what a particular video says.
- Be plain and short, as to a friend who is not technical. Explain any unfamiliar word (captions, playlist, transcript) in a few everyday words the first time you use it.
- Give steps in order. Each step names exactly one tool by its id and says in a sentence what to do there.
- If they want something on the not-possible list, say so plainly, say whether it is just not built yet, and offer the closest thing that does exist.
- Remind them once, when it matters, that the AI notes and answers are written from captions and can be wrong.
- If you need one more fact to answer, ask ONE short question and give no steps.
${VERDICT_HELP}

${REPLY_FORMAT}`;

const guide = createGuide({
  name: 'YouTube guide', feature: 'youtube_guide', catalog: CATALOG, rules: RULES, notPossible: NOT_POSSIBLE, system: SYSTEM,
  toolWord: 'tool', sectionTitle: 'YOUTUBE TOOLS AND CONTROLS',
  fallbackAnswer: 'Sorry, I could not work that out. Could you say again what you want to do with the videos, in a sentence?',
});

module.exports = {
  CATALOG, RULES, NOT_POSSIBLE, SYSTEM, VERDICTS: guide.VERDICTS,
  buildTutorPrompt: guide.buildPrompt, cleanMessages: guide.cleanMessages, normalizeTutorReply: guide.normalizeReply,
  askYoutubeTutor: guide.ask,
};
