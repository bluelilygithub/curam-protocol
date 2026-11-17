# Live TV

`/live-tv`, Apps → Personal. Flag `liveTv` (off for members until an admin switches it on; lifecycle `preview`). Built 2026-11-17.

Free TV channels from around the world, listed by the public [iptv-org](https://github.com/iptv-org/iptv) project, played in the
person's own browser. Decided with the owner: **the browser plays streams itself** (Vault never fetches or relays video: no Railway
bandwidth cost, and Vault is not a rebroadcaster), it is **for the owner's own watching**, and a **TV guide comes later**.

## How it works

- **Channel list** (`server/services/liveTv/catalogue.js`). Once a day the server fetches five files from `https://iptv-org.github.io/api/`
  (`channels`, `streams`, `blocklist`, `countries`, `categories`, about 12 MB together, one at a time, through `safeFetch.fetchPublicFile`)
  and keeps a trimmed copy in memory. A failed refresh keeps the old copy and is not retried for 10 minutes; with no copy at all the API
  answers 503 in plain words. The first request after a restart waits for the download (about 10–15 s locally).
- **Always left out:** channels with `is_nsfw`, channels on `blocklist.json` (DMCA takedowns and adult), closed channels, streams with
  no channel (nothing says what they are), and non-http(s) links. Duplicate links are dropped; at most 8 links per channel.
- **How each link can be watched** (`how`): `browser` (https, no special headers), `http` (blocked by browsers on an https page), or
  `headers` (needs a referrer / user agent a browser cannot send). Browser links sort first, best quality first. "Only ones that can play
  here" (on by default) hides channels with no `browser` link.
- **Player** (`server/routes/liveTvPlayer.js`, files in `server/services/liveTv/player/`). A separate page at `/api/live-tv-player/`
  shown in an iframe. It is mounted **before `requireAuth`** (a frame cannot send the login header) and is safe without one: it holds no
  data and only plays a URL the Live TV page sends it with a same-origin `postMessage`. It sets **its own Content-Security-Policy**
  (`media-src https: blob:`, `connect-src https:`, `script-src 'self'`, `frame-ancestors 'self'`) by replacing helmet's header, so only
  this page may load outside video and the rest of Vault keeps its strict policy. `Referrer-Policy: no-referrer`.
- **hls.js** is vendored as `player/hls.light.min.js` (v1.5.20, Apache-2.0, licence alongside) rather than added to `package.json`,
  so the deploy stays fast (docs/deploy-speed.md). Safari plays these streams natively; workers are off (`enableWorker: false`).
- The player reports `loading` / `playing` / `failed` (with a plain reason: refused, gone, unreachable, format, or no picture after 20 s).
  The page records each result (`POST /api/live-tv/plays`) so rows and links say "played / did not play last time".
- **Open in VLC** downloads a one-channel `.m3u` made in the browser (`liveTvHelpers.mjs`), including `#EXTVLCOPT` referrer / user-agent
  lines for links that need them. **Copy link** copies the URL.
- No logos: they live on many outside hosts that Vault's image policy does not allow; rows show initials instead.

## Staying in view while scrolling

- **Wide screens (xl, two columns):** the Watch panel is `sticky` at window height (`max-h-[calc(100dvh-6rem)]`); the picture stays at its top
  and the details, links and guide scroll inside it. The page's outer box has **no overflow** on purpose: the app frame (`main` in
  `Layout`) does the scrolling, and an overflow box that never scrolls would capture the sticky and stop it working (the original bug).
- **Narrower screens and phones:** an IntersectionObserver watches the picture's place; when under 40% of it is visible while a channel is
  loading, playing or has just failed, the same frame box becomes `position: fixed` in the bottom-right (above the guide button, draggable via
  `useDraggable`, key `vault:live-tv:mini:pos`) with Back (scrolls up) and Stop. Only CSS changes, so the iframe never reloads.
  Picking a channel no longer jumps to the top; it plays in the mini player.

## Country picker

A typeahead (the shared `Combobox` from `pages/measurements/shared.jsx`, with `prefixFirst` and `searchHint={false}`): typing on the closed
picker opens it with the letters already in; an exact code (`ca`, `uk`) comes first, then names or other names that start with the text
(`countryItems()` in `liveTvHelpers.mjs` adds codes and aliases such as uk/britain, usa, uae; iptv-org writes the United Kingdom as `UK`).

## TV guide (added 2026-11-17)

- **Source** (`server/services/liveTv/guide.js`): iptv-org hosts no guide; its `guides.json` (25 MB) says which outside guide covers each channel.
  Vault uses only the **i.mjh.nz** entries: free ready-made XMLTV files (redirected to raw.githubusercontent.com). `site_id` is
  `<file>#<channel id in the file>`, e.g. `au/Sydney/epg#mjh-gem-nsw` → `https://i.mjh.nz/au/Sydney/epg.xml.gz`, channel `mjh-gem-nsw`.
  About 930 playable channels have an entry (19 of 44 Australian, 14 of 20 NZ, 579 US). `guides.json` is scanned in its raw bytes for
  `"site":"i.mjh.nz"` (never parsed whole) and the map is kept for a day.
