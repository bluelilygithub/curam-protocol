import type { Cue } from './api';
import { formatDistance, type Units } from './geo';

/**
 * The directions as plain text, for copying into an email or notes or saving as a .txt file:
 *   Morning loop
 *   4.78 km, 12 steps
 *
 *   1. Head north on Smith Street (400 m)
 *   2. Turn left onto Park Road (1.20 km)
 *   3. Arrive at your destination
 * Never touches the DOM, so it is tested in plain Node.
 */
export function cuesToText(input: { title: string; cues: Cue[]; units: Units }): string {
  const { cues, units } = input;
  const total = cues.reduce((n, c) => n + c.distanceM, 0);
  const title = input.title.replace(/\s+/g, ' ').trim() || 'Route';
  const out = [title, `${formatDistance(total / 1000, units)}, ${cues.length} ${cues.length === 1 ? 'step' : 'steps'}`, ''];
  cues.forEach((c, i) => out.push(`${i + 1}. ${c.text}${c.distanceM > 0 ? ` (${formatDistance(c.distanceM / 1000, units)})` : ''}`));
  out.push('', 'Directions © openrouteservice.org · © OpenStreetMap contributors. A guide only: follow signs and local rules.');
  return out.join('\n');
}

/** A file name for the text, from the route's name: letters, digits, spaces, dots, dashes and underscores, at most 80 long. */
export const textFileName = (title: string): string => `${title.replace(/[^\w\- .]+/g, '_').trim().slice(0, 80) || 'route'} - directions.txt`;
