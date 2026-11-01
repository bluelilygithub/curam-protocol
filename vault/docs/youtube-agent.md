# YouTube

A YouTube search tool mounted in Vault at **`/youtube`**. Search by keyword or plain-language description, watch videos in an embedded player, pull a transcript or AI summary (with a language picker), browse more from a channel or open a full playlist, filter to live streams, see comments, browse trending videos by region/category, save favourites, save whole result sets as named lists, replay past searches, and see a recently-watched list.

**Frontend:** `vault/client/src/pages/YoutubePage.jsx`
**Backend:** `vault/server/routes/youtube.js` (mounted at `/api/youtube`)
**Transcript fetch (used elsewhere, e.g. Video Tools' Generate reference flow):** `vault/server/services/youtubeTranscript.js`

Requires `YOUTUBE_API_KEY` (YouTube Data API v3). Feature flag `youtube` in workspace **Feature Access** — admins are never narrowed by it; members follow `featureAccess.youtube`.

---

## What it does

- **Search** — plain keyword query, or a natural-language description ("short recent videos about X") that gets parsed into structured filters (`order`, `duration`, `publishedKey`) by the workspace `light` model before hitting the YouTube Data API. An "✦ AI" strip shows what was interpreted, editable/dismissable.
- **Filters** — sort order (relevance/date/view count/rating), duration (any/short/medium/long), published-within window (any time through past year).
- **Voice search** — optional mic input via the app's shared `useVoice` hook, when browser STT is available.
- **Watch** — clicking a result opens a modal with a proper embedded YouTube `<iframe>` player. No video content is fetched, stored, or served by Vault itself — playback happens entirely on youtube.com's own embed.
- **Transcript / summary** — from the watch modal, "Transcript" opens a panel that fetches the caption transcript via the existing `fetchYoutubeTranscript()` service, with a copy button and a "Summarize" action (workspace `light` model, a few concise sentences, not a re-transcription). Videos with no captions show a friendly message instead of a raw error.
- **More from this channel** — from the watch modal, swaps the results grid to that channel's other videos (same enrichment as search), with a "back to search" affordance.
- **Favourites** — save/remove videos (`youtube_favourites` table), listed in their own tab.
- **History** — every search is recorded (`youtube_search_history`, last 30 shown), with a one-click "Re-run" to repeat a past search exactly, and per-row delete.
- **Saved lists** — "Save this search as a list" on the results view (or a channel/playlist view) prompts for a title and saves the current set of videos as a named list, separate from per-video favourites. A "Lists" tab shows saved lists; opening one shows its videos in the same grid; a list can be deleted entirely.
- **Playlists** — paste a full YouTube playlist URL or a bare playlist id into the "Open playlist" field near the search form to view it as an ordered set of videos in the same grid, with a "back to search" affordance matching the channel-view pattern.
- **Trending** — a "Trending" tab shows what's currently popular (`videos.list(chart=mostPopular)`), with a region dropdown (US/GB/AU/CA/IN) and an optional category filter fed by the categories endpoint.
- **Live now filter** — a "Live now" checkbox next to the other search filters restricts results to currently-broadcasting live streams matching the query (`eventType=live`).
- **Comments** — from the watch modal, a "Comments" button opens a read-only panel of top-level comments (author, text, like count, relative time) with a "Load more" page. Videos with comments disabled show a friendly message instead of a raw error.
- **Category browsing** — `videoCategories.list` backs the Trending category dropdown; there's no separate category-browsing surface since Trending already covers the real use case.
- **Subtitle language picker** — the transcript panel lists all available caption languages for a video (when more than one exists) and lets you pick one before fetching the transcript or a summary, instead of always defaulting to English/first.
- **Recently watched** — opening the watch modal on any video records it (upsert on videoId, most-recent-first, capped display of last 30). A collapsible "Recently watched" section sits at the top of the History tab, with per-video removal via the same grid and a "Clear all" convenience action.

**No download feature.** An earlier version linked out to a third-party YouTube-ripping service (cobalt.tools) from the Download buttons on each video card, the favourites row, and the watch modal. This was removed — downloading video content from YouTube outside YouTube's own means violates YouTube's Terms of Service regardless of which tool performs the download, and risks copyright exposure for whatever content a user picks. Watching happens in-app via the embed above; anyone with rights to a video and a genuine need to work on the file should acquire it through legitimate means and upload it directly wherever it's needed (e.g. Video Tools).

---

## API

```
POST   /api/youtube/parse-query        JSON { input } → { q, order, duration, publishedKey, reasoning }
GET    /api/youtube/search             ?q=&order=&duration=&publishedAfter=&eventType= → { videos, totalResults }
GET    /api/youtube/channel/:channelId → { videos, totalResults } — that channel's videos, newest first
GET    /api/youtube/playlist/:playlistId → { videos, totalResults } — a playlist's videos in order (accepts a full playlist URL or a bare id)
GET    /api/youtube/trending           ?regionCode=&categoryId= → { videos, totalResults } — currently popular videos
GET    /api/youtube/categories         ?regionCode= → { categories: [{ id, title }] } — assignable video categories for a region
GET    /api/youtube/comments/:videoId  ?pageToken= → { comments: [{ id, author, authorImage, text, likeCount, publishedAt }], nextPageToken }
POST   /api/youtube/transcript         JSON { videoId, summarize?, languageCode? } → { title, transcript, summary? }
GET    /api/youtube/transcript-languages/:videoId → { languages: [{ languageCode, name, isDefault }] }
GET    /api/youtube/history            last 30 searches for the user
DELETE /api/youtube/history/:id
GET    /api/youtube/favourites
POST   /api/youtube/favourites         { videoId, title, channel, thumbnail, duration, viewCount, publishedAt }
DELETE /api/youtube/favourites/:videoId
GET    /api/youtube/watch-history       last 30 recently-watched videos for the user
POST   /api/youtube/watch-history       { videoId, title, channel, thumbnail, duration, viewCount, publishedAt } — upserts, bumping watchedAt
DELETE /api/youtube/watch-history/all   clear all watch history for the user
DELETE /api/youtube/watch-history/:videoId
GET    /api/youtube/lists              saved lists (id, title, createdAt, itemCount) for the user
POST   /api/youtube/lists              { title, videos: [...] } → { ok, id }
GET    /api/youtube/lists/:id          { id, title, createdAt, videos: [...] }
DELETE /api/youtube/lists/:id
DELETE /api/youtube/lists/:id/items/:videoId   remove one video from a saved list
```

Search results are two YouTube Data API calls per request: `search.list` (query + filters) then `videos.list` (duration/view-count enrichment for the matched ids). The `/channel/:channelId` and `/playlist/:playlistId` routes reuse the same `enrichAndMapItems()` helper — extended to also read a playlist item's `snippet.resourceId.videoId` shape — against `search.list`/`playlistItems.list` calls instead of a text query. `snippet.channelId` is included in every mapped video object so the client can offer "More from this channel". `eventType=live` is an additive param on `/search`, only meaningful alongside the hardcoded `type=video`.

`/trending` calls `videos.list(chart=mostPopular)` directly — that call already returns `contentDetails`/`statistics` in one shot, so no second enrichment call is made (unlike search/channel/playlist). `/categories` calls `videoCategories.list` and filters to `snippet.assignable` categories; the client's Trending tab is the only consumer of this list today.

`/transcript` calls the existing `fetchYoutubeTranscript()` service, now accepting an optional `languageCode` to pick a specific caption track instead of always defaulting to English/first. `/transcript-languages/:videoId` calls a new shared `fetchCaptionTracks()` helper (factored out of `fetchYoutubeTranscript()`) to list available languages without fetching transcript text. When `summarize` is true, `/transcript` also sends the transcript to `callModel` on the workspace `light` tier (via `getModelsForUser`) with a short system prompt asking for a concise summary. A video with no captions returns a 404 with a friendly message rather than the raw service error.

`/comments/:videoId` calls `commentThreads.list` (top-level only, no reply threads) and maps to a flat shape. YouTube returns a 403 whose message reads like "...has disabled comments..." when a video's owner turned comments off — surfaced as a 404 with a friendly message rather than the raw API error.

`/watch-history` follows the same `ON CONFLICT ("userId","videoId")` pattern as `youtube_favourites`, but updates `watchedAt` on conflict (via `POST /api/youtube/watch-history`, fired client-side whenever the watch modal opens) instead of doing nothing, so repeat views bump a video back to the top without growing unbounded duplicate rows.

---

## Study tools: insights, ask this video, save to Notes (added 2026-11)

Open any video and press **Insights & Ask** (under the player). Everything is read from the video's **captions** only (nothing from the picture or sound), so a video with no captions cannot be done.

- **Insights** - AI notes written once and kept (`youtube_video_insights`, one per person, video and caption language): overview, key points, chapters, things to do, quotes. Every key point, chapter and quote carries a time; clicking it reloads the player at that moment. Written by the workspace `light` model from the timestamped transcript (`[m:ss] words` lines, about 20 seconds each, cut at 90,000 characters; a longer video says "These notes cover the first N minutes"). Refresh writes them again.
- **Ask this video** - type a question, get an answer taken from the captions, with the moments it comes from (clickable). Uses the workspace `standard` model. A long video sends only the minute-long windows that share the most words with the question. If the video does not say, the answer is "The video doesn't cover that." Follow-ups carry the last four turns.
- **Save to Notes** - builds a Markdown note (link, summary, key points and chapters with timestamp links, `- [ ]` to-dos, quotes, a line saying AI wrote it) and saves it through the normal Notes API, optionally filed under a project and/or linked to a client. A toast links to the note.
- **Transcript timestamps** - the Transcript panel has a Timestamps view (line by line; click a time to jump the player).
- **Transcript layout and copy** - the default Transcript view groups the timed lines into readable paragraphs (`transcriptParagraphs` in `youtubeFormat.mjs`: closes at a sentence end after about 40 seconds, always by 75). **Copy transcript** puts those paragraphs on the clipboard, or `[m:ss] line` per line while the Timestamps view is on (`transcriptCopyText`); it reads "Copy summary" on the Summary view.
- **Main points** - a **Main points** button in the Transcript panel asks the workspace Gemini model (`getModelsForUser().gemini`, else `light`) for 5 to 10 bullets from the transcript (captions, or the one Gemini wrote; `POST /api/youtube/main-points`, `server/services/youtubeMainPoints.js`). Saved per person and video in `youtube_main_points` and shown under the transcript as a formatted list (bold lead-in, **Copy points** as Markdown, press again to rewrite). Deleted with the AI transcript it came from. The transcript is fenced as data in the prompt.
- **Categories, tags, search and notes on favourites** - pressing the heart saves the video and opens `FavLabelsDialog` at once (category dropdown of the ones already used plus + New category, tags with suggestions of tags already used; Skip for now leaves it unlabelled). A saved video has one category and up to 20 tags (`youtube_favourites.category` / `tags`; `PATCH /api/youtube/favourites/:videoId`; rules in `server/services/youtubeLabels.js`; tags use the same rule as note tags, so they are the same tags). The Favourites tab groups by category by default (or channel / none), filters by category and tags (all selected tags required) and searches titles, channels, categories, tags **and kept transcripts** (`GET /api/youtube/favourites/search`, every word must appear in the transcript; the card shows the first matching line). Transcripts are kept for saved videos only: the caption text of a favourite is stored in `youtube_caption_segments` when it is saved or its transcript is opened (best effort, YouTube may refuse), AI-written ones live in `youtube_transcripts`; kept captions go when the favourite is removed. **Create note** (`POST /api/youtube/video-note`, no AI; button under the player for any video and on each favourite) builds a note with the link, details, category and tags (if saved), Main points and Insights summary (if written) and the transcript as paragraphs with time links (kept, AI-written, or read now; the note says if none could be read); the page saves it through `/api/notes` and puts category + tags on it as note tags.
- **Titles are plain text** - the Data API sends titles and channel names HTML-escaped (`&quot;`, `&#39;`, `&amp;`). `server/services/htmlText.js` (`decodeHtml`, `decodeFields`) decodes them once in the search/trending/playlist/channel results, on saving a favourite or watch-history row, when reading saved rows (older rows still hold the escapes), in the follow checks, and in every note. A note made with Create note takes the video's title as its own title (the text starts with the link, no repeated heading).
- **Open note and select several** - `youtube_video_notes` remembers which note "Create note" made for a video (`PUT /api/youtube/video-notes/:videoId`, `GET /api/youtube/video-notes` joins to `notes`, so a note in the recycle bin drops out and the button goes back to Create note; restoring it brings the link back). The button then reads Open note and goes to `/notes?note=ID`. The Select button (`youtube/SelectBar.jsx`, `useSelection.js`) puts tick boxes on Results, Trending, Favourites, Recently watched and the search history: Favourites, Recently watched and search history delete through `POST /favourites/bulk-delete`, `/watch-history/bulk-delete`, `/history/bulk-delete` (500 at most); Results and Trending only hide the ticked videos on the page. Ticks are cleared when the Favourites filter changes so a hidden video is never deleted.

Both models treat the transcript as untrusted data (the prompts say so) and everything they return is parsed, stripped of HTML, clamped to the video's length and cut to size before it is stored or shown (`server/services/youtubeInsights.js`, tested without a model in `youtubeInsights.test.js`).

Routes: `GET /insights/:videoId`, `POST /insights {videoId, languageCode?, refresh?}`, `POST /ask {videoId, languageCode?, question, history?}`, `POST /note-draft {videoId, channel?}` (the last three behind the per-user AI rate limit), `GET /quota`. `POST /transcript` now also returns `segments: [{start, text}]` (the plain `transcript` text and `fetchYoutubeTranscript()`'s `{title, content}` are unchanged, so pinned URLs and Fetch URL behave as before; the function also returns `segments` and `languageCode`).

## Cache and quota (added 2026-11)

Every YouTube Data API call goes through `server/services/youtubeApi.js`: answers are cached (searches, details and playlists 6 hours, channels 12, categories 24, comments 1) in `youtube_api_cache` and deleted after **7 days** (the API terms limit how long API data may be kept); the day's quota is counted in `youtube_quota` (a search is 100 units, anything else about 1; the allowance resets at midnight **Pacific** time; `YOUTUBE_DAILY_QUOTA` overrides the default 10,000). A spent allowance (counted, or reported by Google) gives a plain **429** message instead of a raw Google error; searches already cached still work. The page warns when about 20 new searches are left. The captions themselves (InnerTube, not the Data API) are held in memory for 30 minutes so several questions about one video fetch them once. `npm run test:youtube`.

Fixed at the same time: the page called `addToast({ type, message })` but the toast store takes `(message, type)`, so those toasts (copied, saved as a list, errors) could not render properly.

## Generate a transcript with AI (added 2026-11)

A video with no captions Vault can read (many have none) offers **Generate a transcript with AI** in the Transcript, Insights and Ask panels. Google's **Gemini** is given the public YouTube address and listens to the video (`server/services/geminiVideo.js`, plain https; the video is read at low picture quality because only the sound matters, with a retry without that setting if the model rejects it). Vault never downloads or stores the video.

- **Confirm first:** a window shows the video's length, the **estimated cost** (tokens from the length, price from `costCalculator.js`; a ceiling of twice that is shown too), the **estimated wait** (a range) and the model, and nothing starts until **Generate transcript** is pressed. `GET /ai-transcript/:videoId/plan` builds it and starts nothing. The real tokens are logged to Usage & Cost under feature `youtube-transcript` (the cost estimate is only an estimate).
- **Background job:** `POST /ai-transcript` returns 202 and the work carries on after the window is closed (one job per person at a time, kept in memory; a server restart loses a running job, which then reports itself as lost and nothing is charged because nothing came back). The window polls `GET /ai-transcript/:videoId` every 3 seconds and picks up a running job if reopened.
- **Saved with the video:** as soon as the reply parses it is stored in `youtube_transcripts` (per person and video: segments with times, model, length, actual cost). From then on `Transcript`, `Insights`, `Ask` and the note builder read it exactly like captions (`getCaptions()` checks it first), saved videos (cards, favourites, lists, the watch window) carry a **Transcript saved** label, and an **AI transcript - Delete** button in the Transcript panel removes it. It is kept whether or not the video is a favourite, because it was paid for; deleting it frees it.
- **Limits and safety:** public videos up to 60 minutes (live streams and longer videos are refused with the reason, before anything is charged). The reply is untrusted text: it is parsed to timed lines, HTML stripped, times clamped to the video's length, out-of-order lines dropped, a reply that ran out of room keeps every complete line and says it was cut off (`youtubeAiTranscript.js`, tested without a model). The prompt tells the model that speech in the video is data, never instructions.
- **Gemini busy:** when Google answers 503 ("high demand") the request is repeated after 5 and then 15 seconds (three tries in all); if it is still busy the job fails with "Gemini is very busy right now. Nothing was charged. Try again in a few minutes." and the window offers Try again. Other failures are not repeated.
- **Uses `GEMINI_API_KEY` and the Gemini model chosen in Settings** (`getModelsForUser().gemini`, never a hardcoded id). Without them the window says so instead of offering to start.
- **Why a video can be unreadable now says why:** the caption fetch reports the video's playability (private, removed, age-restricted, or a robot check on the server) instead of calling everything "no captions". Only "no captions" and the robot check offer the AI transcript (Gemini reads the video from Google's side); a private or removed video does not.

Tests: `youtubeAiTranscript.test.js`, `geminiVideo.test.js` (request body, error wording, retry), `youtubeAiJobs.test.js` (plan, job, save, delete, one at a time, failures save and charge nothing); routes checked against a real database with a stubbed Gemini. **Not yet run against the real Gemini API**: the first real run is the check that YouTube-address input and the low-resolution setting work on your key and model.

## Following channels and searches (added 2026-11)

**+ Follow channel** (in a video's window, or **+ Follow this channel** in a channel view) and **+ Follow this search** (under the results) make Vault look for new videos for you. They appear on a new **Following** tab (with a count badge, **Check now** and **Mark all as seen**; opening a new video marks it seen) and as a line in **Needs attention** on the home page ("N new videos from what you follow on YouTube", opens `/youtube?tab=following`).

- **Cost-aware:** a channel is checked through its uploads list (1 quota unit), about every 5 hours; a followed search costs 100 units, so it is checked about once a day and the daily job skips searches when fewer than 10 are left. Limits: 30 channels, 5 searches. Check now only re-checks channels.
- **No flood:** the first look when you follow something records what is already there as seen, so only videos published afterwards are new.
- **Retention:** videos found by a check are deleted after 30 days (API terms).
- **How:** `server/services/youtubeFollows.js` (rules and tests without a database; the database parts were checked against a real database), `server/cron/youtubeFollowsCron.js` (every 6 hours, cron-locked, sends no email), tables `youtube_follows` and `youtube_follow_videos`. Routes: `GET /follows`, `POST /follows`, `DELETE /follows/:id`, `GET /follows/new`, `POST /follows/seen {videoIds | all}`, `POST /follows/check`.

Not built yet (from the 2026-11 review): quiz/flashcards from a video, a tagged watch-later queue, search across saved transcripts, comparing several videos, YouTube as a Topic Research source, email or phone alerts for new videos.

---

## Help: info box, tour and guide (added 2026-11)

- **(i) box** - opens once, then from the (i) beside the title (`HOW_IT_WORKS` in `client/src/pages/youtube/youtubeTools.mjs`).
- **Tour** - 7 steps (`client/src/utils/tours/youtubeTour.js`), from the compass beside the title or Settings -> Tours -> YouTube Tour (`/youtube?tour=1`). The page marks its parts with `data-tour` (`yt-search`, `yt-filters`, `yt-playlist`, `yt-tabs`).
- **YouTube guide** - the shared round-button chat (`guideId` `youtube`, `POST /api/youtube-tutor` behind the `youtube` switch, `server/services/youtubeTutor.js`, wrapper `client/src/pages/youtube/YoutubeTutorChat.jsx`). It knows the search box, filters, Open playlist, the tabs, the watch window, Insights, Ask, Save to Notes, Transcript and Comments, and says plainly what is not built (channel alerts, quizzes, searching saved transcripts, comparing videos) and what never will be (downloads). It sees no searches, videos or notes. Its Open buttons scroll to `data-guide="search-box"` or `"browse-tabs"` (the watch window only exists once a video is open, so its controls scroll to the results). Update `youtubeTools.mjs` and `CATALOG` together; `npm run test:youtube-tutor`.

---

## Tooltips

Every control (search input, mic button, sort/duration/date/live filters, Search button, tab switcher, favourite/remove/close buttons, history Re-run/delete, transcript/summarize/copy/language picker, comments/load-more, more-from-channel, open-playlist, back-to-search, trending region/category, save-as-list, open/delete list, recently-watched toggle/remove/clear-all) shows a themed hover popover via the shared `client/src/components/Tooltip.jsx` component — same one used by Graphics, PDF Tools, and Video Tools. This is a single-purpose page rather than a multi-tool grid, so it doesn't have the click-to-open per-tool help-icon layer those three pages have; the hover tooltips cover it.

---

## Schema

- `youtube_search_history` — `userId`, `query`, `filters` (JSONB: order/duration/publishedAfter), `resultCount`, `createdAt`.
- `youtube_favourites` — `userId`, `videoId` (unique per user), `title`, `channel`, `thumbnail`, `duration`, `viewCount`, `publishedAt`, `createdAt`.
- `youtube_saved_lists` — `userId`, `title`, `createdAt`. A named snapshot of a set of search results, distinct from favourites.
- `youtube_saved_list_items` — `listId` (FK → `youtube_saved_lists`, cascade delete), `videoId`, `title`, `channel`, `thumbnail`, `duration`, `viewCount`, `publishedAt`, `position`, `createdAt`.
- `youtube_watch_history` — `userId`, `videoId` (unique per user), `title`, `channel`, `thumbnail`, `duration`, `viewCount`, `publishedAt`, `watchedAt`. Distinct from `youtube_search_history` — this tracks videos opened in the watch modal, not searches run.

---

## Environment

| Var | Purpose |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 — search + video details |

---
