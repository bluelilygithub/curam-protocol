/** Rendering-layer effects: color/gradient/image-fill + layered shadows,
 * built as plain CSS — never touches the font binary (see vault/CLAUDE.md's
 * structural-vs-rendering-layer boundary). Shared between the live React
 * preview (inline style object) and the copyable CSS snippet, so they can
 * never drift apart. */

export const DEFAULT_FILL = {
  mode: 'solid', // 'solid' | 'gradient' | 'image'
  solidColor: '#1A1A1A',
  gradientAngle: 90,
  gradientStops: [
    { color: '#CC785C', position: 0 },
    { color: '#5C6ACC', position: 100 },
  ],
  imageDataUrl: '',
};

export const DEFAULT_SHADOW = { offsetX: 2, offsetY: 2, blur: 4, color: 'rgba(0,0,0,0.35)' };

function gradientCss(fill) {
  const stops = fill.gradientStops.map((s) => `${s.color} ${s.position}%`).join(', ');
  return `linear-gradient(${fill.gradientAngle}deg, ${stops})`;
}

function fillBackgroundValue(fill) {
  if (fill.mode === 'gradient') return gradientCss(fill);
  if (fill.mode === 'image' && fill.imageDataUrl) return `url("${fill.imageDataUrl}") center / cover`;
  return null; // solid — handled via plain `color`, no background-clip needed
}

export function textShadowCss(shadows) {
  if (!shadows.length) return 'none';
  return shadows.map((s) => `${s.offsetX}px ${s.offsetY}px ${s.blur}px ${s.color}`).join(', ');
}

/** Inline style object for the live React preview element. */
export function buildPreviewStyle(familyName, fill, shadows) {
  const style = {
    fontFamily: `'${familyName}', sans-serif`,
    textShadow: textShadowCss(shadows),
  };
  const bg = fillBackgroundValue(fill);
  if (bg) {
    return {
      ...style,
      background: bg,
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
    };
  }
  return { ...style, color: fill.solidColor };
}

/** The copy-paste CSS snippet, including @font-face. */
export function buildCssSnippet({ familyName, woff2Filename, fill, shadows }) {
  const bg = fillBackgroundValue(fill);
  const fillLines = bg
    ? [
        `  background: ${bg};`,
        `  -webkit-background-clip: text;`,
        `  background-clip: text;`,
        `  color: transparent;`,
        `  -webkit-text-fill-color: transparent;`,
      ]
    : [`  color: ${fill.solidColor};`];

  return `@font-face {
  font-family: '${familyName}';
  src: url('${woff2Filename}') format('woff2');
  font-weight: normal;
  font-style: normal;
  font-display: swap;
}

.styled-text {
  font-family: '${familyName}', sans-serif;
${fillLines.join('\n')}
  text-shadow: ${textShadowCss(shadows)};
}`;
}
