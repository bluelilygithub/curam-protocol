/**
 * Google's old "font effects" CSS API (fonts.googleapis.com/css?family=X&effect=Y)
 * — a pure CSS class (text-shadow/color, occasionally background-clip +
 * texture image), independent of which family you request it for. Applied
 * as rendering-layer CSS on top of the real exported custom font, never
 * baked into the font binary — same structural-vs-rendering-layer split
 * as the rest of this tool.
 *
 * Of the 27 effects Google originally documented, only 5 still return real
 * CSS today (checked directly) — the rest were texture/SVG-filter based
 * and their backing assets have since been removed from Google's CDN, so
 * the API now serves an empty `.font-effect-X {}` rule for them. Rather
 * than offer 27 options where 22 silently do nothing, only the ones that
 * still work are listed.
 */

export const FONT_EFFECTS = [
  { id: 'none', label: 'None' },
  { id: 'fire', label: 'Fire' },
  { id: 'neon', label: 'Neon' },
  { id: 'emboss', label: 'Emboss' },
  { id: 'outline', label: 'Outline' },
  { id: 'shadow-multiple', label: 'Shadow Multiple' },
];

const cssCache = new Map(); // effectId -> extracted CSS rule text (without the class selector wrapper)
let styleEl = null;

function ensureStyleEl() {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'font-customizer-effects';
    document.head.appendChild(styleEl);
  }
  return styleEl;
}

export function effectClassName(effectId) {
  return effectId && effectId !== 'none' ? `font-effect-${effectId}` : '';
}

/** Fetches (and caches) the effect's CSS rule, injecting it scoped to our own preview element id so it can't leak into/collide with anything else on the page. */
export async function ensureEffectLoaded(effectId, scopeSelector) {
  if (!effectId || effectId === 'none') return;
  const cacheKey = effectId;
  let ruleBody = cssCache.get(cacheKey);

  if (ruleBody === undefined) {
    const res = await fetch(`https://fonts.googleapis.com/css?family=Roboto&effect=${encodeURIComponent(effectId)}`);
    const css = await res.text();
    const match = css.match(new RegExp(`\\.font-effect-${effectId}\\s*\\{([^}]*)\\}`));
    ruleBody = match ? match[1].trim() : '';
    cssCache.set(cacheKey, ruleBody);
  }

  const el = ensureStyleEl();
  const scoped = `${scopeSelector}.font-effect-${effectId} { ${ruleBody} }`;
  // Replace rather than accumulate — only one effect is ever active in the preview at a time.
  el.textContent = ruleBody ? scoped : '';
}
