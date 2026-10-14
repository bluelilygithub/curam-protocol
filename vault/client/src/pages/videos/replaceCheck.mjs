// The live "does my clip fit the section?" message for Replace a section. It mirrors the server's rule (server/services/replaceSection.js,
// planReplaceSection): a clip within a tenth of a second of the section is fixed quietly; anything more is refused with the exact amount
// to trim. Showing it before the upload saves sending a large video only to be told it does not fit.

export const TOLERANCE_SEC = 0.1;

const r3 = (n) => Math.round(n * 1000) / 1000;
const s1 = (n) => (Math.round(n * 10) / 10).toFixed(1);

/**
 * @param {number} sectionSec  length of the section being replaced (null/0 if not known yet)
 * @param {number} clipSec     length of the replacement clip (null/0 if not chosen yet)
 * @returns {{ state: 'unknown'|'ok'|'fixed'|'long'|'short', ok: boolean, text: string }}
 */
export function describeFit(sectionSec, clipSec) {
  const section = Number(sectionSec);
  const clip = Number(clipSec);
  if (!(clip > 0)) return { state: 'unknown', ok: false, text: 'Choose the replacement clip to check its length.' };
  if (!(section > 0)) return { state: 'unknown', ok: false, text: 'Set the start of the section.' };
  const diff = r3(clip - section);
  if (Math.abs(diff) < 0.005) return { state: 'ok', ok: true, text: `Lengths match: the section and your clip are both ${s1(section)} s.` };
  if (Math.abs(diff) <= TOLERANCE_SEC) {
    return { state: 'fixed', ok: true, text: `Your clip is ${s1(clip)} s and the section is ${s1(section)} s. That is close enough: the tiny difference is fixed for you.` };
  }
  if (diff > 0) {
    return { state: 'long', ok: false, text: `Your clip is ${s1(diff)} s too long (the section is ${s1(section)} s, the clip is ${s1(clip)} s). Trim ${s1(diff)} s off the clip in Clip / trim first.` };
  }
  return { state: 'short', ok: false, text: `Your clip is ${s1(-diff)} s too short (the section is ${s1(section)} s, the clip is ${s1(clip)} s). Use a clip that is ${s1(section)} s long, or make the section ${s1(-diff)} s shorter.` };
}
