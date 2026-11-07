// Pure helpers for "Get from a website" in the Graphics Brand Kit (BrandFromSite.jsx; named differently on purpose, a Windows file system and Vite would treat BrandFromSite and brandFromSite as the same name). No React, so they can be tested with plain node:
//   node client/src/pages/graphics/brandSiteLogic.test.mjs
// Server side of this feature: docs/brand-from-url.md.

/** What is ticked at first, from a reading: only things the reading really found. */
export function defaultUse(brand) {
  const c = brand?.colours || {};
  const h = brand?.fonts?.heading;
  const b = brand?.fonts?.body;
  const sameAsHeading = !!(h && b && h.family === b.family);
  return {
    colours: !!(c.primary || c.background),
    radius: Number.isFinite(brand?.radius?.px),
    // a font is ticked at first only when its file was downloaded: a name alone would just replace what the person has typed
    heading: !!(h && h.file),
    body: !!(b && b.file && !sameAsHeading),
    logo: Number.isInteger(brand?.logoIndex) && brand.logos?.[brand.logoIndex] ? brand.logoIndex : null,
  };
}

export const useIsEmpty = (use) => !use.colours && !use.radius && !use.heading && !use.body && use.logo === null;

/** The body the apply route expects. */
export function applyBody(use) {
  return { use: { colours: !!use.colours, radius: !!use.radius, logoIndex: use.logo === null ? null : use.logo, fonts: { heading: !!use.heading, body: !!use.body } } };
}

/** One line for the toast after "Use selected". */
export function summaryOfChanged(changed) {
  const list = Array.isArray(changed) ? changed : [];
  if (!list.length) return 'Nothing was changed.';
  return `Brand Kit updated: ${list.join(', ')}.`;
}

const ROLE_LABELS = [['primary', 'Main'], ['accent', 'Accent'], ['background', 'Page'], ['surface', 'Panel'], ['text', 'Text'], ['mutedText', 'Small text'], ['border', 'Lines']];

/** [{ key, label, hex }] for the colours the reading found, in a fixed friendly order. */
export function roleList(colours) {
  return ROLE_LABELS.filter(([k]) => typeof colours?.[k] === 'string' && /^#[0-9a-f]{6}$/i.test(colours[k])).map(([key, label]) => ({ key, label, hex: colours[key] }));
}

const LOGO_LABELS = { img: 'Picture on the page', svg: 'Drawing on the page', bg: 'Picture on the page', 'apple-touch-icon': 'App icon', 'og-image': 'Share picture' };
export const logoLabel = (kind) => LOGO_LABELS[kind] || 'Picture';

/** CSS border-radius for the corner sample; 999 means a pill. */
export function radiusCss(radius) {
  if (!Number.isFinite(radius?.px)) return '0px';
  return radius.px >= 999 ? '9999px' : `${radius.px}px`;
}

/** A short human line about a font of the reading. */
export function fontSummary(font) {
  if (!font) return 'No font found';
  const weight = font.weight ? ` ${font.weight}` : '';
  if (font.file) {
    const kb = Math.max(1, Math.round(font.file.bytes / 1024));
    const where = font.source === 'google-fonts' ? 'from Google Fonts' : 'from the page';
    return `${font.family}${weight} · file ready (${kb} KB, ${where})`;
  }
  if (font.system) return `${font.family}${weight} · a font every computer has, nothing to download`;
  return `${font.family}${weight} · name only, the file could not be downloaded`;
}

/**
 * The kit to save when the person edits it by hand in the Brand Kit window. The kit now has fields this window does not show (roles,
 * dark mode, radius, font files ...), and saving replaces the whole value, so they are carried over. Typing a different font name than
 * the downloaded heading font's means the file no longer matches: its entry is dropped and `dropHeadingFile` says to remove the file.
 */
export function mergeManualKit(oldKit, draft) {
  const kit = { ...(oldKit && typeof oldKit === 'object' ? oldKit : {}) };
  kit.logoDataUrl = draft.logoDataUrl || '';
  kit.colors = (draft.colors || []).filter(Boolean).slice(0, 3);
  const name = String(draft.fontFamily || '').trim();
  kit.fontFamily = name;
  let dropHeadingFile = false;
  const heading = kit.headingFont;
  if (heading && heading.family !== name) {
    dropHeadingFile = !!heading.stored;
    delete kit.headingFont;
  }
  return { kit, dropHeadingFile };
}

/**
 * The fonts a text tool can offer: the standard one, plus the brand heading and body fonts when a font FILE is saved in the kit
 * (`stored`). A font that is only a name cannot be drawn, so it is not offered.
 */
export function fontChoices(kit) {
  const out = [{ value: 'standard', label: 'Standard (Arial)' }];
  if (kit?.headingFont?.stored) out.push({ value: 'brand-heading', label: `Brand heading: ${kit.headingFont.family}` });
  if (kit?.bodyFont?.stored) out.push({ value: 'brand-body', label: `Brand body: ${kit.bodyFont.family}` });
  return out;
}

/** The value to send: the chosen one if the kit still offers it, otherwise the standard font (the kit may have changed since it was chosen). */
export function effectiveFontSource(kit, chosen) {
  return fontChoices(kit).some((c) => c.value === chosen) ? chosen : 'standard';
}

/**
 * The choices for a saved step (a recipe's text step): the kit's own, plus the font the step already names if the kit no longer has it,
 * so the screen shows the truth ("none saved") instead of quietly showing the standard font while the recipe would refuse to run.
 */
export function stepFontChoices(kit, current) {
  const out = fontChoices(kit);
  if ((current === 'brand-heading' || current === 'brand-body') && !out.some((c) => c.value === current)) {
    out.push({ value: current, label: `${current === 'brand-heading' ? 'Brand heading' : 'Brand body'} (none saved)` });
  }
  return out;
}

/** Is the Brand Kit window's by-hand form different from the saved kit? (logo, up to three colours, font name) */
export function kitIsDirty(kit, draft) {
  const saved = kit && typeof kit === 'object' ? kit : {};
  const colours = (draft?.colors || []).filter(Boolean).slice(0, 3);
  const savedColours = (Array.isArray(saved.colors) ? saved.colors : []).filter(Boolean).slice(0, 3);
  return (draft?.logoDataUrl || '') !== (saved.logoDataUrl || '')
    || colours.join(',') !== savedColours.join(',')
    || String(draft?.fontFamily || '').trim() !== String(saved.fontFamily || '').trim();
}
