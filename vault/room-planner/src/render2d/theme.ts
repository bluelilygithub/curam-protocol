/**
 * Colours for the Konva canvas. The app's CSS variables are the source of truth (Vault's six warm-sand tokens plus a few
 * drafting inks); Konva needs concrete strings, so they are read once from the document with the same defaults as `styles.css`.
 */
export interface Palette {
  bg: string;
  surface: string;
  border: string;
  primary: string;
  text: string;
  muted: string;
  paper: string;
  floor: string;
  wall: string;
  wallEdge: string;
  grid: string;
  gridMajor: string;
  hard: string;
  soft: string;
  valid: string;
  dim: string;
}

export const DEFAULT_PALETTE: Palette = {
  bg: '#F5F5F0',
  surface: '#EEEEE8',
  border: '#D8D8D0',
  primary: '#CC785C',
  text: '#1A1A1A',
  muted: '#888888',
  paper: '#FBFAF6',
  floor: '#FFFFFF',
  wall: '#34312d',
  wallEdge: '#1A1A1A',
  grid: '#E6E5DD',
  gridMajor: '#D6D4C8',
  hard: '#ef4444',
  soft: '#f59e0b',
  valid: '#3f7d5b',
  dim: '#5b6b7a',
};

const VARS: Record<keyof Palette, string> = {
  bg: '--color-bg', surface: '--color-surface', border: '--color-border', primary: '--color-primary', text: '--color-text',
  muted: '--color-muted', paper: '--rp-paper', floor: '--rp-floor', wall: '--rp-wall', wallEdge: '--rp-wall-edge',
  grid: '--rp-grid', gridMajor: '--rp-grid-major', hard: '--rp-hard', soft: '--rp-soft', valid: '--rp-valid', dim: '--rp-dim',
};

export function readPalette(root: Element = document.documentElement): Palette {
  const cs = getComputedStyle(root);
  const out = { ...DEFAULT_PALETTE };
  for (const k of Object.keys(VARS) as Array<keyof Palette>) {
    const v = cs.getPropertyValue(VARS[k]).trim();
    if (v) out[k] = v;
  }
  return out;
}

/** Grid spacing in metres that keeps lines at least `minPx` apart. */
export function gridStep(scale: number, base = 0.1, minPx = 14): number {
  const steps = [base, base * 5, base * 10, base * 50, base * 100];
  return steps.find((s) => s * scale >= minPx) ?? steps[steps.length - 1];
}
