// Render photo for the garden: how bright and what colour the sun and sky are. Pure (no three.js) so it is tested.
//
// Unlike a room, a garden has a real sun: its direction is where the time slider and month put it for the garden's latitude, longitude and
// north arrow, so the shadows in the photo fall exactly where they do in the live view. The lighting choice only decides the MOOD: how
// strong the sun is, how warm, and what the sky looks like. A low sun is always warmer and weaker, whatever the choice.
import { LIGHTING, type PhotoLighting } from '@planner-core/render3d/photo';

export interface GardenLight {
  /** False when the sun is on or below the horizon: there is nothing to light a daytime picture with. */
  sunUp: boolean;
  sunIntensity: number;
  sunColour: string;
  skyTop: string;
  skyHorizon: string;
  skyLight: number;
}

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const hex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
const toHex = (c: [number, number, number]): string => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
/** Blend a toward b by t (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const x = hex(a), y = hex(b), k = clamp01(t);
  return toHex([x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k]);
}

/** The sun's colour at the horizon, before it clears the haze. */
export const HORIZON_SUN = '#ff9a50';
/** Below this many degrees the clear-sky preset starts to take on evening colours. */
export const GOLDEN_BELOW_DEG = 12;

export function gardenLighting(preset: PhotoLighting, altitudeDeg: number): GardenLight {
  const p = LIGHTING[preset];
  const up = altitudeDeg > 0;
  const low = clamp01(altitudeDeg / 25); // 0 at the horizon, 1 once the sun is well up
  const strength = 0.35 + 0.65 * low; // a low sun is weaker on the ground
  const sunIntensity = up ? p.sun * strength : 0;
  const sunColour = preset === 'overcast' ? p.sunColour : mix(HORIZON_SUN, p.sunColour, low);

  let skyTop = p.skyTop, skyHorizon = p.skyHorizon, skyLight = p.skyLight;
  if (preset === 'daylight' && altitudeDeg < GOLDEN_BELOW_DEG) {
    // a clear sky turns golden as the sun sinks
    const e = LIGHTING.evening;
    const k = clamp01((GOLDEN_BELOW_DEG - Math.max(0, altitudeDeg)) / GOLDEN_BELOW_DEG);
    skyTop = mix(p.skyTop, e.skyTop, k);
    skyHorizon = mix(p.skyHorizon, e.skyHorizon, k);
    skyLight = p.skyLight + (e.skyLight - p.skyLight) * k;
  }
  return { sunUp: up, sunIntensity, sunColour, skyTop, skyHorizon, skyLight };
}

/** The plain-words line under the lighting list. */
export const LIGHTING_HELP = 'The sun is where the time slider and month put it, so shadows match the 3D view. Daylight is a clear sky (it turns golden as the sun sinks); Overcast is soft and even; Evening is warm with a rosy sky.';
export const SUN_DOWN_MESSAGE = 'The sun is down at this time. Choose a daytime hour with the Time slider, then render.';
