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

// Other names people type for a country, so "uk", "usa" or "britain" find it in the country picker.
const COUNTRY_ALIASES = {
  // iptv-org writes the United Kingdom as UK, not GB; both are listed so either works
  UK: 'gb britain england scotland wales', GB: 'uk britain england scotland wales', US: 'usa america states', AE: 'uae emirates dubai', KR: 'korea south', KP: 'korea north',
  NZ: 'aotearoa', NL: 'holland', CZ: 'czechia', RU: 'russia', VN: 'vietnam', IR: 'iran', TW: 'taiwan', HK: 'hongkong',
};

/** The country picker's items: All countries first, then each country with its channel count; its code and other names are searchable. */
export function countryItems(countries) {
  const total = (countries || []).reduce((n, c) => n + c.count, 0);
  return [
    { id: '', label: 'All countries', hint: total ? `${total.toLocaleString()} channels` : '', keywords: 'all every world' },
    ...(countries || []).map((c) => ({
      id: c.code,
      label: c.name,
      hint: `${c.count} channel${c.count === 1 ? '' : 's'}`,
      keywords: `${c.code} ${COUNTRY_ALIASES[c.code] || ''}`.toLowerCase(),
    })),
  ];
}

// ---- TV guide ----

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The guide's day choices in the viewer's own time: Today, Tomorrow, then "Thu 20" and so on, each with its start and end. */
export function guideDays(now = new Date(), count = 7) {
  const out = [];
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (let i = 0; i < count; i++) {
    const from = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const to = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i + 1);
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${DAY_NAMES[from.getDay()]} ${from.getDate()}`;
    out.push({ key: `${from.getFullYear()}-${from.getMonth() + 1}-${from.getDate()}`, label, from, to });
  }
  return out;
}

/** "7:30 pm" in the viewer's own time. */
export function clock(value) {
  const d = new Date(value);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'pm' : 'am';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}

/** "Today 7:30 pm", "Tomorrow 9:00 am" or "Thu 20 8:00 pm". */
export function whenText(value, now = new Date()) {
  const d = new Date(value);
  const day = guideDays(now, 8).find((x) => d >= x.from && d < x.to);
  return `${day ? day.label : `${DAY_NAMES[d.getDay()]} ${d.getDate()}`} ${clock(d)}`;
}

export function isOnNow(p, now = new Date()) {
  return new Date(p.start) <= now && new Date(p.stop) > now;
}

export function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] || '') + (words[1]?.[0] || '')).toUpperCase() || 'TV';
}
