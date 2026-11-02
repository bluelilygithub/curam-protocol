'use strict';

// Guitar practice rules, pure code (no database): song state, "going rusty", and Today's queue.

const LEARN_STATUSES = ['learning', 'polishing', 'ready'];
const DEFAULT_RUSTY_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function daysSince(date, now) {
  if (!date) return null;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / DAY_MS));
}

/**
 * The state shown for a song. Learning stays Learning. A Polishing or Ready song becomes Rusty when it has not
 * been played for `rustyAfterDays` days (a song marked Ready that was never played counts from when it was added).
 */
function practiceState({ learnStatus, lastPracticedAt, rustyAfterDays, createdAt }, now = new Date()) {
  const status = LEARN_STATUSES.includes(learnStatus) ? learnStatus : 'learning';
  if (status === 'learning') return 'learning';
  const limit = Number.isFinite(Number(rustyAfterDays)) && Number(rustyAfterDays) > 0 ? Number(rustyAfterDays) : DEFAULT_RUSTY_DAYS;
  const idle = daysSince(lastPracticedAt || createdAt, now);
  if (idle !== null && idle >= limit) return 'rusty';
  return status;
}

function byLeastRecent(a, b) {
  const ta = a.lastPracticedAt ? new Date(a.lastPracticedAt).getTime() : 0;
  const tb = b.lastPracticedAt ? new Date(b.lastPracticedAt).getTime() : 0;
  return ta - tb;
}

/**
 * "I have 20 minutes, what should I do?" One song being learned, one loop to work up, one song going rusty, and one
 * song being polished. Each slot is left out when there is nothing for it. A song is never offered twice.
 * songs: [{ id, title, artist, learnStatus, lastPracticedAt, rustyAfterDays, createdAt }]
 * loops: [{ id, name, songId, startTimeSec, endTimeSec }]
 */
function buildQueue(songs, loops, now = new Date()) {
  const rows = (songs || []).map(s => ({ ...s, state: practiceState(s, now) }));
  const used = new Set();
  const items = [];
  const take = (list) => {
    const hit = list.filter(s => !used.has(s.id)).sort(byLeastRecent)[0];
    if (hit) used.add(hit.id);
    return hit;
  };
  const describe = (s, kind, reason) => ({
    kind, songId: s.id, title: s.title, artist: s.artist, state: s.state, reason,
    daysIdle: daysSince(s.lastPracticedAt, now),
  });

  const learning = take(rows.filter(s => s.state === 'learning'));
  if (learning) items.push(describe(learning, 'learning', learning.lastPracticedAt ? 'Still learning this one' : 'Learning, not played yet'));

  const learningIds = new Set(rows.filter(s => s.state === 'learning' || s.state === 'polishing').map(s => s.id));
  const songById = new Map(rows.map(s => [s.id, s]));
  const loop = (loops || [])
    .filter(l => learningIds.has(l.songId))
    .sort((a, b) => byLeastRecent(songById.get(a.songId), songById.get(b.songId)))[0];
  if (loop) {
    const s = songById.get(loop.songId);
    items.push({ ...describe(s, 'loop', 'Work this section up to speed'), loopId: loop.id, loopName: loop.name,
      startTimeSec: Number(loop.startTimeSec), endTimeSec: Number(loop.endTimeSec) });
  }

  const rusty = take(rows.filter(s => s.state === 'rusty'));
  if (rusty) items.push(describe(rusty, 'rusty', 'Going rusty, play it before it fades'));

  const polishing = take(rows.filter(s => s.state === 'polishing'));
  if (polishing) items.push(describe(polishing, 'polishing', 'Polish it until it is clean'));

  return items;
}

module.exports = { LEARN_STATUSES, DEFAULT_RUSTY_DAYS, practiceState, buildQueue };
