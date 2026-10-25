// Plain-words cost note shown before a paid Graphics tool runs. Pure, so it can be tested with node:
//   node client/src/pages/graphics/costText.test.mjs
// `p` is the answer from GET /api/graphics/cost-preview (see server/services/graphicsCostPreview.js).

const money = (n) => `$${Number(n) < 1 ? Number(n).toFixed(3) : Number(n).toFixed(2)}`;

/** Returns { text, level } where level is 'info' | 'warn' | 'block', or null when there is nothing to say. */
export function describeCost(p) {
  if (!p) return null;
  if (p.unavailable) return { text: p.unavailable, level: 'block' }; // for example Upscale in a recipe on a local copy
  const left = p.capUsd != null
    ? ` ${money(p.remainingUsd)} of today's ${money(p.capUsd)} limit left.`
    : '';

  if (p.free) return { text: 'Free: this runs on this machine, with no AI charge.', level: 'info' };

  if (p.blocked) {
    return {
      text: `Today's ${money(p.capUsd)} limit for AI image tools is used up, so this will be refused. It frees up as older jobs pass 24 hours.`,
      level: 'block',
    };
  }

  if (p.unknown) {
    return { text: `The cost is counted by use, not known in advance, and counts towards today's limit.${left}`, level: 'info' };
  }

  const sum = p.runs > 1 ? `${p.runs} × ${money(p.perRunUsd)} = ${money(p.totalUsd)}` : money(p.totalUsd);
  const text = `Estimated cost: ${p.estimate ? '~' : ''}${sum}.${left}`;
  if (p.overLimit) return { text: `${text} This would take you past today's limit.`, level: 'warn' };
  return { text, level: 'info' };
}
