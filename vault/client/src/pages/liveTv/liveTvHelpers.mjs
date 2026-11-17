// Small pure helpers for the Live TV page (docs/live-tv.md). Tested by node client/src/pages/liveTv/liveTvHelpers.test.mjs.

/** The link to try first: one the browser can play that worked last time, else one that has not failed last time, else the first. */
export function pickStream(channel) {
  const streams = channel?.streams || [];
  const playable = streams.filter((s) => s.how === 'browser');
  if (!playable.length) return streams[0] || null;
  return playable.find((s) => s.lastPlay?.ok === true)
    || playable.find((s) => !s.lastPlay || s.lastPlay.ok !== false)
    || playable[0];
}

/** How the channel did for this person last time, for the badge on its row: 'ok', 'failed' or null. */
export function lastResult(channel) {
  const plays = (channel?.streams || []).map((s) => s.lastPlay).filter(Boolean);
  if (!plays.length) return null;
  if (plays.some((p) => p.ok)) return 'ok';
  return 'failed';
}

const clean = (v) => String(v || '').replace(/[\r\n]+/g, ' ').trim();

/** A one-channel playlist file that VLC (and most players) open; carries the referrer / user agent a browser cannot send. */
export function m3uFor(channel, stream) {
  const lines = ['#EXTM3U', `#EXTINF:-1,${clean(channel?.name) || 'Live TV'}`];
  if (stream.referrer) lines.push(`#EXTVLCOPT:http-referrer=${clean(stream.referrer)}`);
  if (stream.userAgent) lines.push(`#EXTVLCOPT:http-user-agent=${clean(stream.userAgent)}`);
  lines.push(clean(stream.url));
  return `${lines.join('\n')}\n`;
}

export function m3uFileName(channel) {
  const base = String(channel?.name || 'channel').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'channel';
  return `${base}.m3u`;
}

export const HOW_LABEL = {
  browser: 'Can play here',
  http: 'Needs VLC (plain http link)',
  headers: 'Needs VLC (needs settings a browser cannot send)',
};

export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || 'TV';
}
