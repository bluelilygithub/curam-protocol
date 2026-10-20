// The CSS tool's record of what was changed, and the stylesheet made from it. Pure functions, no DOM, so they are tested in node
// (server/services/restyle/restyleEdits.test.js).
//
// Changes are NOT written into the page's elements any more. Each change is a rule in a list ("edits"), and the preview, the export and
// the shared preview all come from that one list, so what you see is exactly the CSS you can copy out.
//
//   edit  = { selector, label, state, media, props: { fontSize: { value: '28px', was: '16px' }, ... } }
//   state = '' | 'hover' | 'focus'          media = '' | a media query such as '(max-width: 480px)'
//   token = { id, kind: 'color' | 'font', name, value }      becomes  --brand-<name>  and is used as  var(--brand-<name>)
//
// No CSS jargon in the wording a person reads (PLAIN, the labels, the report): see docs/restyle.md.

// What the tool can change: its key (the JS name the panel and the AI use), the CSS name it is written as, and plain words for it.
export const PROPERTIES = [
  { key: 'fontFamily', css: 'font-family', plain: 'the font' },
  { key: 'fontSize', css: 'font-size', plain: 'the text size' },
  { key: 'fontWeight', css: 'font-weight', plain: 'how bold the text is' },
  { key: 'color', css: 'color', plain: 'the text color' },
  { key: 'lineHeight', css: 'line-height', plain: 'the spacing between lines of text' },
  { key: 'backgroundColor', css: 'background-color', plain: 'the background color' },
  { key: 'borderRadius', css: 'border-radius', plain: 'the rounded corners' },
  { key: 'padding', css: 'padding', plain: 'the space around the content' },
  { key: 'boxShadow', css: 'box-shadow', plain: 'the shadow' },
  { key: 'textTransform', css: 'text-transform', plain: 'the text capitalization' },
  { key: 'letterSpacing', css: 'letter-spacing', plain: 'the spacing between letters' },
  { key: 'textAlign', css: 'text-align', plain: 'the text alignment' },
  { key: 'animation', css: 'animation', plain: 'the animation' },
];
export const PLAIN = Object.fromEntries(PROPERTIES.map((p) => [p.key, p.plain]));
const CSS_NAME = Object.fromEntries(PROPERTIES.map((p) => [p.key, p.css]));

// Animation presets: the label shown, the value written, and the movement itself (written into the export only when used).
// Keep the values in step with ALLOWED_ANIMATION_VALUES in server/services/restyle/aiEdit.js.
export const ANIMATION_PRESETS = [
  { value: 'none', label: 'None' },
  { value: 'restyleFadeIn 0.6s ease both', label: 'Fade in', name: 'restyleFadeIn', keyframes: '@keyframes restyleFadeIn { from { opacity: 0; } to { opacity: 1; } }' },
  { value: 'restyleSlideUp 0.6s ease both', label: 'Slide up', name: 'restyleSlideUp', keyframes: '@keyframes restyleSlideUp { from { opacity: 0; transform: translateY(24px); } to { opacity: 1; transform: translateY(0); } }' },
  { value: 'restyleZoomIn 0.5s ease both', label: 'Pop in', name: 'restyleZoomIn', keyframes: '@keyframes restyleZoomIn { from { opacity: 0; transform: scale(0.85); } to { opacity: 1; transform: scale(1); } }' },
  { value: 'restylePulse 1s ease-in-out 2', label: 'Pulse', name: 'restylePulse', keyframes: '@keyframes restylePulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.05); } }' },
  { value: 'restyleBounce 0.8s ease', label: 'Bounce', name: 'restyleBounce', keyframes: '@keyframes restyleBounce { 0%, 20%, 50%, 80%, 100% { transform: translateY(0); } 40% { transform: translateY(-12px); } 60% { transform: translateY(-6px); } }' },
];

// Where a change applies. Phones are narrower than the 480px limit and tablets than 768px, so a "phone only" rule is also inside the tablet one.
export const MEDIA_OPTIONS = [
  { id: '', label: 'All screen sizes', query: '' },
  { id: 'tablet', label: 'Tablets and smaller (up to 768px wide)', query: '(max-width: 768px)' },
  { id: 'phone', label: 'Phones only (up to 480px wide)', query: '(max-width: 480px)' },
];
export const STATE_OPTIONS = [
  { id: '', label: 'Normal' },
  { id: 'hover', label: 'When the mouse is over it' },
  { id: 'focus', label: 'When it is selected (focus)' },
];
export const DEVICES = [
  { id: 'desktop', label: 'Desktop', width: null, tip: 'The full width of the window.' },
  { id: 'tablet', label: 'Tablet', width: 768, tip: 'A tablet-sized screen, 768px wide.' },
  { id: 'phone', label: 'Phone', width: 390, height: 844, tip: 'A phone-sized screen, 390px wide.' },
];
// (tablet gets its height too, so turning it on its side has a screen to turn)
DEVICES[1].height = 1024;

