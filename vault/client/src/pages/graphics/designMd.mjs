// DESIGN.md from the saved Brand Kit (docs/brand-from-url.md, step 5). Pure text, no React, so it can be tested with plain node:
//   node client/src/pages/graphics/designMd.test.mjs
//
// A DESIGN.md is a plain markdown file kept next to README.md in a project: it tells an AI coding tool (or a person) the real colours,
// fonts and shapes of a brand, so what it builds looks like the brand. Everything here comes from what is in the kit; nothing is guessed,
// and a section with nothing to say is left out.

const HEX = /^#[0-9a-f]{6}$/i;
const isHex = (v) => typeof v === 'string' && HEX.test(v);

function lum(hex) {
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
/** WCAG contrast ratio of two #rrggbb colours, one decimal. */
export function contrastRatio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 10) / 10;
}

const ROLE_ROWS = [
  ['primary', 'Primary', 'The brand colour. Main buttons, key links, highlights.'],
  ['onPrimary', 'On primary', 'Text and icons placed on the primary colour.'],
  ['accent', 'Accent', 'A second colour for secondary emphasis. Use sparingly.'],
  ['background', 'Background', 'The page background.'],
  ['surface', 'Surface', 'Cards, panels and bands that sit on the background.'],
  ['text', 'Text', 'Body text and headings.'],
  ['mutedText', 'Muted text', 'Captions, hints and small print.'],
  ['border', 'Border', 'Lines, outlines and dividers.'],
];

/** Roles of a kit, falling back to the three swatches of a kit that was filled in by hand. */
export function kitRoles(kit) {
  const roles = {};
  for (const [key] of ROLE_ROWS) if (isHex(kit?.roles?.[key])) roles[key] = kit.roles[key];
  if (!Object.keys(roles).length) {
    const swatches = (Array.isArray(kit?.colors) ? kit.colors : []).filter(isHex);
    if (swatches[0]) roles.primary = swatches[0];
    if (swatches[1]) roles.accent = swatches[1];
    if (swatches[2]) roles.text = swatches[2];
  }
  return roles;
}

/** Is there anything worth putting in a DESIGN.md? */
export function canBuildDesignMd(kit) {
  if (!kit || typeof kit !== 'object') return false;
  return Object.keys(kitRoles(kit)).length > 0 || !!(kit.headingFont?.family || kit.bodyFont?.family || kit.fontFamily) || Number.isFinite(kit.radius?.px);
}

const cssName = (key) => key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
const quote = (family) => `"${String(family).replace(/["\\\n\r]/g, '')}"`;
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

