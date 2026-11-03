import { suggestProgressions } from './progressions.mjs';

/**
 * A chord change as a route: the two chords plus the chords between them from a real progression in a key that has both (C#m to E by way
 * of A: C#m, A, E, B). Three stages share the block's minutes: the pair slowly, the whole route as a loop, then faster.
 */
export function routeStages(a, b, minutes) {
  const m = Math.max(3, Math.round(minutes) || 5);
  const first = Math.max(1, Math.round(m * 0.3));
  const second = Math.max(1, Math.round(m * 0.45));
  const third = Math.max(1, m - first - second);
  const found = suggestProgressions(a, b);
  const pick = found.items[0] || null;
  const route = pick ? pick.chords : null;
  return {
    pick, route, reason: found.reason || null,
    stages: [
      { minutes: first, text: `Slowly: ${a} to ${b} and back. Land each chord cleanly before you move; stop after 8 clean changes in a row.` },
      route
        ? { minutes: second, text: `The route: ${route.join(' → ')} → back to ${route[0]}. Go round it without stopping, four times, at a pace where every chord rings.` }
        : { minutes: second, text: `${a} and ${b} do not share a key, so keep to the two chords and hold each for four beats.` },
      { minutes: third, text: 'Faster: nudge the pace up one notch at a time. If a change breaks, drop back one notch.' },
    ],
  };
}