/**
 * The preview's screen for a device held upright (portrait) or on its side (landscape). Desktop has no sides: it is the window.
 * Landscape swaps the two sizes, so a phone becomes 844 wide and 390 high. Portrait keeps the preview as tall as the window.
 * @returns {{width:number|null, height:number|null, canTurn:boolean}}
 */
export function previewScreen(deviceId, orientation) {
  const d = DEVICES.find((x) => x.id === deviceId);
  if (!d || !d.width) return { width: null, height: null, canTurn: false };
  if (orientation === 'landscape') return { width: d.height, height: d.width, canTurn: true };
  return { width: d.width, height: null, canTurn: true };
}

// "Apply a brand colour or font everywhere": what each choice changes, in plain words, and the rule it makes.
export const BRAND_TARGETS = [
  { id: 'headings-text', kind: 'color', label: 'All headings (text colour)', selector: 'h1, h2, h3, h4, h5, h6', prop: 'color' },
  { id: 'body-text', kind: 'color', label: 'Body text colour', selector: 'body', prop: 'color' },
  { id: 'links-text', kind: 'color', label: 'All links (text colour)', selector: 'a', prop: 'color' },
  { id: 'buttons-bg', kind: 'color', label: 'All buttons (background)', selector: 'button, .btn, .button, input[type="submit"], input[type="button"]', prop: 'backgroundColor' },
  { id: 'page-bg', kind: 'color', label: 'Page background', selector: 'body', prop: 'backgroundColor' },
  { id: 'headings-font', kind: 'font', label: 'All headings (font)', selector: 'h1, h2, h3, h4, h5, h6', prop: 'fontFamily' },
  { id: 'body-font', kind: 'font', label: 'Everything else (font)', selector: 'body', prop: 'fontFamily' },
];

