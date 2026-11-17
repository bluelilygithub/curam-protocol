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

## Data

- `live_tv_favourites ("userId", "channelId")`: primary key on both. Unstarring is a toggle, so it does not go to the recycle bin.
- `live_tv_plays`: one row per attempt (`ok`, `problem`), trimmed to the newest 300 per person after each insert.
- `channelId` is iptv-org's id (e.g. `10Bold.au`). A favourite whose channel leaves the list simply stops showing.

## API (`/api/live-tv`, `requireFeature('liveTv')`, 120 requests/minute per person)

`GET /meta` (countries and kinds with counts, list date, favourite count) · `GET /channels?view=all|favourites|recent&country&category&q&browserOnly=1&offset&limit`
· `POST /favourites {channelId}` · `DELETE /favourites/:channelId` · `POST /plays {channelId, url, ok, problem}`.
Guide chat: `POST /api/live-tv-tutor` (`liveTvTutor.js`, `liveTv/liveTvTools.mjs`). Tour: Settings → Tours → Live TV Tour.

## Tests

`node server/services/liveTv/catalogue.test.js` (filtering, ordering, caching, failed refresh) · `node server/services/liveTvTutor.test.js`
· `node client/src/pages/liveTv/liveTvHelpers.test.mjs`. Seen in a local browser on 2026-11-17: the Australian list loaded, 10 Bold played,
star, Favourites/Recent tabs, search, VLC file, phone width with no sideways scroll, no page errors.

## Limits and not built

- **Not run on Railway.** In production the main page's helmet policy applies; the player's own policy was exercised locally (it is set in
  every environment) but the combination is untested there. Railway's server location does not matter for playback (the browser fetches),
  but the daily list download must reach github.io.
- Most links fail somewhere: off air, geo-blocked, or only playable on the broadcaster's own site. Expect a third to a half not to play.
- Not built: a TV guide (iptv-org's guides need a grabber run per guide site: a separate background job), logos, casting, adding your own
  playlists, recording. Being on the list does not make a channel licensed in Australia; the page and guide say so in plain words.
