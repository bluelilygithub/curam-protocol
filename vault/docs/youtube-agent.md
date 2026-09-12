# YouTube

A YouTube search tool mounted in Vault at **`/youtube`**. Search by keyword or plain-language description, watch videos in an embedded player, save favourites, and replay past searches.

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
- **Favourites** — save/remove videos (`youtube_favourites` table), listed in their own tab.
- **History** — every search is recorded (`youtube_search_history`, last 30 shown), with a one-click "Re-run" to repeat a past search exactly, and per-row delete.

**No download feature.** An earlier version linked out to a third-party YouTube-ripping service (cobalt.tools) from the Download buttons on each video card, the favourites row, and the watch modal. This was removed — downloading video content from YouTube outside YouTube's own means violates YouTube's Terms of Service regardless of which tool performs the download, and risks copyright exposure for whatever content a user picks. Watching happens in-app via the embed above; anyone with rights to a video and a genuine need to work on the file should acquire it through legitimate means and upload it directly wherever it's needed (e.g. Video Tools).

---

## API

```
POST   /api/youtube/parse-query        JSON { input } → { q, order, duration, publishedKey, reasoning }
GET    /api/youtube/search             ?q=&order=&duration=&publishedAfter= → { videos, totalResults }
GET    /api/youtube/history            last 30 searches for the user
DELETE /api/youtube/history/:id
GET    /api/youtube/favourites
POST   /api/youtube/favourites         { videoId, title, channel, thumbnail, duration, viewCount, publishedAt }
DELETE /api/youtube/favourites/:videoId
```

Search results are two YouTube Data API calls per request: `search.list` (query + filters) then `videos.list` (duration/view-count enrichment for the matched ids).

---

## Tooltips

Every control (search input, mic button, sort/duration/date filters, Search button, tab switcher, favourite/remove/close buttons, history Re-run/delete) shows a themed hover popover via the shared `client/src/components/Tooltip.jsx` component — same one used by Graphics, PDF Tools, and Video Tools. This is a single-purpose page rather than a multi-tool grid, so it doesn't have the click-to-open per-tool help-icon layer those three pages have; the hover tooltips cover it.

---

## Schema

- `youtube_search_history` — `userId`, `query`, `filters` (JSONB: order/duration/publishedAfter), `resultCount`, `createdAt`.
- `youtube_favourites` — `userId`, `videoId` (unique per user), `title`, `channel`, `thumbnail`, `duration`, `viewCount`, `publishedAt`, `createdAt`.

---

## Environment

| Var | Purpose |
|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 — search + video details |

---

## Possible follow-ups (not built)

- **Transcript/summary on a searched video** — `youtubeTranscript.js` already fetches captions and is used elsewhere (Video Tools' Generate reference flow), but this page has no "get transcript" or "summarize this video" action of its own, even though the service is already there and doesn't touch the download question at all.
- **Channel/playlist search** — currently video-only; no way to browse everything from one channel or open a playlist as a set.
