# YouTube

A YouTube search tool mounted in Vault at **`/youtube`**. Search by keyword or plain-language description, watch videos in an embedded player, pull a transcript or AI summary, browse more from a channel, save favourites, save whole result sets as named lists, and replay past searches.

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
- **Saved lists** — "Save this search as a list" on the results view (or a channel view) prompts for a title and saves the current set of videos as a named list, separate from per-video favourites. A "Lists" tab shows saved lists; opening one shows its videos in the same grid; a list can be deleted entirely.

**No download feature.** An earlier version linked out to a third-party YouTube-ripping service (cobalt.tools) from the Download buttons on each video card, the favourites row, and the watch modal. This was removed — downloading video content from YouTube outside YouTube's own means violates YouTube's Terms of Service regardless of which tool performs the download, and risks copyright exposure for whatever content a user picks. Watching happens in-app via the embed above; anyone with rights to a video and a genuine need to work on the file should acquire it through legitimate means and upload it directly wherever it's needed (e.g. Video Tools).

---

## API

```
POST   /api/youtube/parse-query        JSON { input } → { q, order, duration, publishedKey, reasoning }
GET    /api/youtube/search             ?q=&order=&duration=&publishedAfter= → { videos, totalResults }
GET    /api/youtube/channel/:channelId → { videos, totalResults } — that channel's videos, newest first
POST   /api/youtube/transcript         JSON { videoId, summarize? } → { title, transcript, summary? }
GET    /api/youtube/history            last 30 searches for the user
DELETE /api/youtube/history/:id
GET    /api/youtube/favourites
POST   /api/youtube/favourites         { videoId, title, channel, thumbnail, duration, viewCount, publishedAt }
DELETE /api/youtube/favourites/:videoId
GET    /api/youtube/lists              saved lists (id, title, createdAt, itemCount) for the user
POST   /api/youtube/lists              { title, videos: [...] } → { ok, id }
GET    /api/youtube/lists/:id          { id, title, createdAt, videos: [...] }
DELETE /api/youtube/lists/:id
DELETE /api/youtube/lists/:id/items/:videoId   remove one video from a saved list
```

Search results are two YouTube Data API calls per request: `search.list` (query + filters) then `videos.list` (duration/view-count enrichment for the matched ids). The `/channel/:channelId` route reuses the same `enrichAndMapItems()` helper against a `search.list` call scoped by `channelId` instead of a text query. `snippet.channelId` is included in every mapped video object so the client can offer "More from this channel".

`/transcript` calls the existing `fetchYoutubeTranscript()` service (no new fetch logic); when `summarize` is true it also sends the transcript to `callModel` on the workspace `light` tier (via `getModelsForUser`) with a short system prompt asking for a concise summary. A video with no captions returns a 404 with a friendly message rather than the raw service error.

---

## Tooltips

Every control (search input, mic button, sort/duration/date filters, Search button, tab switcher, favourite/remove/close buttons, history Re-run/delete, transcript/summarize/copy, more-from-channel, back-to-search, save-as-list, open/delete list) shows a themed hover popover via the shared `client/src/components/Tooltip.jsx` component — same one used by Graphics, PDF Tools, and Video Tools. This is a single-purpose page rather than a multi-tool grid, so it doesn't have the click-to-open per-tool help-icon layer those three pages have; the hover tooltips cover it.

---

## Schema

- `youtube_search_history` — `userId`, `query`, `filters` (JSONB: order/duration/publishedAfter), `resultCount`, `createdAt`.
- `youtube_favourites` — `userId`, `videoId` (unique per user), `title`, `channel`, `thumbnail`, `duration`, `viewCount`, `publishedAt`, `createdAt`.
- `youtube_saved_lists` — `userId`, `title`, `createdAt`. A named snapshot of a set of search results, distinct from favourites.
- `youtube_saved_list_items` — `listId` (FK → `youtube_saved_lists`, cascade delete), `videoId`, `title`, `channel`, `thumbnail`, `duration`, `viewCount`, `publishedAt`, `position`, `createdAt`.

---

## Environment

| Var | Purpose |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 — search + video details |

---

## Possible follow-ups (not built)

- **Playlist search** — channel search is now built; there's still no way to open a playlist as a set (only individual channels/videos).
