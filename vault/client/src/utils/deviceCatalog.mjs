// Popular phones, tablets and desktop sizes for previewing a page at the size of a real screen. Used by the Style editor's preview and by
// the Device preview tool. Sizes are CSS pixels (what a page's own breakpoints see), portrait, not the physical pixel count.
// They are the widely published viewport sizes, so treat them as "close to" the real device (browsers add their own bars).

export const DEVICE_CATALOG = [
  // phones
  { id: 'iphone-se', label: 'iPhone SE', kind: 'phone', width: 375, height: 667 },
  { id: 'iphone-13-mini', label: 'iPhone 12 / 13 mini', kind: 'phone', width: 375, height: 812 },
  { id: 'iphone-14', label: 'iPhone 12 / 13 / 14', kind: 'phone', width: 390, height: 844 },
  { id: 'iphone-15', label: 'iPhone 15 / 16', kind: 'phone', width: 393, height: 852 },
  { id: 'iphone-16-pro', label: 'iPhone 16 Pro', kind: 'phone', width: 402, height: 874 },
  { id: 'iphone-15-pro-max', label: 'iPhone 14 Pro Max / 15 Plus / 15 Pro Max', kind: 'phone', width: 430, height: 932 },
  { id: 'iphone-16-pro-max', label: 'iPhone 16 Pro Max', kind: 'phone', width: 440, height: 956 },
  { id: 'galaxy-s24', label: 'Samsung Galaxy S23 / S24', kind: 'phone', width: 360, height: 780 },
  { id: 'galaxy-a54', label: 'Samsung Galaxy A54', kind: 'phone', width: 360, height: 800 },
  { id: 'galaxy-s24-ultra', label: 'Samsung Galaxy S24 Ultra', kind: 'phone', width: 384, height: 824 },
  { id: 'pixel-8', label: 'Google Pixel 8', kind: 'phone', width: 412, height: 915 },
  { id: 'pixel-8-pro', label: 'Google Pixel 8 Pro', kind: 'phone', width: 448, height: 998 },
  // tablets
  { id: 'ipad-mini', label: 'iPad mini', kind: 'tablet', width: 744, height: 1133 },
  { id: 'ipad-9', label: 'iPad (9th gen)', kind: 'tablet', width: 810, height: 1080 },
  { id: 'ipad-10', label: 'iPad (10th gen) / iPad Air', kind: 'tablet', width: 820, height: 1180 },
  { id: 'ipad-pro-11', label: 'iPad Pro 11"', kind: 'tablet', width: 834, height: 1194 },
  { id: 'ipad-pro-129', label: 'iPad Pro 12.9"', kind: 'tablet', width: 1024, height: 1366 },
  { id: 'galaxy-tab-s9', label: 'Samsung Galaxy Tab S9', kind: 'tablet', width: 800, height: 1280 },
  { id: 'pixel-tablet', label: 'Google Pixel Tablet', kind: 'tablet', width: 800, height: 1280 },
  { id: 'surface-pro', label: 'Microsoft Surface Pro', kind: 'tablet', width: 912, height: 1368 },
  // desktop sizes worth checking
  { id: 'laptop-1366', label: 'Small laptop', kind: 'desktop', width: 1366, height: 768 },
  { id: 'laptop-1440', label: 'Laptop', kind: 'desktop', width: 1440, height: 900 },
  { id: 'desktop-1920', label: 'Full HD monitor', kind: 'desktop', width: 1920, height: 1080 },
];

export const CUSTOM_LIMITS = { min: 200, max: 4000 };

export const devicesOfKind = (kind) => DEVICE_CATALOG.filter((d) => d.kind === kind);
export const deviceById = (id) => DEVICE_CATALOG.find((d) => d.id === id) || null;

/** The screen's size for the way it is held. Landscape swaps width and height. Desktop sizes only turn if asked. */
export function screenFor(device, orientation = 'portrait') {
  if (!device || !device.width || !device.height) return null;
  return orientation === 'landscape'
    ? { width: device.height, height: device.width }
    : { width: device.width, height: device.height };
}

/** A typed width and height as a usable screen, or null if either is missing or outside what a browser can sensibly show. */
export function customScreen(width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  const { min, max } = CUSTOM_LIMITS;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < min || h < min || w > max || h > max) return null;
  return { id: 'custom', label: `Custom ${w} x ${h}`, kind: 'custom', width: w, height: h };
}

/** How much to shrink a screen so it fits the room available (never enlarges). 1 = full size. */
export function fitScale(screenW, screenH, availW, availH) {
  if (!screenW || !screenH || !availW || !availH) return 1;
  return Math.min(1, availW / screenW, availH / screenH);
}
