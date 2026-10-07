// What "Join videos" can and cannot do, shown before "Plan my join" runs (same idea as the Slideshow's
// limits modal). Pure + dependency-free so it is unit-tested (node client/src/pages/videos/joinLimits.test.mjs).
//
// Join only concatenates the clips the user supplies: order, hard cut or a transition between them.
// Anything that changes the footage itself, adds sound, or makes new footage is outside it.

import { orderLimits, detectLimitsIn } from './slideshowLimits.mjs';

export const JOIN_CAN = [
  'Play your clips in the order you choose (or the order the description implies from the file names)',
  'A hard cut, or a blend between clips: crossfade, dissolve, fade through black, wipe, slide, circle or zoom',
  'How long each blend lasts',
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
    id: 'trim',
    title: 'Trimming or cutting parts out of a clip',
    why: 'Each clip is joined whole, start to finish.',
    workaround: 'Trim each clip first with Transform → Clip / trim, then join the trimmed versions.',
    pattern: /trim|cut (out|off|the)|shorten|remove (the )?(part|bit|start|end|section)|first \d+ ?s|last \d+ ?s|only (the )?(first|last)|snip/i,
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
    title: 'Changing speed, colour or the look of a clip',
    why: 'Join does not change what is inside a clip — no slow motion, speed-ups or colour looks.',
    workaround: 'Use Transform → Speed on a clip before joining. For a colour look across photos, the Slideshow tool has colour looks, but there is no colour grading for video clips.',
    pattern: /slow[\s-]?mo|slow(er)? down|speed (up|ramp)|time[\s-]?lapse|fast(er)?|colou?r (grade|grading|look|correct)|black and white|sepia|filter|vintage|warm(er)? tones?/i,
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