function fontLine(label, font, fallback) {
  if (!font?.family) return null;
  const weight = font.weight ? `, weight ${font.weight}` : '';
  const file = font.stored ? ' A copy of the font file is kept in the Vault Brand Kit; it is not part of this file.' : '';
  return `- **${label}:** ${font.family}${weight}.${file}${fallback ? ` In CSS: \`font-family: ${quote(font.family)}, sans-serif;\`` : ''}`;
}

/** The text of the file. `now` is a Date (a parameter so tests can fix it). */
export function buildDesignMd(kit, now = new Date()) {
  const roles = kitRoles(kit || {});
  const read = host(kit?.source?.url);
  const lines = [];
  lines.push('# Design');
  lines.push('');
  lines.push('This file describes the look of one brand: its colours, fonts and shapes. **Read it before building any screen, page or graphic, and use these values instead of choosing your own.**');
  lines.push('');
  if (read) {
    const when = kit?.source?.readAt ? new Date(kit.source.readAt) : now;
    lines.push(`Read from ${read} on ${when.toISOString().slice(0, 10)} with Curam Vault. It is a reading of a public website for private use, not an official brand guide, and may be missing things the brand owner has decided.`);
  } else {
    lines.push(`Written from the Brand Kit in Curam Vault on ${now.toISOString().slice(0, 10)}.`);
  }
  lines.push('');

  const rows = ROLE_ROWS.filter(([k]) => roles[k]);
  if (rows.length) {
    lines.push('## Colours');
    lines.push('');
    lines.push('| Role | Colour | Use |');
    lines.push('|---|---|---|');
    for (const [k, label, use] of rows) lines.push(`| ${label} | \`${roles[k]}\` | ${use} |`);
    lines.push('');
    if (roles.text && roles.background) {
      const ratio = contrastRatio(roles.text, roles.background);
      lines.push(`Text on the background has a contrast ratio of ${ratio}:1 (${ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : 'below the AA minimum of 4.5:1 for normal text'}).`);
    }
    if (roles.primary && roles.onPrimary) {
      const ratio = contrastRatio(roles.onPrimary, roles.primary);
      lines.push(`${roles.onPrimary} on the primary colour has a contrast ratio of ${ratio}:1${ratio < 4.5 ? ', which is below 4.5:1: avoid small text on it' : ''}.`);
    }
    const d = kit?.dark;
    if (d && isHex(d.background) && isHex(d.text)) {
      lines.push('');
      lines.push(`**Dark mode.** The site changes for dark mode: background \`${d.background}\`, text \`${d.text}\`${isHex(d.primary) ? `, primary \`${d.primary}\`` : ''}.`);
    }
    const palette = (Array.isArray(kit?.palette) ? kit.palette : []).filter(isHex);
    if (palette.length) {
      lines.push('');
      lines.push(`Other colours seen on the site, most used first: ${palette.map((c) => `\`${c}\``).join(', ')}.`);
    }
    lines.push('');
  }

  const heading = kit?.headingFont?.family ? kit.headingFont : (kit?.fontFamily ? { family: kit.fontFamily } : null);
  const body = kit?.bodyFont?.family ? kit.bodyFont : null;
  const fontRows = [fontLine('Headings', heading, true), fontLine('Body text', body, true)].filter(Boolean);
  if (fontRows.length) {
    lines.push('## Typography');
    lines.push('');
    lines.push(...fontRows);
    if (heading && !body) lines.push('- Use the heading font for body text too unless told otherwise.');
    lines.push('- The generic fallback `sans-serif` is a guess: change it to `serif` if the font is a serif.');
    lines.push('');
  }

  if (Number.isFinite(kit?.radius?.px)) {
    const px = kit.radius.px;
    lines.push('## Shape');
    lines.push('');
    lines.push(px === 0
      ? '- Corners are **square**. Do not round buttons, cards or fields.'
      : px >= 999
        ? '- Buttons and fields are **fully rounded (pill-shaped)**: `border-radius: 9999px`.'
        : `- Corners are **${kit.radius.label || 'rounded'}**: \`border-radius: ${px}px\` on buttons, fields and cards.`);
    lines.push('');
  }

  const cssRows = ROLE_ROWS.filter(([k]) => roles[k]).map(([k]) => `  --brand-${cssName(k)}: ${roles[k]};`);
  if (Number.isFinite(kit?.radius?.px)) cssRows.push(`  --brand-radius: ${kit.radius.px >= 999 ? '9999px' : `${kit.radius.px}px`};`);
  if (heading?.family) cssRows.push(`  --brand-font-heading: ${quote(heading.family)}, sans-serif;`);
  if (body?.family) cssRows.push(`  --brand-font-body: ${quote(body.family)}, sans-serif;`);
  if (cssRows.length) {
    lines.push('## CSS variables');
    lines.push('');
    lines.push('```css');
    lines.push(':root {');
    lines.push(...cssRows);
    lines.push('}');
    lines.push('```');
    lines.push('');
  }

  lines.push('## Rules');
  lines.push('');
  lines.push('- Use only the colours above. Do not invent new colours or use generic palette colours.');
  if (roles.primary) lines.push('- One primary action per screen, in the primary colour.');
  if (roles.text && roles.background) lines.push('- Keep text readable: any text needs a contrast ratio of at least 4.5:1 against what it sits on.');
  if (kit?.logoDataUrl) lines.push('- The brand logo is saved in the Vault Brand Kit; ask for it rather than redrawing or approximating it.');
  lines.push('');
  return lines.join('\n');
}
