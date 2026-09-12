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
