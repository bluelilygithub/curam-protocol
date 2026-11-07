// "Let the AI look" (Video Tools, Slideshow and Join planners): the pure parts, so `node client/src/pages/videos/visionFrames.test.mjs` checks them.
// The browser makes the small copies (visionCapture.js); the server checks and prices them (server/services/videoVision.js). Nothing is sent unless the person
// ticks the box. The prices come from GET /api/videos/vision-info, so the page never keeps its own copy of a price.

export const MAX_PX = 512;
export const FRAMES_PER_CLIP = 2; // 12 clips x 2 frames = 24, the most one plan takes

/** Scale (w, h) so the longest side is at most `max`, never bigger than the original, at least 1 pixel. */
export function fitWithin(w, h, max = MAX_PX) {
  const W = Math.max(1, Math.round(Number(w) || 0));
  const H = Math.max(1, Math.round(Number(h) || 0));
  const longest = Math.max(W, H);
  if (longest <= max) return { w: W, h: H };
  const k = max / longest;
  return { w: Math.max(1, Math.round(W * k)), h: Math.max(1, Math.round(H * k)) };
}

/** Where in a clip (seconds) to take `count` frames: spread through the clip and away from the very first and last frames (often black or a fade). */
export function frameTimes(duration, count) {
  const d = Number(duration);
  const n = Math.max(1, Math.min(3, Math.floor(count) || 1));
  if (!Number.isFinite(d) || d <= 0) return [0];
  const spots = { 1: [0.4], 2: [0.25, 0.7], 3: [0.15, 0.5, 0.85] }[n];
  const last = Math.max(0, d - 0.1);
  return spots.map((p) => Math.min(last, Math.max(0, Math.round(d * p * 100) / 100)));
}

const usd = (n) => `US$${n < 0.1 ? n.toFixed(3) : n.toFixed(2)}`;

/** What one plan would cost: the fixed part plus each picture. null when there is no price yet. */
export function planCostUsd(info, pictures) {
  if (!info || !info.available || !(info.usdPerFrame >= 0) || !(info.planBaseUsd >= 0)) return null;
  return info.planBaseUsd + info.usdPerFrame * Math.max(0, pictures);
}

/**
 * The sentence under the tick box, built BEFORE anything is sent. `what` is 'pictures' (Slideshow) or 'clips' (Join); `count` is how many pictures or clips are
 * in the tool now. @returns {{ ok: boolean, text: string, pictures: number }} `ok` false means the box cannot be used (no model, too many pictures)
 */
export function visionSummary(info, what, count) {
  const pictures = what === 'clips' ? count * FRAMES_PER_CLIP : count;
  if (!info) return { ok: false, text: 'Checking what the AI look would cost…', pictures };
  if (!info.available) return { ok: false, text: info.problem || 'No AI model that can look at pictures is set up.', pictures };
  if (pictures > info.maxFrames) {
    return { ok: false, text: `That would be ${pictures} pictures and one plan takes at most ${info.maxFrames}. Use ${what === 'clips' ? `${Math.floor(info.maxFrames / FRAMES_PER_CLIP)} clips` : `${info.maxFrames} pictures`} or fewer.`, pictures };
  }
  const cost = planCostUsd(info, pictures);
  const what2 = what === 'clips' ? `${FRAMES_PER_CLIP} small frames from each of your ${count} clip${count === 1 ? '' : 's'} (${pictures} pictures)` : `a small copy of each of your ${count} picture${count === 1 ? '' : 's'}`;
  return {
    ok: true,
    pictures,
    text: `Sends ${what2}, at most ${info.maxPx} pixels wide, to the AI model (${info.model}) so it can suggest a sensible order. About ${usd(cost)} for this plan. Your original ${what === 'clips' ? 'videos' : 'pictures'} stay in your browser, and nothing is sent unless this is ticked.`,
  };
}

/** After a plan: what the AI was shown, for the page to say. '' when it only saw the words. */
export function visionNote(plan) {
  const v = plan && plan.vision;
  if (!v || !v.pictures) return '';
  return `The AI looked at ${v.pictures} small picture${v.pictures === 1 ? '' : 's'} (${v.model || 'the AI model'}) as well as your description. It can still misjudge a picture, so check the plan before building.`;
}

/** The "what it sees" footnote of the limits modal. */
export function seesFootnote(what, look) {
  if (look) return `It sees your description, the ${what === 'clips' ? 'clip' : 'file'} names and small copies of your ${what === 'clips' ? 'clips (two frames each)' : 'pictures'} (never the originals).`;
  return `It only sees your description and the ${what === 'clips' ? 'clip ' : ''}file names — not the ${what === 'clips' ? 'footage itself' : 'pictures themselves'}.`;
}