export const slug = (name) => String(name || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'brand';
export const tokenVarName = (token) => `--brand-${slug(token.name)}`;
export const tokenRef = (token) => `var(${tokenVarName(token)})`;

/** A token name not used by another token (adds -2, -3...). */
export function uniqueTokenName(tokens, wanted, ownId = null) {
  const taken = new Set(tokens.filter((t) => t.id !== ownId).map((t) => slug(t.name)));
  const base = slug(wanted);
  if (!taken.has(base)) return wanted || base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${wanted || base}-${n}`;
}

const editKey = (e) => `${e.media}\u0001${e.selector}\u0001${e.state}`;

/** Sets one or more properties on one rule. Returns a new list; keeps the first "was" it saw for a property. */
export function setProps(edits, target, changes) {
  const key = editKey(target);
  const next = edits.map((e) => ({ ...e, props: { ...e.props } }));
  let entry = next.find((e) => editKey(e) === key);
  if (!entry) {
    entry = { selector: target.selector, label: target.label || target.selector, state: target.state || '', media: target.media || '', props: {} };
    next.push(entry);
  }
  changes.forEach(({ prop, value, was }) => {
    const previous = entry.props[prop];
    entry.props[prop] = { value, was: previous ? previous.was : (was == null ? '' : String(was)) };
  });
  return next;
}

/** Takes every change off one selector (all states and screen sizes). */
export function clearSelector(edits, selector) {
  return edits.filter((e) => e.selector !== selector);
}

/** Takes one property off one rule; a rule left with nothing is removed. */
export function removeProp(edits, target, prop) {
  const key = editKey(target);
  return edits
    .map((e) => (editKey(e) === key ? { ...e, props: Object.fromEntries(Object.entries(e.props).filter(([p]) => p !== prop)) } : e))
    .filter((e) => Object.keys(e.props).length > 0);
}

export const countChanges = (edits) => edits.reduce((n, e) => n + Object.keys(e.props).length, 0);

/** Adds :hover / :focus to every selector in a comma list. In the preview a forced-state attribute stands in so a state can be seen without the mouse. */
export function selectorWithState(selector, state, { preview = false } = {}) {
  const parts = String(selector).split(',').map((p) => p.trim()).filter(Boolean);
  if (!state) return parts.join(', ');
  const real = parts.map((p) => `${p}:${state}`);
  const forced = preview ? parts.map((p) => `${p}[data-restyle-force-${state}]`) : [];
  return [...real, ...forced].join(', ');
}

const mediaIndex = (query) => Math.max(0, MEDIA_OPTIONS.findIndex((m) => m.query === query));

function declarations(props, important) {
  return Object.entries(props)
    .filter(([key]) => CSS_NAME[key])
    .map(([key, { value }]) => `  ${CSS_NAME[key]}: ${value}${important ? ' !important' : ''};`)
    .join('\n');
}

function ruleText(entry, { important, comments, preview }) {
  const head = comments ? `/* ${entry.label}${entry.state ? ` (${entry.state})` : ''} */\n` : '';
  return `${head}${selectorWithState(entry.selector, entry.state, { preview })} {\n${declarations(entry.props, important)}\n}`;
}

/**
 * The stylesheet for a list of changes (and the brand colours and fonts).
 * @param {object} [o]
 * @param {boolean} [o.important=true]  make the changes win over the page's own styles
 * @param {boolean} [o.comments=true]   one plain comment above each rule
 * @param {boolean} [o.preview=false]   also match forced-state attributes, used only inside the editor's preview
 */
export function generateCss(edits, tokens = [], { important = true, comments = true, preview = false } = {}) {
  const blocks = [];
  if (tokens.length) {
    const lines = tokens.map((t) => `  ${tokenVarName(t)}: ${t.value};`).join('\n');
    blocks.push(`${comments ? '/* Brand colours and fonts: change a value here and everything that uses it follows */\n' : ''}:root {\n${lines}\n}`);
  }
  const usable = edits.filter((e) => Object.keys(e.props).some((k) => CSS_NAME[k]));
  const queries = [...new Set(usable.map((e) => e.media))].sort((a, b) => mediaIndex(a) - mediaIndex(b));
  queries.forEach((query) => {
    const rules = usable.filter((e) => e.media === query).map((e) => ruleText(e, { important, comments, preview }));
    if (!rules.length) return;
    if (!query) blocks.push(rules.join('\n\n'));
    else blocks.push(`${comments ? `/* ${MEDIA_OPTIONS.find((m) => m.query === query)?.label || 'Some screen sizes'} */\n` : ''}@media ${query} {\n${rules.join('\n\n').split('\n').map((l) => (l ? `  ${l}` : l)).join('\n')}\n}`);
  });
  // The movement an animation needs, only for the ones used.
  const usedAnimations = new Set(usable.flatMap((e) => (e.props.animation ? [e.props.animation.value] : [])));
  const keyframes = ANIMATION_PRESETS.filter((a) => a.keyframes && usedAnimations.has(a.value)).map((a) => a.keyframes);
  if (keyframes.length) blocks.push(`${comments ? '/* The movement the animations above use */\n' : ''}${keyframes.join('\n')}`);
  return blocks.join('\n\n');
}

const stateLabel = (state) => STATE_OPTIONS.find((s) => s.id === state)?.label || '';
const mediaLabel = (query) => MEDIA_OPTIONS.find((m) => m.query === query)?.label || '';

/** One row per changed property, for the "Changes so far" list. */
export function changeRows(edits) {
  return edits.flatMap((e) => Object.entries(e.props).filter(([k]) => CSS_NAME[k]).map(([prop, { value, was }]) => ({
    key: `${editKey(e)}\u0001${prop}`,
    target: { selector: e.selector, state: e.state, media: e.media, label: e.label },
    prop,
    what: PLAIN[prop],
    value,
    was,
    where: e.label,
    when: [e.state ? stateLabel(e.state).toLowerCase() : '', e.media ? mediaLabel(e.media).toLowerCase() : ''].filter(Boolean).join(', '),
  })));
}

/** A plain-text report a developer can read to see exactly what was changed and where. */
export function changeReport(edits, tokens = [], { title = 'Page', sourceUrl = '', important = true, date = new Date() } = {}) {
  const rows = changeRows(edits);
  const lines = [`# Changes to ${title}`, ''];
  if (sourceUrl) lines.push(`Page: ${sourceUrl}`);
  lines.push(`Made with the Vault CSS tool on ${date.toISOString().slice(0, 10)}.`, `${rows.length} change${rows.length === 1 ? '' : 's'}${important ? ', written to win over the page\'s own styles' : ''}.`, '');
  if (tokens.length) {
    lines.push('## Brand colours and fonts', '');
    tokens.forEach((t) => lines.push(`- ${t.name} (${t.kind}): ${t.value}  ->  ${tokenRef(t)}`));
    lines.push('');
  }
  lines.push('## What changed', '');
  if (!rows.length) lines.push('Nothing yet.');
  rows.forEach((r) => lines.push(`- ${r.where}${r.when ? ` [${r.when}]` : ''}: ${r.what}: ${r.was ? `${r.was} -> ` : ''}${r.value}`));
  lines.push('', '## The CSS', '', '```css', generateCss(edits, tokens, { important, comments: true }), '```', '');
  return lines.join('\n');
}

/** Detects a fully-opaque 6-digit colour in a CSS colour string (the colour input needs exactly that). */
export function toHex(colorStr) {
  const s = String(colorStr || '').trim();
  const hex3 = /^#([0-9a-fA-F]{3})$/.exec(s);
  if (hex3) return `#${hex3[1].split('').map((c) => c + c).join('')}`.toLowerCase();
  const hex6or8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(s);
  if (hex6or8) return `#${hex6or8[1]}`.toLowerCase();
  const m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (m) return `#${[m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('')}`;
  return null;
}
