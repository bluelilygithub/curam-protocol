// What "Join videos" can and cannot do, shown before "Plan my join" runs (same idea as the Slideshow's
// limits modal). Pure + dependency-free so it is unit-tested (node client/src/pages/videos/joinLimits.test.mjs).
//
// Join plays the clips the user supplies in order, with a transition between each pair and simple effects on
// each clip (trim, speed, brightness/contrast/saturation, black-and-white/warm/cool, fades, volume).
// Anything beyond that, adds sound, or makes new footage is outside it.

import { orderLimits, detectLimitsIn } from './slideshowLimits.mjs';

export const JOIN_CAN = [
  'Play your clips in the order you choose (or the order the description implies from the file names)',
  'A transition at each join: hard cut, crossfade, dip to black or white (with level, hold and fade shape), wipe or slide in any direction',
  'How long each transition lasts, and a different one for each join',
  'Per-clip effects: trim, slow motion or fast forward, brightness / contrast / saturation, black-and-white / warm / cool looks, fade in and out, volume or mute',
  'Clips of different sizes and frame rates — they are matched automatically',
];

export const JOIN_LIMITS = [
  {
    id: 'music',
    title: 'Adding or creating music',
    why: "Join doesn't add any music. Each clip keeps its own sound.",
    workaround: 'Join first, then open Music: upload the joined video, pick a mood and export it with the music mixed in. Or add an existing track afterwards with Optimise → Mute / replace audio.',
    pattern: /music|song|soundtrack|background (track|sound)|\bsound\b|audio|chill(ed)?|jazz|ambient|lo-?fi|melod|tune/i,
  },
  {
    id: 'text',
    title: 'Titles, captions and on-screen text',
    why: "Join doesn't draw text over the video.",
    workaround: 'Join first, then add a label with Compose → Annotate, or burned-in subtitles with Compose → Caption studio.',
    pattern: /\btitle|caption|subtitle|lower third|text\b|label|logo|watermark|overlay/i,
  },
  {
    id: 'look',
    title: 'Full colour grading, LUTs or custom filters',
    why: 'Join has simple looks (black and white, warm, cool) plus brightness, contrast and saturation, but no LUT files, curves or other filters.',
    workaround: 'Use the simple looks and the brightness / contrast / saturation controls on each clip for the nearest match.',
    pattern: /\blut\b|colou?r (grade|grading|correct)|sepia|vintage|curves|vignette|blur|filter/i,
  },
  {
    id: 'newfootage',
    title: 'Making footage that you do not have',
    why: "Join can only use the clips you give it. It can't create a missing shot, fill a gap or add a person or an object.",
    workaround: 'Create the missing clip first with Create → Generate clip (choose a photo as the reference image and describe the shot), then join it with the others.',
    pattern: /\b(generate|create|make|add) (a |an |some |new |another )?(clip|shot|scene|footage|video)|missing (shot|footage|clip)|a person|someone|\bbottles?\b|fill the gap|b-?roll/i,
  },
  {
    id: 'shape',
    title: 'Clips with different shapes (portrait and landscape)',
    why: 'All clips are fitted to the first clip\'s frame, with bars where the shape differs.',
    workaround: 'Make the clips the same shape first with Transform → Crop / reframe, so nothing gets bars.',
    pattern: /portrait|landscape|vertical|9:16|16:9|square|1:1|aspect|crop|reframe|resize/i,
  },
];

export const JOIN_FOOTNOTE = 'The planner only sees your description and the clip file names — not the footage itself.';

/** Ids of the Join limits the description's wording runs into. */
export function detectJoinLimits(description) {
  return detectLimitsIn(JOIN_LIMITS, description);
}

/** All Join limits, the ones the description touches first. */
export function orderedJoinLimits(description) {
  return orderLimits(JOIN_LIMITS, description);
}
