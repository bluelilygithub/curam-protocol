// Device preview: the pure parts (no screen needed, tested in devicePreviewModel.test.mjs).
import { deviceById, screenFor, fitScale } from '../../utils/deviceCatalog.mjs';

export const MAX_SCREENS = 4;
export const DEFAULT_SELECTION = ['iphone-14', 'ipad-10', 'laptop-1440'];
export const ZOOMS = [
  { id: 'fit', label: 'Fit' },
  { id: '1', label: '100%' },
  { id: '0.75', label: '75%' },
  { id: '0.5', label: '50%' },
];

/**
 * The preview has no scripts, so anything a script library hides until it runs stays hidden for good. finestone.com.au's sections sit at
 * opacity 0 waiting for AOS ("animate on scroll") to fade them in, so the phone view came out blank below the banner. This shows them in
 * their finished state. Covers AOS, Owl Carousel (hidden until it starts), WOW/animate.css and Elementor's entrance animations.
 */
export const NO_SCRIPT_REVEAL_CSS = [
  '[data-aos]{opacity:1!important;transform:none!important;visibility:visible!important}',
  '.owl-carousel:not(.owl-loaded){display:block!important}',
  '.wow,.elementor-invisible{visibility:visible!important;opacity:1!important}',
].join('');

/** The page as one self-contained document for an iframe: the page's own head and body (already cleaned by the server) plus its style files in order. */
export function buildPreviewDoc({ headInnerHTML = '', bodyInnerHTML = '', cssFiles = [] } = {}) {
  // a style file must never be able to close its own <style> element and add markup
  const css = cssFiles.map((f) => String((f && f.css) || '')).join('\n').replace(/<\/style/gi, '<' + String.fromCharCode(92) + '/style');
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">${headInnerHTML}<style>${css}</style><style>${NO_SCRIPT_REVEAL_CSS}</style></head><body>${bodyInnerHTML}</body></html>`;
}

/** Add or remove a device from the shown set. At most MAX_SCREENS; a full set refuses a new one (the caller says why). */
export function toggleScreen(selection, id, max = MAX_SCREENS) {
  if (selection.includes(id)) return { selection: selection.filter((x) => x !== id), refused: false };
  if (selection.length >= max) return { selection, refused: true };
  return { selection: [...selection, id], refused: false };
}

/** Resolve the shown ids (catalog ids or custom screens) to screens, dropping unknown ids. */
export function resolveScreens(selection, customs = []) {
  return selection.map((id) => deviceById(id) || customs.find((c) => c.id === id)).filter(Boolean);
}

/**
 * How big to draw one screen: { width, height } of the real screen as the page sees it, the `scale` it is drawn at, and the `outerWidth/outerHeight`
 * the card takes up on the page. `zoom` is 'fit' (shrink so the screen is no taller than `fitHeight`) or a fixed number such as 0.75.
 * A phone or tablet is turned when `landscape`; desktop sizes are never turned.
 */
export function cardLayout(device, { zoom = 'fit', landscape = false, fitHeight = 640 } = {}) {
  const turn = landscape && device.kind !== 'desktop';
  const screen = screenFor(device, turn ? 'landscape' : 'portrait');
  const fixed = Number(zoom);
  const scale = zoom === 'fit' || !Number.isFinite(fixed) || fixed <= 0 ? fitScale(screen.width, screen.height, Infinity, fitHeight) : Math.min(1, fixed);
  return { width: screen.width, height: screen.height, scale, outerWidth: Math.round(screen.width * scale), outerHeight: Math.round(screen.height * scale) };
}
