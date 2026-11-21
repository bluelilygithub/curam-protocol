import type { NewChange } from '../compare/content';
import { ALL_RULES, normalize } from '../compare/normalize';
import type { PostCheck } from '../compare/postChecks';
import { charDice } from '../compare/textSim';
import { SEVERITY } from '../report/severity';

/**
 * Required headings (addendum §5.6). With no list set, every heading in the original counts as required, which removed-heading and
 * removed-section detection already reports, so nothing is added here (no double reporting). With a list pasted in Settings (for example an
 * inquiry's terms of reference), each one must be in the edited version (a close match counts: numbering and small wording differences),
 * and in that order.
 */
const key = (s: string) => normalize(s, ALL_RULES).toLowerCase().replace(/^[\d.()a-z]{1,6}[.)]\s+/, '').trim();

export const requiredHeadings: PostCheck = (_a, b, _ops, ctx) => {
  const required = ctx.settings.requiredHeadings.map((h) => h.trim()).filter(Boolean);
  if (!required.length) return [];
  const headings = b.blocks.filter((x) => x.type === 'heading').map((x, i) => ({ text: x.text, k: key(x.text), i }));
  const out: NewChange[] = [];
  const positions: { req: string; at: number }[] = [];
  for (const req of required) {
    const k = key(req);
    let best = -1, score = 0;
    headings.forEach((h, i) => { const s = h.k === k ? 1 : charDice(h.k, k); if (s > score) { score = s; best = i; } });
    if (best < 0 || score < 0.8) out.push({ category: 'requiredHeading', severity: SEVERITY.requiredHeadingMissing, location: 'Required headings', original: req, detail: `Required heading missing: "${req}"` });
    else positions.push({ req, at: best });
  }
  for (let i = 1; i < positions.length; i++) {
    if (positions[i].at < positions[i - 1].at) out.push({ category: 'requiredHeading', severity: SEVERITY.requiredHeadingOrder, location: 'Required headings', original: positions[i].req, detail: `Out of order: "${positions[i].req}" should come after "${positions[i - 1].req}"` });
  }
  return out;
};