- **What is fetched:** the Australian channels in the list plus every channel anyone starred or played in the last 14 days, one entry
  per channel (the chosen Australian city's file first, workspace setting `live_tv_guide_region`, default Sydney, admin-only select on the
  page), at most 8 files per refresh (region file first, then the files covering most channels). Programmes from 3 hours ago to 8 days
  ahead go into `live_tv_programmes` (shared, no `"userId"`), replacing the covered channels' rows in one transaction.
- **When:** `server/cron/liveTvGuideCron.js` every 6 hours at :20 (cron-locked, skipped while nobody has favourites or plays, runs
  everywhere: free, sends nothing); the page's `/meta` starts a background refresh when the guide is older than 6 hours or missing
  (15-minute back-off after a failure); starring a channel with no programmes starts one too; admins can `POST /guide/refresh`.
- **XMLTV parsing** is a careful pattern over the text (XMLTV is flat): title, sub-title, desc, category, on-screen episode number;
  entities and CDATA decoded; times with their offsets. Tested in `guide.test.js`.
- **Page:** channel rows show what is on now; under the picture the chosen channel's guide by day (Today … 6 days ahead, viewer's own
  time) with ON NOW and expandable details; **Programmes** searches title / episode / description from now on, grouped by show (`titleKey`
  = title reduced to lower-case words), with Watch (on now: plays the channel) or Guide (opens the channel's guide on that day);
  **My shows** lists starred shows (`live_tv_shows`, per person, keyed by `titleKey`, so a show is followed on any channel) with their
  airings. Unstarring a show is a toggle, not binned.
- **Seen locally 2026-11-17** against the real files: 3,084 programmes for 16 channels in about 8 s; ABC News guide with ON NOW, a starred
  show listed in My shows with 5 airings, programme search, Guide opening the right day, phone width, no page errors.
- **Limits:** `Flash/epg` returns 404 today (reported in the run result, skipped). A refresh peaks at about 210 MB above normal memory for a
  few seconds (the 25 MB index once a day, then the unzipped XML files). No reminders when a favourite show starts. Channels the free guide
  does not cover have none; more than 8 files' worth of starred channels are left for later refreshes (`skipped` in the run result).

## Data

- `live_tv_favourites ("userId", "channelId")`: primary key on both. Unstarring is a toggle, so it does not go to the recycle bin.
- `live_tv_plays`: one row per attempt (`ok`, `problem`), trimmed to the newest 300 per person after each insert.
- `live_tv_programmes` (shared guide rows, indexes on `("channelId", start)` and `("titleKey", start)`); `live_tv_shows ("userId", "titleKey")`.
- `channelId` is iptv-org's id (e.g. `10Bold.au`). A favourite whose channel leaves the list simply stops showing.

## API (`/api/live-tv`, `requireFeature('liveTv')`, 120 requests/minute per person)

`GET /meta` (countries and kinds with counts, list date, favourite count) · `GET /channels?view=all|favourites|recent&country&category&q&browserOnly=1&offset&limit`
· `POST /favourites {channelId}` · `DELETE /favourites/:channelId` · `POST /plays {channelId, url, ok, problem}`
· `GET /guide/status` · `GET /guide/channel/:channelId?from&to` (at most 2 days) · `PUT /guide/region` (admin) · `POST /guide/refresh` (admin)
· `GET /programmes/search?q` · `GET|POST /shows` · `DELETE /shows/:titleKey`. `GET /channels?ids=a,b` returns exactly those channels.
The two guide reads are listed as shared by design in `crossUserOwnership.test.js`.
Guide chat: `POST /api/live-tv-tutor` (`liveTvTutor.js`, `liveTv/liveTvTools.mjs`). Tour: Settings → Tours → Live TV Tour.

## Tests

`node server/services/liveTv/catalogue.test.js` (filtering, ordering, caching, failed refresh) · `node server/services/liveTv/guide.test.js` · `node server/services/liveTvTutor.test.js`
· `node client/src/pages/liveTv/liveTvHelpers.test.mjs`. Seen in a local browser on 2026-11-17: the Australian list loaded, 10 Bold played,
star, Favourites/Recent tabs, search, VLC file, phone width with no sideways scroll, no page errors.

## Limits and not built

- **Not run on Railway.** In production the main page's helmet policy applies; the player's own policy was exercised locally (it is set in
  every environment) but the combination is untested there. Railway's server location does not matter for playback (the browser fetches),
  but the daily list download must reach github.io.
- Most links fail somewhere: off air, geo-blocked, or only playable on the broadcaster's own site. Expect a third to a half not to play.
- Not built: show reminders, logos, casting, adding your own
  playlists, recording. Being on the list does not make a channel licensed in Australia; the page and guide say so in plain words.
