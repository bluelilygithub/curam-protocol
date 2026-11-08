// The two looks of a drawing. "Sketch" is Excalidraw's hand-drawn style. "Clean" is the conservative one: steady straight lines, square
// corners, straight arrows, solid fills, a plain font, and Vault's own text colour instead of Excalidraw's black.
//
// Switching is REVERSIBLE: when a piece goes clean it remembers how it was drawn (inside the piece, in `customData.vaultLook.sketch`, which
// Excalidraw keeps and saves with the scene), and switching back puts exactly that back. A piece drawn while the drawing was clean has
// nothing remembered, so it gets ordinary sketch settings on the way back. Pure functions on plain element objects: no Excalidraw needed,
// so `node client/src/pages/drawings/lookConvert.test.mjs` runs them.

const KEY = 'vaultLook';
export const DEFAULT_STROKE = '#1e1e1e'; // Excalidraw's own default line colour
export const CLEAN_FONT = 2; // Excalidraw's "Helvetica" family (a plain, neutral sans)
export const SKETCH_FONT = 5; // Excalifont, the hand-drawn font
const HATCHES = ['hachure', 'cross-hatch', 'zigzag'];
// pieces the look applies to: the pen (freedraw) is the person's own hand and pictures and embeds have no style to change
const SHAPES = ['rectangle', 'diamond', 'ellipse', 'arrow', 'line'];

const live = (e) => e && !e.isDeleted;
const stored = (e) => (e.customData && e.customData[KEY] && e.customData[KEY].sketch) || null;
const nonce = () => Math.floor(Math.random() * 2147483647);

/** The piece with its changes, a new version number (so Excalidraw and the save check see it changed), and the same everything else. */
function changed(e, patch) {
  return { ...e, ...patch, version: (e.version || 0) + 1, versionNonce: nonce(), updated: Date.now() };
}

const withoutKey = (cd) => {
  if (!cd) return undefined;
  const { [KEY]: _gone, ...rest } = cd;
  return Object.keys(rest).length ? rest : undefined;
};

/** What a piece looked like before it went clean (only the settings the look changes). */
function remember(e) {
  const o = { roughness: e.roughness, roundness: e.roundness === undefined ? null : e.roundness, fillStyle: e.fillStyle, strokeColor: e.strokeColor };
  if (e.type === 'text') o.fontFamily = e.fontFamily;
  return o;
}

/**
 * The clean version of a drawing's pieces. `ink` (a #rrggbb colour or null) replaces Excalidraw's default black line colour; a colour the
 * person chose themselves is never touched. Returns { elements, changed } (`changed` is how many pieces were altered).
 */
export function toClean(elements, { ink = null } = {}) {
  let n = 0;
  const out = (elements || []).map((e) => {
    if (!live(e)) return e;
    const isShape = SHAPES.includes(e.type);
    const isText = e.type === 'text';
    if (!isShape && !isText) return e;
    const patch = {};
    if (isShape) {
      if (e.roughness !== 0) patch.roughness = 0;
      if (e.roundness) patch.roundness = null;
      if (HATCHES.includes(e.fillStyle)) patch.fillStyle = 'solid';
    }
    if (isText && e.fontFamily !== CLEAN_FONT) patch.fontFamily = CLEAN_FONT;
    if (ink && e.strokeColor === DEFAULT_STROKE) patch.strokeColor = ink;
    if (!Object.keys(patch).length) return e;
    n += 1;
    if (!stored(e)) patch.customData = { ...(e.customData || {}), [KEY]: { sketch: remember(e) } }; // remember the FIRST look only
    return changed(e, patch);
  });
  return { elements: out, changed: n };
}

/** Back to sketch: pieces that remember their original look get it back exactly; pieces drawn while clean get ordinary sketch settings. */
export function toSketch(elements) {
  let n = 0;
  const out = (elements || []).map((e) => {
    if (!live(e)) return e;
    const orig = stored(e);
    if (orig) {
      n += 1;
      const patch = { roughness: orig.roughness, roundness: orig.roundness, fillStyle: orig.fillStyle, strokeColor: orig.strokeColor, customData: withoutKey(e.customData) };
      if (e.type === 'text' && orig.fontFamily !== undefined) patch.fontFamily = orig.fontFamily;
      return changed(e, patch);
    }
    // drawn while clean: nothing to restore, so give it the usual sketch settings
    const isShape = SHAPES.includes(e.type);
    const isText = e.type === 'text';
    if (!isShape && !isText) return e;
    const patch = {};
    if (isShape && e.roughness !== 1) patch.roughness = 1;
    if (e.type === 'rectangle' && !e.roundness) patch.roundness = { type: 3 };
    if (e.type === 'diamond' && !e.roundness) patch.roundness = { type: 2 };
    if (isText && e.fontFamily === CLEAN_FONT) patch.fontFamily = SKETCH_FONT;
    if (!Object.keys(patch).length) return e;
    n += 1;
    return changed(e, patch);
  });
  return { elements: out, changed: n };
}

/** What new pieces start as, for the editor's "current item" settings. */
export function lookDefaults(look, { ink = null } = {}) {
  if (look === 'clean') {
    return {
      currentItemRoughness: 0, currentItemRoundness: 'sharp', currentItemFontFamily: CLEAN_FONT, currentItemFillStyle: 'solid',
      currentItemStrokeColor: ink || DEFAULT_STROKE, currentItemArrowType: 'sharp',
    };
  }
  return {
    currentItemRoughness: 1, currentItemRoundness: 'round', currentItemFontFamily: SKETCH_FONT, currentItemFillStyle: 'solid',
    currentItemStrokeColor: DEFAULT_STROKE, currentItemArrowType: 'round',
  };
}

/** A CSS colour (hex or rgb()) as '#rrggbb', or null. */
export function toHex(css) {
  const s = String(css || '').trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return `#${h.toLowerCase()}`;
  }
  m = s.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((v) => Math.min(255, Number(v)).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Vault's text colour to draw lines with in the clean look, or null. A dark Vault theme gives null: Excalidraw's dark mode draws the page
 * by inverting colours, so a light line colour chosen for a dark page would come out dark. In a light theme the line colour is the theme's.
 */
export function inkFromTheme(textCss, dark) {
  if (dark) return null;
  const hex = toHex(textCss);
  return hex && hex !== DEFAULT_STROKE ? hex : null;
}

/** 'clean' or 'sketch' for display: a drawing is clean when it says so. Anything unknown is sketch. */
export const normaliseLook = (v) => (v === 'clean' ? 'clean' : 'sketch');
